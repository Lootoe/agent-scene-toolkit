import { AIMessageChunk, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { SSEEvent } from './types'

/**
 * 将 LangGraph `stream()` 的双模式流（messages + updates）
 * 转换为标准化 SSEEvent 序列。
 *
 * 事件映射逻辑：
 * - `messages` 模式的 AIMessageChunk（含 content）→ `text` 事件
 * - `messages` 模式的 AIMessageChunk（含 tool_call_chunks）→ `tool_start` 事件
 * - `updates` 模式的 tools 节点输出（ToolMessage）→ `tool_end` 事件
 * - `messages` 模式的 metadata.langgraph_node 变化 → `agent` + `handoff` 事件（多 Agent）
 *
 * ## 错误处理
 *
 * - **流迭代异常**：stream 本身抛出异常时（网络中断、LLM API 异常），
 *   由调用方（agent.ts）的 try-catch 捕获并转换为 `error` 事件
 * - **chunk 解析异常**：单个 chunk 解析失败时记录错误并跳过该 chunk，不中断流
 * - **生命周期回调异常**：onToolEnd 抛出异常时静默捕获，不影响流
 *
 * @param stream - LangGraph stream() 返回的异步可迭代对象
 * @param onToolEnd - Scene.onToolEnd 生命周期回调（可选）
 */
export async function* transformStream(
  stream: AsyncIterable<any>,
  onToolEnd?: (toolName: string, result: any) => void,
): AsyncGenerator<SSEEvent> {
  // 追踪当前活跃的 agent name，用于检测 handoff
  let currentAgentName: string | null = null

  for await (const chunk of stream) {
    let events: SSEEvent[]
    let detectedAgent: string | null

    // 解析 chunk — 单个 chunk 解析失败不应中断流
    try {
      const result = parseStreamChunk(chunk, currentAgentName)
      events = result.events
      detectedAgent = result.detectedAgent
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[transformStream] Failed to parse chunk:', message, chunk)
      // 跳过该 chunk，继续处理后续流
      continue
    }

    // 如果检测到 agent 切换，先 emit handoff 和 agent 事件
    if (detectedAgent && detectedAgent !== currentAgentName) {
      if (currentAgentName) {
        yield { type: 'handoff', from: currentAgentName, to: detectedAgent }
      }
      yield { type: 'agent', name: detectedAgent }
      currentAgentName = detectedAgent
    }

    for (const event of events) {
      yield event

      // 触发 Scene.onToolEnd 生命周期回调
      if (event.type === 'tool_end' && onToolEnd) {
        try {
          onToolEnd(event.toolName, event.output)
        } catch (error) {
          // 生命周期回调异常不应影响流，记录错误并继续
          const message = error instanceof Error ? error.message : String(error)
          console.error(`[transformStream] Scene.onToolEnd("${event.toolName}") error:`, message)
        }
      }
    }
  }
}

/** parseStreamChunk 的返回类型 */
interface ParseResult {
  events: SSEEvent[]
  /** 从 metadata 中检测到的 agent 名称（仅 messages 模式） */
  detectedAgent: string | null
}

/**
 * 解析单个 stream chunk 为 SSEEvent 数组 + agent 检测。
 *
 * LangGraph `stream({ streamMode: ['messages', 'updates'] })` 产出的 chunk 格式：
 * - messages 模式: `['messages', [message, metadata]]`
 *   - metadata.langgraph_node 标识消息来源节点（即 agent name）
 * - updates 模式: `['updates', { nodeName: { messages: [...] } }]`
 */
function parseStreamChunk(chunk: any, currentAgentName: string | null): ParseResult {
  const events: SSEEvent[] = []
  let detectedAgent: string | null = null

  // 双 streamMode 下，chunk 是 [streamMode, data] 元组
  if (!Array.isArray(chunk) || chunk.length !== 2) return { events, detectedAgent }

  const [mode, data] = chunk

  if (mode === 'messages') {
    // data = [message, metadata]
    const [message, metadata] = data as [BaseMessage, any]

    // 从 metadata 中提取 agent name（多 Agent 场景）
    // langgraph_node 标识当前消息来自哪个节点（supervisor / worker name）
    if (metadata?.langgraph_node && typeof metadata.langgraph_node === 'string') {
      const nodeName = metadata.langgraph_node as string
      // 过滤掉内部节点名（如 "tools"、"__start__" 等），只关注 agent 节点
      if (nodeName !== 'tools' && !nodeName.startsWith('__')) {
        // Supervisor 模式下，supervisor 节点名默认为 "supervisor"
        // Worker 节点名为 createReactAgent 时指定的 name
        detectedAgent = nodeName
      }
    }

    // messages 模式下实际产出 MessageChunk，但 TS 推断为 BaseMessage
    if (AIMessageChunk.isInstance(message)) {
      // 工具调用 chunk（tool_start 事件）
      if (message.tool_call_chunks && message.tool_call_chunks.length > 0) {
        for (const toolChunk of message.tool_call_chunks) {
          // 只在 name 出现时才 emit tool_start（第一个 chunk 包含 name）
          if (toolChunk.name) {
            events.push({
              type: 'tool_start',
              toolName: toolChunk.name,
              input: {},
            })
          }
        }
      }

      // 文本内容 chunk（text 事件）
      const content = typeof message.content === 'string' ? message.content : ''
      if (content) {
        events.push({ type: 'text', content })
      }
    }
  }

  if (mode === 'updates') {
    // data = { nodeName: { messages: [...] } | nodeOutput }
    if (data && typeof data === 'object') {
      const nodeData = data as Record<string, any>

      // 遍历所有节点输出，查找 ToolMessage
      for (const [nodeName, nodeOutput] of Object.entries(nodeData)) {
        // tools 节点的输出包含 ToolMessage
        // 单 Agent: nodeName === 'tools'
        // 多 Agent: nodeName 可能是 worker 内部的 tools 节点（如 '{agentName}_tools'）
        if (nodeOutput?.messages) {
          const toolMessages = nodeOutput.messages as BaseMessage[]
          for (const msg of toolMessages) {
            if (msg instanceof ToolMessage) {
              events.push({
                type: 'tool_end',
                toolName: msg.name ?? 'unknown',
                output: safeParseJSON(
                  typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                ),
              })
            }
          }
        }
      }
    }
  }

  return { events, detectedAgent }
}

/**
 * 安全解析 JSON 字符串，失败则返回原始字符串。
 */
function safeParseJSON(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return str
  }
}

// ─── SSE 格式化工具 ─────────────────────────────────────

/**
 * 将 SSEEvent 格式化为 SSE 协议字符串 `data: JSON\n\n`。
 */
export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

