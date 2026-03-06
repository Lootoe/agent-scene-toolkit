import type { ToolKit } from './types'

/**
 * 定义一个静态能力包。
 *
 * 校验必填字段后返回不可变对象。
 *
 * @param input - 能力包配置
 * @returns 冻结的 ToolKit 对象
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
export function defineToolKit(input: ToolKit): Readonly<ToolKit> {
  if (!input.name) throw new Error('ToolKit name is required')
  if (!input.tools?.length) throw new Error('ToolKit tools must not be empty')
  if (!input.prompt) throw new Error('ToolKit prompt is required')
  return Object.freeze({ ...input })
}

