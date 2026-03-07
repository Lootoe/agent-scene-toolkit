import type { AgentProfile, Scene } from './types'

/**
 * 库内置基础指令 — 通用行为约束与 Agent 行为模式。
 *
 * 作为 Prompt 4 层拼接的第 ① 层，所有 Agent 共享。
 *
 * 核心设计：引导 LLM 以 Agent（自主代理）模式运行，而非被动问答。
 * ReAct 循环已由 LangGraph 引擎内置，此 prompt 负责引导 LLM 的思维方式。
 */
const BASE_PROMPT = `You are an autonomous AI agent. You can reason, plan, and take actions using the tools available to you.

## Core Behavior
- When given a task, break it down into steps, then execute each step using the appropriate tools.
- After each tool call, observe the result and decide the next action. Continue until the task is fully completed.
- If no tools are needed, respond directly with your knowledge.
- Never fabricate uncertain information. If you cannot complete a task, explain why honestly.

## Rules
- Respond in the same language as the user.
- Follow tool parameter schemas strictly — do not invent or omit required fields.
- When multiple tools are available, choose the most relevant one for the current step.`

/**
 * 构建 4 层 Prompt 拼接链。
 *
 * ```
 * ① Base       — 库内置固定指令（通用行为约束、防御性指令）
 * ② Profile    — agent.systemPrompt（角色身份）
 * ③ ToolKit    — 当前场景激活的 ToolKit.prompt（0~N 个）
 * ④ Scene      — scene.prompt(sceneContext)（仅绑定 Scene 时）
 * ```
 *
 * 各层以 `\n\n` 拼接，合并为单条 SystemMessage 字符串。
 *
 * @param params - 拼接所需的各层数据
 * @returns 完整的 system prompt 字符串
 */
export function buildPromptChain(params: {
  /** 当前 Agent 角色 */
  profile: AgentProfile
  /** 当前场景激活的 ToolKit prompt 列表 */
  toolkitPrompts: string[]
  /** 运行时场景（可选） */
  scene?: Scene
  /** 传给 scene.prompt(ctx) 的动态数据（可选） */
  sceneContext?: Record<string, any>
}): string {
  const layers: string[] = [
    // ① Base — 库内置固定指令
    BASE_PROMPT,
    // ② Profile — 角色身份提示词
    params.profile.systemPrompt,
    // ③ ToolKit — 当前场景激活的能力包提示词
    ...params.toolkitPrompts,
  ]

  // ④ Scene — 动态运行时上下文提示词
  if (params.scene) {
    try {
      const scenePrompt = params.scene.prompt(params.sceneContext ?? {})
      layers.push(scenePrompt)
    } catch (error) {
      // Scene.prompt() 异常不应阻断流程，记录错误并跳过该层
      console.error('[buildPromptChain] Scene.prompt() error:', error)
      layers.push(`[Scene context unavailable due to error: ${error instanceof Error ? error.message : String(error)}]`)
    }
  }

  return layers.filter(Boolean).join('\n\n')
}

