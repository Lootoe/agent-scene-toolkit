import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createSupervisor } from '@langchain/langgraph-supervisor'
import { HumanMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { AgentProfile, AgentOptions } from '../types'

/**
 * 构建多 Agent Supervisor 图并返回双模式流。
 *
 * 使用 `@langchain/langgraph-supervisor` 的 `createSupervisor` 构建：
 * - Supervisor 负责任务分析与分派
 * - Workers 为各 AgentProfile 对应的 ReAct Agent
 *
 * 工具在 Supervisor 级别不注入（Supervisor 只负责路由），
 * 所有工具注入到 Worker Agent 中，由 Scene 过滤后的工具集共享。
 *
 * @returns 双模式流的异步可迭代对象
 */
export async function buildSupervisorGraph(params: {
  /** Supervisor 的 Prompt（4 层拼接后，用于 Supervisor Agent） */
  supervisorPrompt: string
  /** 所有 AgentProfile 列表 */
  agents: AgentProfile[]
  /** Supervisor 的 agent name */
  supervisorName: string
  /** 当前场景激活的工具列表（所有 Worker 共享） */
  tools: StructuredToolInterface[]
  /** 各 Worker 的 Prompt 映射（profile.name → 4 层拼接后的 prompt） */
  workerPrompts: Map<string, string>
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

  // 为每个非 Supervisor 的 Agent 创建 Worker
  const workers = params.agents
    .filter(profile => profile.name !== params.supervisorName)
    .map(profile => {
      const workerLLM = new ChatOpenAI({
        model: profile.model,
        apiKey: params.llm?.apiKey,
        configuration: params.llm?.baseURL ? { baseURL: params.llm.baseURL } : undefined,
        callbacks: callbacksOrUndefined,
      })

      const workerPrompt = params.workerPrompts.get(profile.name) ?? profile.systemPrompt

      return createReactAgent({
        llm: workerLLM,
        tools: params.tools,
        name: profile.name,
        prompt: workerPrompt,
      })
    })

  // Supervisor 使用指定 profile 的 model
  const supervisorProfile = params.agents.find(p => p.name === params.supervisorName)!
  const supervisorLLM = new ChatOpenAI({
    model: supervisorProfile.model,
    apiKey: params.llm?.apiKey,
    configuration: params.llm?.baseURL ? { baseURL: params.llm.baseURL } : undefined,
    callbacks: callbacksOrUndefined,
  })

  console.log('[buildSupervisorGraph] supervisor:', params.supervisorName)
  console.log('[buildSupervisorGraph] workers:', workers.map((_, i) =>
    params.agents.filter(p => p.name !== params.supervisorName)[i]?.name,
  ))
  console.log('[buildSupervisorGraph] tools:', params.tools.map(t => t.name))
  console.log('[buildSupervisorGraph] threadId:', params.threadId)

  // 创建 Supervisor 图
  // 类型断言：createReactAgent 返回的 CompiledStateGraph 泛型参数
  // 与 createSupervisor 期望的类型存在 TS 层面的微小差异（BaseChannel vs BinaryOperatorAggregate），
  // 运行时完全兼容，此处用 as any 桥接
  const workflow = createSupervisor({
    agents: workers as any,
    llm: supervisorLLM,
    prompt: params.supervisorPrompt,
    // 保留完整消息历史，让前端能追踪 handoff 过程
    outputMode: 'full_history',
  })

  // compile 时注入 checkpointer
  const graph = workflow.compile({
    checkpointer: params.checkpointer,
  })

  return graph.stream(
    { messages: [new HumanMessage(params.message)] },
    {
      configurable: { thread_id: params.threadId },
      recursionLimit: 50, // 多 Agent 需要更高的递归限制
      streamMode: ['messages', 'updates'],
      callbacks: callbacksOrUndefined,
    },
  )
}

