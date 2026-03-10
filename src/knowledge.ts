import type { KnowledgeBase } from './types'

/**
 * 定义一个知识库。
 *
 * 校验必填字段后返回不可变对象。
 * 库内部自动将文本向量化并包装为 LangChain Tool，AI 根据 `description` 自主决定何时检索。
 *
 * @param input - 知识库配置
 * @returns 冻结的 KnowledgeBase 对象
 *
 * @example
 * ```ts
 * // 静态文本
 * const faqKB = defineKnowledgeBase({
 *   name: 'faq',
 *   description: '产品常见问题，当用户问功能、价格、退款等问题时检索',
 *   documents: ['7天内无理由退款', '基础版99元/月', '支持微信支付宝付款'],
 *   topK: 3,
 * })
 *
 * // 从数据库/API 动态加载
 * const dynamicKB = defineKnowledgeBase({
 *   name: 'dynamic-docs',
 *   description: '从数据库动态加载的文档',
 *   documents: async () => {
 *     const res = await fetch('/api/docs')
 *     return res.json()
 *   },
 * })
 * ```
 */
export function defineKnowledgeBase(input: KnowledgeBase): Readonly<KnowledgeBase> {
  if (!input.name) throw new Error('KnowledgeBase name is required')
  if (!input.description) throw new Error('KnowledgeBase description is required')
  // documents 可以是 string[] 或 () => Promise<string[]>
  if (!input.documents) throw new Error('KnowledgeBase documents is required')
  if (typeof input.documents !== 'function' && !Array.isArray(input.documents)) {
    throw new Error('KnowledgeBase documents must be a string[] or () => Promise<string[]>')
  }
  if (Array.isArray(input.documents) && input.documents.length === 0) {
    throw new Error('KnowledgeBase documents must not be empty')
  }
  if (input.topK !== undefined && (typeof input.topK !== 'number' || input.topK < 1)) {
    throw new Error('KnowledgeBase topK must be a positive number')
  }
  return Object.freeze({ ...input })
}

