import { MemorySaver } from '@langchain/langgraph'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import { buildPromptChain } from './prompt'
import { buildSingleGraph } from './graph/single'
import { buildSupervisorGraph } from './graph/supervisor'
import { transformStream } from './sse'
import { createExpressHandler } from './middleware'
import type { RequestHandler } from 'express'
import type { AgentOptions, ChatOptions, SSEEvent } from './types'

/**
 * Agent 实例的内部已解析配置类型。
 *
 * 将可选字段填充为默认值后的完整配置。
 */
interface ResolvedOptions extends AgentOptions {
  maxMessages: number
  callbacks: BaseCallbackHandler[]
  checkpointer: BaseCheckpointSaver
}

/**
 * Agent 核心类。
 *
 * 串联完整流程：参数校验 → ToolKit 过滤 → Prompt 拼接 → 图构建 → 流式输出。
 *
 * 不直接 new，通过 `createAgent()` 工厂函数创建。
 */
export class Agent {
  /** @internal */
  readonly options: ResolvedOptions

  constructor(options: AgentOptions) {
    this.options = {
      maxMessages: 50,
      callbacks: [],
      checkpointer: new MemorySaver(),
      ...options,
    }
    this.validate()
  }

  /**
   * 发起对话，返回标准化 SSE 事件的异步生成器。
   *
   * 完整流程：
   * 1. ToolKit 过滤（Scene.toolkits 决定）
   * 2. Prompt 4 层拼接（Base → Profile → ToolKit → Scene）
   * 3. 构建 LangGraph 图 + stream
   * 4. 转换流事件 → 标准化 SSEEvent
   *
   * 任何异常均以 `error` + `done` 事件正常结束流，不崩溃。
   *
   * @param chatOptions - 对话参数
   * @yields 标准化 SSE 事件序列
   */
  async *chat(chatOptions: ChatOptions): AsyncGenerator<SSEEvent> {
    try {
      // 参数校验
      if (!chatOptions.message) {
        yield { type: 'error', message: 'message is required' }
        yield { type: 'done' }
        return
      }
      if (!chatOptions.threadId) {
        yield { type: 'error', message: 'threadId is required' }
        yield { type: 'done' }
        return
      }

      // 1. ToolKit 过滤 — Scene 决定当前可用的工具集
      const scene = this.options.scene
      const activeToolkits = scene
        ? this.options.toolkits.filter(tk => scene.toolkits.includes(tk.name))
        : this.options.toolkits
      const tools = activeToolkits.flatMap(tk => tk.tools)
      const toolkitPrompts = activeToolkits.map(tk => tk.prompt)

      // 2. 判断单/多 Agent 策略
      const isMultiAgent = this.options.agents.length > 1 && !!this.options.supervisor

      let stream: AsyncIterable<any>

      if (isMultiAgent) {
        // 多 Agent 模式：Supervisor + Workers
        const supervisorProfile = this.options.agents.find(
          a => a.name === this.options.supervisor,
        )!

        // Supervisor 的 prompt（4 层拼接）
        const supervisorPrompt = buildPromptChain({
          profile: supervisorProfile,
          toolkitPrompts,
          scene,
          sceneContext: chatOptions.sceneContext,
        })

        // 各 Worker 的 prompt（4 层拼接）
        const workerPrompts = new Map<string, string>()
        for (const profile of this.options.agents) {
          if (profile.name !== this.options.supervisor) {
            workerPrompts.set(
              profile.name,
              buildPromptChain({
                profile,
                toolkitPrompts,
                scene,
                sceneContext: chatOptions.sceneContext,
              }),
            )
          }
        }

        stream = await buildSupervisorGraph({
          supervisorPrompt,
          agents: this.options.agents,
          supervisorName: this.options.supervisor!,
          tools,
          workerPrompts,
          message: chatOptions.message,
          threadId: chatOptions.threadId,
          checkpointer: this.options.checkpointer,
          maxMessages: this.options.maxMessages,
          callbacks: this.options.callbacks,
          llm: this.options.llm,
        })
      } else {
        // 单 Agent 模式
        const profile = this.options.agents[0]
        const systemPrompt = buildPromptChain({
          profile,
          toolkitPrompts,
          scene,
          sceneContext: chatOptions.sceneContext,
        })

        stream = await buildSingleGraph({
          systemPrompt,
          tools,
          model: profile.model,
          message: chatOptions.message,
          threadId: chatOptions.threadId,
          checkpointer: this.options.checkpointer,
          maxMessages: this.options.maxMessages,
          callbacks: this.options.callbacks,
          llm: this.options.llm,
        })
      }

      // 4. 转换流事件 → 标准化 SSE 事件
      yield* transformStream(stream, scene?.onToolEnd)
      yield { type: 'done' }
    } catch (err) {
      const message = err instanceof Error
        ? `${err.message}${err.cause ? ` | cause: ${err.cause}` : ''}${err.stack ? `\n${err.stack}` : ''}`
        : String(err)
      console.error('[agent.chat] error:', message)
      yield { type: 'error', message }
      yield { type: 'done' }
    }
  }

  /**
   * 返回 Express RequestHandler，直接用于路由挂载。
   *
   * @example
   * ```ts
   * app.post('/chat', agent.handleRequest())
   * ```
   */
  handleRequest(): RequestHandler {
    return createExpressHandler(this)
  }

  /**
   * 参数校验 — 在构造时执行，快速失败。
   */
  private validate(): void {
    if (!this.options.agents.length) {
      throw new Error('At least one agent is required')
    }
    if (this.options.supervisor) {
      const found = this.options.agents.find(a => a.name === this.options.supervisor)
      if (!found) {
        throw new Error(`Supervisor "${this.options.supervisor}" not found in agents`)
      }
    }
    // 校验 Scene 引用的 ToolKit 是否都已注册
    if (this.options.scene) {
      const registeredNames = new Set(this.options.toolkits.map(tk => tk.name))
      for (const name of this.options.scene.toolkits) {
        if (!registeredNames.has(name)) {
          throw new Error(`Scene references toolkit "${name}" which is not registered`)
        }
      }
    }
  }
}

/**
 * 创建 Agent 实例。
 *
 * @param options - Agent 配置项
 * @returns Agent 实例
 *
 * @example
 * ```ts
 * const agent = createAgent({
 *   toolkits: [canvasToolKit],
 *   agents: [director],
 *   scene: timelineScene,
 * })
 *
 * for await (const event of agent.chat({ message: '你好', threadId: 'thread-001' })) {
 *   console.log(event)
 * }
 * ```
 */
export function createAgent(options: AgentOptions): Agent {
  return new Agent(options)
}

