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
 * ## 快速开始 — 最小示例
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
 *   llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
 * })
 *
 * // 5. 发起对话
 * for await (const event of agent.chat({ message: '你好', threadId: 'thread-001' })) {
 *   console.log(event)
 * }
 * ```
 *
 * ## 完整配置
 *
 * 展示所有可选字段：记忆持久化、滑动窗口、LangFuse 观测、Scene 生命周期回调、动态运行时上下文。
 *
 * ```typescript
 * import { createAgent, defineProfile, defineToolKit, defineScene } from '@lilo-agent/core'
 * import { MemorySaver } from '@langchain/langgraph'
 * import { CallbackHandler } from '@langfuse/langchain'
 *
 * const agent = createAgent({
 *   toolkits: [canvasToolKit, aiToolKit],
 *   agents: [director],
 *   scene: defineScene({
 *     name: 'timeline-editing',
 *     toolkits: ['canvas', 'ai'],
 *     prompt: (ctx) => `用户在时间线编辑器，视频时长: ${ctx.duration}秒`,
 *     onToolEnd: (toolName, result) => {           // 工具调用完成回调
 *       if (toolName === 'bindTrack') refreshTimeline()
 *     },
 *   }),
 *   checkpointer: new MemorySaver(),                // 记忆持久化（生产环境用 PostgresSaver）
 *   maxMessages: 50,                                // 滑动窗口大小（默认 50）
 *   callbacks: [new CallbackHandler()],             // LangFuse 观测回调
 *   llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
 * })
 *
 * // 传入 sceneContext 注入动态运行时数据 → scene.prompt(ctx)
 * for await (const event of agent.chat({
 *   message: '帮我调整第3秒的转场',
 *   threadId: 'thread-001',
 *   sceneContext: { duration: 30, currentTime: 3 },
 * })) {
 *   switch (event.type) {
 *     case 'text':       process.stdout.write(event.content); break
 *     case 'tool_start': console.log(`🔧 调用 ${event.toolName}`); break
 *     case 'tool_end':   console.log(`✅ ${event.toolName}`, event.output); break
 *     case 'error':      console.error(`❌ ${event.message}`); break
 *     case 'done':       console.log('\n--- 结束 ---'); break
 *   }
 * }
 * ```
 *
 * ## 多 Agent 模式
 *
 * 配置 `supervisor` 后自动启用 Supervisor 策略，Supervisor 根据任务自动 handoff 给合适的 Worker。
 *
 * ```typescript
 * const director = defineProfile({
 *   name: '导演',
 *   systemPrompt: '你是一位视频导演，负责统筹任务分派...',
 *   model: 'gpt-4o',
 * })
 * const screenwriter = defineProfile({
 *   name: '编剧',
 *   systemPrompt: '你是一位编剧，擅长剧本创作...',
 *   model: 'gpt-4o-mini',
 * })
 *
 * const agent = createAgent({
 *   toolkits: [canvasToolKit, aiToolKit],
 *   agents: [director, screenwriter],
 *   supervisor: '导演',                             // ← 指定 Supervisor，自动启用多 Agent
 *   llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
 * })
 *
 * for await (const event of agent.chat({ message: '写一个30秒的广告脚本', threadId: 'thread-002' })) {
 *   if (event.type === 'agent')   console.log(`🎭 ${event.name} 正在回答`)
 *   if (event.type === 'handoff') console.log(`🔀 ${event.from} → ${event.to}`)
 *   if (event.type === 'text')    process.stdout.write(event.content)
 * }
 * ```
 *
 * ## Express 集成
 *
 * ```typescript
 * import express from 'express'
 *
 * const app = express()
 * app.use(express.json())
 *
 * // 一行挂载 SSE 路由
 * app.post('/chat', agent.handleRequest())
 *
 * // 请求体：{ message: string, threadId: string, sceneContext?: Record<string, any> }
 * // 响应：SSE 事件流（text/event-stream）
 * //   data: {"type":"agent","name":"导演"}
 * //   data: {"type":"text","content":"我来帮你调整"}
 * //   data: {"type":"tool_start","toolName":"bindTrack","input":{"trackId":"t-01"}}
 * //   data: {"type":"tool_end","toolName":"bindTrack","output":{"success":true}}
 * //   data: {"type":"done"}
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

