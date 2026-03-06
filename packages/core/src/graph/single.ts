import { ChatOpenAI } from '@langchain/openai'
import { createAgent } from 'langchain'
import { HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { AgentOptions } from '../types'

/**
 * 构建单 Agent 图并返回双模式流。
 *
 * 使用 LangGraph `createReactAgent` 创建 ReAct Agent，
 * 通过 `streamMode: ['messages', 'updates']` 同时获取：
 * - 逐 token 的文本流（messages 模式）
 * - 节点级别的完整更新（updates 模式，用于工具调用结果）
 *
 * @returns 双模式流的异步可迭代对象
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
  const llm = new ChatOpenAI({
    model: params.model,
    apiKey: params.llm?.apiKey,
    configuration: params.llm?.baseURL ? { baseURL: params.llm.baseURL } : undefined,
    callbacks: params.callbacks.length > 0 ? params.callbacks : undefined,
  })

  console.log('[buildSingleGraph] systemPrompt:', JSON.stringify(params.systemPrompt))
  console.log('[buildSingleGraph] model:', params.model)
  console.log('[buildSingleGraph] tools:', params.tools.map(t => t.name))
  console.log('[buildSingleGraph] threadId:', params.threadId)

  const graph = createAgent({
    model: llm,
    tools: params.tools,
    checkpointer: params.checkpointer,
    systemPrompt: params.systemPrompt,
  })

  return graph.stream(
    { messages: [new HumanMessage(params.message)] },
    {
      configurable: { thread_id: params.threadId },
      recursionLimit: 25,
      streamMode: ['messages', 'updates'],
    },
  )
}

