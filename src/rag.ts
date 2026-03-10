import { DynamicTool } from '@langchain/core/tools'
import type { EmbeddingsInterface } from '@langchain/core/embeddings'
import type { KnowledgeBase } from './types'

// ─── 内部数据结构 ────────────────────────────────────────

/** 内存中的单条向量记录 */
interface VectorRecord {
  /** 原始文本 */
  text: string
  /** 嵌入向量 */
  vector: number[]
}

/** 单个知识库的向量存储 */
interface VectorStore {
  /** 知识库配置（含 name、description、topK） */
  kb: KnowledgeBase
  /** 向量记录列表 */
  records: VectorRecord[]
}

// ─── 向量数学 ────────────────────────────────────────────

/**
 * 计算两个向量的余弦相似度。
 *
 * cosine(a, b) = dot(a, b) / (‖a‖ × ‖b‖)
 *
 * @returns [-1, 1] 之间的相似度值，越大越相似
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// ─── 向量存储初始化 ──────────────────────────────────────

/**
 * 初始化所有知识库的向量存储。
 *
 * 对每个 KnowledgeBase，调用 `embeddings.embedDocuments()` 批量向量化文本，
 * 然后将文本与向量配对存入内存。
 *
 * @param knowledgeBases - 知识库列表
 * @param embeddings - 嵌入模型实例
 * @returns 向量存储列表
 * @throws 当任一知识库的向量化失败时抛出异常
 */
export async function initVectorStores(
  knowledgeBases: KnowledgeBase[],
  embeddings: EmbeddingsInterface,
): Promise<VectorStore[]> {
  const stores: VectorStore[] = []

  for (const kb of knowledgeBases) {
    try {
      // 解析 documents：支持静态数组或异步加载函数
      const docs = typeof kb.documents === 'function'
        ? await kb.documents()
        : kb.documents

      if (!docs.length) {
        console.warn(`[initVectorStores] "${kb.name}" has no documents, skipping`)
        continue
      }

      console.log(`[initVectorStores] Embedding "${kb.name}" (${docs.length} documents)...`)
      const vectors = await embeddings.embedDocuments(docs)

      const records: VectorRecord[] = docs.map((text, i) => ({
        text,
        vector: vectors[i],
      }))

      stores.push({ kb, records })
      console.log(`[initVectorStores] "${kb.name}" ready (${records.length} vectors, dim=${vectors[0]?.length ?? 0})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[initVectorStores] Failed to embed "${kb.name}":`, message)
      throw new Error(`Failed to initialize knowledge base "${kb.name}": ${message}`)
    }
  }

  return stores
}

// ─── 语义检索 ────────────────────────────────────────────

/**
 * 对单个向量存储执行语义检索。
 *
 * 将 query 向量化后，与存储中的所有向量计算余弦相似度，
 * 返回相似度最高的 topK 条文本。
 *
 * @param store - 向量存储
 * @param query - 检索查询文本
 * @param embeddings - 嵌入模型实例
 * @returns 相似度最高的 topK 条文本
 */
async function searchVectorStore(
  store: VectorStore,
  query: string,
  embeddings: EmbeddingsInterface,
): Promise<string[]> {
  const topK = store.kb.topK ?? 3
  const queryVector = await embeddings.embedQuery(query)

  // 计算每条记录与 query 的相似度
  const scored = store.records.map(record => ({
    text: record.text,
    score: cosineSimilarity(queryVector, record.vector),
  }))

  // 按相似度降序排序，取 topK
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).map(item => item.text)
}

// ─── Tool 构建 ───────────────────────────────────────────

/**
 * 将向量存储列表转换为 DynamicTool 列表。
 *
 * 每个知识库 → 一个 DynamicTool：
 * - `name` = kb.name
 * - `description` = kb.description
 * - `func(query)` = 语义检索 topK 条文本
 *
 * @param stores - 向量存储列表
 * @param embeddings - 嵌入模型实例
 * @returns DynamicTool 列表，可直接注入 Agent 工具列表
 */
export function buildKnowledgeTools(
  stores: VectorStore[],
  embeddings: EmbeddingsInterface,
): DynamicTool[] {
  return stores.map(store => new DynamicTool({
    name: store.kb.name,
    description: store.kb.description,
    func: async (query: string) => {
      try {
        const results = await searchVectorStore(store, query, embeddings)
        if (results.length === 0) {
          return 'No relevant information found.'
        }
        return results.join('\n\n---\n\n')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[buildKnowledgeTools] Search failed for "${store.kb.name}":`, message)
        return `Search failed: ${message}`
      }
    },
  }))
}

