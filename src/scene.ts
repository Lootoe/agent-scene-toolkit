import type { Scene } from './types'

/**
 * 定义一个运行时场景。
 *
 * 校验必填字段后返回不可变对象。
 *
 * @param input - 场景配置
 * @returns 冻结的 Scene 对象
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
export function defineScene(input: Scene): Readonly<Scene> {
  if (!input.name) throw new Error('Scene name is required')
  if (!input.toolkits?.length) throw new Error('Scene toolkits must not be empty')
  if (typeof input.prompt !== 'function') throw new Error('Scene prompt must be a function')
  return Object.freeze({ ...input })
}

