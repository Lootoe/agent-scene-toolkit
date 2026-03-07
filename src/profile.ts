import type { AgentProfile } from './types'

/**
 * 定义一个 Agent 角色身份。
 *
 * 校验必填字段后返回不可变对象。
 *
 * @param input - 角色配置
 * @returns 冻结的 AgentProfile 对象
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
export function defineProfile(input: AgentProfile): Readonly<AgentProfile> {
  if (!input.name) throw new Error('Profile name is required')
  if (!input.systemPrompt) throw new Error('Profile systemPrompt is required')
  if (!input.model) throw new Error('Profile model is required')
  return Object.freeze({ ...input })
}

