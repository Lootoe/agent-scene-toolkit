import { isAIMessageChunk, ToolMessage } from '@langchain/core/messages'
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import type { SSEEvent } from './types'

/**
 * 将 LangGraph `stream()` 的双模式流（messages + updates）
 * 转换为标准化 SSEEvent 序列。
 *
 * 事件映射逻辑：
 * - `messages` 模式的 AIMessageChunk（含 content）→ `text` 事件
 * - `updates` 模式的 tools 节点输出（ToolMessage）→ `tool_end` 事件
 * - `messages` 模式的 AIMessageChunk（含 tool_call_chunks）→ `tool_start` 事件
 *
 * @param stream - LangGraph stream() 返回的异步可迭代对象
 * @param onToolEnd - Scene.onToolEnd 生命周期回调（可选）
 */
export async function* transformStream(
  stream: AsyncIterable<any>,
  onToolEnd?: (toolName: string, result: any) => void,
): AsyncGenerator<SSEEvent> {
  for await (const chunk of stream) {
    const events = parseStreamChunk(chunk)
    for (const event of events) {
      yield event

      // 触发 Scene.onToolEnd 生命周期回调
      if (event.type === 'tool_end' && onToolEnd) {
        try {
          onToolEnd(event.toolName, event.output)
        } catch {
          // 生命周期回调异常不应影响流
        }
      }
    }
  }
}

/**
 * 解析单个 stream chunk 为 SSEEvent 数组。
 *
 * LangGraph `stream({ streamMode: ['messages', 'updates'] })` 产出的 chunk 格式：
 * - messages 模式: `['messages', [message, metadata]]`
 * - updates 模式: `['updates', { nodeName: { messages: [...] } }]`
 */
function parseStreamChunk(chunk: any): SSEEvent[] {
  const events: SSEEvent[] = []

  // 双 streamMode 下，chunk 是 [streamMode, data] 元组
  if (!Array.isArray(chunk) || chunk.length !== 2) return events

  const [mode, data] = chunk

  if (mode === 'messages') {
    // data = [message, metadata]
    // messages 模式下实际产出 MessageChunk，但 TS 推断为 BaseMessage
    const [message] = data as [BaseMessage, any]
    if (isAIMessageChunk(message as unknown as AIMessageChunk)) {
      const aiChunk = message as unknown as AIMessageChunk
      // 工具调用 chunk（tool_start 事件）
      if (aiChunk.tool_call_chunks && aiChunk.tool_call_chunks.length > 0) {
        for (const toolChunk of aiChunk.tool_call_chunks) {
          // 只在 name 出现时才 emit tool_start（第一个 chunk 包含 name）
          if (toolChunk.name) {
            events.push({
              type: 'tool_start',
              toolName: toolChunk.name,
              input: {}, // 工具入参通过后续 chunk 累积，初始为空
            })
          }
        }
      }

      // 文本内容 chunk（text 事件）
      const content = typeof aiChunk.content === 'string' ? aiChunk.content : ''
      if (content) {
        events.push({ type: 'text', content })
      }
    }
  }

  if (mode === 'updates') {
    // data = { nodeName: { messages: [...] } | nodeOutput }
    if (data && typeof data === 'object') {
      const nodeData = data as Record<string, any>

      // tools 节点的输出包含 ToolMessage
      if (nodeData.tools && nodeData.tools.messages) {
        const toolMessages = nodeData.tools.messages as BaseMessage[]
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

  return events
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

