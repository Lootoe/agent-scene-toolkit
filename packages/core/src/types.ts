import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import type { BaseCallbackHandler } from '@langchain/core/callbacks/base'

// ─── 核心概念 ────────────────────────────────────────────

/**
 * 静态能力包 — 按领域分组的工具集 + 使用策略提示词。
 *
 * @example
 * ```ts
 * const canvasToolKit = defineToolKit({
 *   name: 'canvas',
 *   tools: [bindElementTool, bindTrackTool],
 *   prompt: '画面调整时优先使用 canvas 工具...',
 * })
 * ```
 */
export interface ToolKit {
  /** 唯一标识（如 `'canvas'`、`'ai'`） */
  readonly name: string
  /** LangChain Tool 数组 */
  readonly tools: StructuredToolInterface[]
  /** 使用策略提示词，告诉 LLM 何时/如何使用这组工具 */
  readonly prompt: string
}

/**
 * 角色身份 — 极简声明：名字 + 系统提示词 + 模型。
 *
 * @example
 * ```ts
 * const director = defineProfile({
 *   name: '导演',
 *   systemPrompt: '你是一位视频导演...',
 *   model: 'gpt-4o',
 * })
 * ```
 */
export interface AgentProfile {
  /** 角色名称，多 Agent 时作为唯一标识 */
  readonly name: string
  /** 角色系统提示词 */
  readonly systemPrompt: string
  /** 模型标识（如 `'gpt-4o'`、`'gpt-4o-mini'`） */
  readonly model: string
}

/**
 * 运行时场景 — 声明当前需要的工具集 + 动态上下文提示词 + 生命周期回调。
 *
 * @example
 * ```ts
 * const timelineScene = defineScene({
 *   name: 'timeline-editing',
 *   toolkits: ['canvas', 'ai'],
 *   prompt: (ctx) => `视频时长: ${ctx.duration}秒`,
 *   onToolEnd: (toolName, result) => {
 *     if (toolName === 'bindTrack') refreshTimeline()
 *   },
 * })
 * ```
 */
export interface Scene {
  /** 场景名称 */
  readonly name: string
  /** 当前场景需要的 ToolKit 名称列表，从全局能力池中过滤 */
  readonly toolkits: string[]
  /** 动态提示词模板，接收运行时上下文数据（来自 `chat()` 的 `sceneContext`） */
  readonly prompt: (ctx: Record<string, any>) => string
  /** 工具调用完成后的生命周期回调 */
  readonly onToolEnd?: (toolName: string, result: any) => void
}

// ─── 配置项 ──────────────────────────────────────────────

/**
 * `createAgent()` 配置项。
 *
 * @example
 * ```ts
 * const agent = createAgent({
 *   toolkits: [canvasToolKit, aiToolKit],
 *   agents: [director, screenwriter],
 *   supervisor: '导演',
 *   scene: timelineScene,
 *   checkpointer: new MemorySaver(),
 *   maxMessages: 50,
 * })
 * ```
 */
export interface AgentOptions {
  /** 全局能力池，所有可用的 ToolKit */
  toolkits: ToolKit[]
  /** Agent 列表 */
  agents: AgentProfile[]
  /** Supervisor 的 Agent name，有值则启用多 Agent 模式 */
  supervisor?: string
  /** 运行时场景，决定工具集过滤和动态 Prompt */
  scene?: Scene
  /** LangGraph Checkpointer 实例（默认 MemorySaver） */
  checkpointer?: BaseCheckpointSaver
  /** 滑动窗口大小（默认 50） */
  maxMessages?: number
  /** LangChain Callbacks（如 LangFuse） */
  callbacks?: BaseCallbackHandler[]
  /** OpenAI 兼容网关配置（如中转商） */
  llm?: {
    /** 兼容 OpenAI 的 base URL，例如 https://api.bltcy.ai */
    baseURL?: string
    /** API Key，优先级高于环境变量 OPENAI_API_KEY */
    apiKey?: string
  }
}

/**
 * `agent.chat()` 调用参数。
 */
export interface ChatOptions {
  /** 用户消息 */
  message: string
  /** 对话线程 ID，用于记忆隔离 */
  threadId: string
  /** 传给 `scene.prompt(ctx)` 的动态运行时数据 */
  sceneContext?: Record<string, any>
}

// ─── SSE 事件协议 ────────────────────────────────────────

/**
 * 标准化 SSE 事件联合类型。
 *
 * | 类型 | 触发时机 |
 * |------|---------|
 * | `text` | LLM 输出文本 token |
 * | `tool_start` | 工具调用开始 |
 * | `tool_end` | 工具调用结束 |
 * | `handoff` | Agent 切换（多 Agent） |
 * | `agent` | 当前回答的 Agent 身份 |
 * | `error` | 执行出错 |
 * | `done` | 流结束 |
 */
export type SSEEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; toolName: string; input: Record<string, any> }
  | { type: 'tool_end'; toolName: string; output: any }
  | { type: 'handoff'; from: string; to: string }
  | { type: 'agent'; name: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

