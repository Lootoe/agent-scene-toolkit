/**
 * @lilo-agent/core
 *
 * Lightweight Agent orchestration library built on LangChain.
 *
 * ## 核心概念
 *
 * - **ToolKit**：静态能力包，按领域分组的工具集 + 使用策略 Prompt
 * - **AgentProfile**：角色身份，只需定义 name + systemPrompt + model
 * - **Scene**：运行时场景，注入动态上下文 + 决定当前可用的 ToolKit
 *
 * ## 快速开始
 *
 * ```typescript
 * import { createAgent, defineProfile, defineToolKit, defineScene } from '@lilo-agent/core'
 *
 * // 1. 定义能力包
 * const canvasToolKit = defineToolKit({
 *   name: 'canvas',
 *   tools: [bindElementTool],
 *   prompt: '画面调整时优先使用 canvas 工具...',
 * })
 *
 * // 2. 定义角色
 * const director = defineProfile({
 *   name: '导演',
 *   systemPrompt: '你是一位视频导演...',
 *   model: 'gpt-4o',
 * })
 *
 * // 3. 定义场景
 * const timelineScene = defineScene({
 *   name: 'timeline-editing',
 *   toolkits: ['canvas'],
 *   prompt: (ctx) => `视频时长: ${ctx.duration}秒`,
 * })
 *
 * // 4. 创建 Agent
 * const agent = createAgent({
 *   toolkits: [canvasToolKit],
 *   agents: [director],
 *   scene: timelineScene,
 *   llm: {
 *     baseURL: 'https://api.bltcy.ai',
 *     apiKey: 'sk-xxx',
 *   },
 * })
 *
 * // 5. 发起对话
 * for await (const event of agent.chat({ message: '你好', threadId: 'thread-001' })) {
 *   console.log(event)
 * }
 * ```
 *
 * @packageDocumentation
 */

// ─── Core Types ──────────────────────────────────────────────

/**
 * 核心类型定义。
 *
 * @category Core Concepts
 */
export type {
  ToolKit,
  AgentProfile,
  Scene,
  AgentOptions,
  ChatOptions,
  SSEEvent,
} from './types'

// ─── Factory Functions ───────────────────────────────────────

/**
 * 定义 Agent 角色身份。
 *
 * @category Factory Functions
 */
export { defineProfile } from './profile'

/**
 * 定义静态能力包。
 *
 * @category Factory Functions
 */
export { defineToolKit } from './toolkit'

/**
 * 定义运行时场景。
 *
 * @category Factory Functions
 */
export { defineScene } from './scene'

// ─── Runtime APIs ────────────────────────────────────────────

/**
 * 创建 Agent 实例。
 *
 * @category Runtime
 */
export { createAgent, Agent } from './agent'

/**
 * 创建 Express SSE 处理器。
 *
 * @category Runtime
 */
export { createExpressHandler } from './middleware'

// ─── Advanced APIs ───────────────────────────────────────────

/**
 * 构建 4 层 Prompt 拼接链（高级 API）。
 *
 * @category Advanced
 */
export { buildPromptChain } from './prompt'

/**
 * 构建单 Agent 图（高级 API）。
 *
 * @category Advanced
 */
export { buildSingleGraph } from './graph/single'

/**
 * 构建多 Agent Supervisor 图（高级 API）。
 *
 * @category Advanced
 */
export { buildSupervisorGraph } from './graph/supervisor'

/**
 * SSE 流转换与格式化工具（高级 API）。
 *
 * @category Advanced
 */
export { transformStream, formatSSE } from './sse'

