import type { AgentProfile, Scene } from './types'

/**
 * 库内置基础指令 — 通用行为约束与防御性指令。
 *
 * 作为 Prompt 4 层拼接的第 ① 层，所有 Agent 共享。
 */
const BASE_PROMPT = `你是一个AI助手。请遵循以下规则：
- 使用与用户相同的语言回复
- 不要编造不确定的信息
- 工具调用时严格按照参数 schema`

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
    layers.push(params.scene.prompt(params.sceneContext ?? {}))
  }

  return layers.filter(Boolean).join('\n\n')
}

