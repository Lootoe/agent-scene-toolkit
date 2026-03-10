import { ChatOpenAI } from '@langchain/openai'
import { createAgent, createMiddleware } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { AgentOptions } from '../types'

/**
 * 构建单 Agent 图并返回双模式流。
 *
 * 使用 `createAgent` 创建 ReAct Agent，
 * 通过 `streamMode: ['messages', 'updates']` 同时获取：
 * - 逐 token 的文本流（messages 模式）
 * - 节点级别的完整更新（updates 模式，用于工具调用结果）
 *
 * Callbacks 在 LLM 层和 graph.stream() 层双重透传，
 * 确保观测工具能追踪完整 Agent 执行链路。
 *
 * ## 错误处理策略
 *
 * - **LLM 初始化异常**：ChatOpenAI 构造函数会在无效配置时抛出异常（如无效 API Key），
 *   由调用方（agent.ts）的顶层 try-catch 捕获并转换为 `error` 事件
 * - **Checkpointer 异常**：LangGraph 内部处理 checkpointer 加载/保存失败，
 *   失败时会降级为无记忆模式继续执行，不会中断流
 * - **工具执行异常**：LangGraph 内置异常处理，工具失败时会将错误信息作为 ToolMessage 返回给 LLM，
 *   由 LLM 决定如何处理（重试、跳过或报告用户）
 * - **流式输出异常**：stream() 过程中的网络异常或 LLM API 异常会抛出，
 *   由调用方的 try-catch 捕获
 *
 * @param params - 图构建参数
 * @returns 双模式流的异步可迭代对象
 * @throws 当 LLM 初始化失败或 stream() 执行失败时抛出异常
 */
export async function buildSingleGraph(params: {
  /** 完整的 system prompt（4 层拼接后） */
  systemPrompt: string
  /** 当前场景激活的工具列表 */
  tools: StructuredToolInterface[]
  /** Agent 模型标识 */
  model: string
  /** 用户消息 */
  message: string
  /** 对话线程 ID */
  threadId: string
  /** LangGraph Checkpointer */
  checkpointer: BaseCheckpointSaver
  /** 滑动窗口大小 */
  maxMessages: number
  /** LangChain Callbacks */
  callbacks: BaseCallbackHandler[]
  /** 底层 LLM 网关配置（OpenAI 兼容） */
  llm?: AgentOptions['llm']
}) {
  const hasCallbacks = params.callbacks.length > 0
  const callbacksOrUndefined = hasCallbacks ? params.callbacks : undefined

  // LLM 初始化 — 可能抛出异常（无效 API Key / baseURL）
  let llm: ChatOpenAI
  try {
    llm = new ChatOpenAI({
      model: params.model,
      apiKey: params.llm?.apiKey,
      configuration: params.llm?.baseURL ? { baseURL: params.llm.baseURL } : undefined,
      // LLM 层透传 callbacks — 追踪 LLM 调用本身
      callbacks: callbacksOrUndefined,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[buildSingleGraph] LLM initialization failed:', message)
    throw new Error(`Failed to initialize LLM: ${message}`)
  }

  console.log('[buildSingleGraph] systemPrompt:', JSON.stringify(params.systemPrompt))
  console.log('[buildSingleGraph] model:', params.model)
  console.log('[buildSingleGraph] tools:', params.tools.map(t => t.name))
  console.log('[buildSingleGraph] threadId:', params.threadId)
  console.log('[buildSingleGraph] maxMessages:', params.maxMessages)

  // 图构建 — 可能抛出异常（无效配置）
  let graph: ReturnType<typeof createAgent>
  try {
    graph = createAgent({
      model: llm,
      tools: params.tools,
      checkpointer: params.checkpointer,
      systemPrompt: params.systemPrompt,
      // 滑动窗口中间件 — beforeModel 阶段裁剪消息，Checkpointer 仍全量存储
      middleware: [
        createMiddleware({
          name: 'sliding-window',
          beforeModel: (state) => {
            try {
              const max = params.maxMessages
              if (!state.messages || state.messages.length <= max) return undefined
              return { messages: state.messages.slice(-max) }
            } catch (error) {
              // 中间件异常不应阻断流程，记录错误并返回原始 state
              console.error('[buildSingleGraph] sliding-window middleware error:', error)
              return undefined
            }
          },
        }),
      ],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[buildSingleGraph] Graph creation failed:', message)
    throw new Error(`Failed to create agent graph: ${message}`)
  }

  // stream() 调用 — 可能抛出异常（网络异常、LLM API 异常）
  try {
    return graph.stream(
      { messages: [new HumanMessage(params.message)] },
      {
        configurable: { thread_id: params.threadId },
        recursionLimit: 25,
        streamMode: ['messages', 'updates'],
        // graph 层透传 callbacks — 追踪完整执行链路（工具调用、节点跳转等）
        callbacks: callbacksOrUndefined,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[buildSingleGraph] Stream initialization failed:', message)
    throw new Error(`Failed to start agent stream: ${message}`)
  }
}

