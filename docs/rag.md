# RAG（检索增强生成）

## 1. 用户需求

> 我需要 RAG 的能力。
> 数据源是纯文本。需要库帮我做向量化和语义检索。
> AI 按需检索，检索结果作为上下文留在消息历史中。
> 知识库是动态的（文本数据可以动态提供）。
> 嵌入模型不内置，由使用者传入 LangChain Embeddings 实例，库保持轻量。
> 向量存储使用内存（MemoryVectorStore），数据量不大。
> 这是一个第三方库，需要为下游开发者提供简洁的集成体验。

### 核心诉求

- 为 `agent-scene-toolkit` 添加 RAG 支持，使 Agent 具备**按需检索外部知识**的能力
- 使用者提供**纯文本数据** + **Embeddings 实例**，库负责向量化、存储、检索
- 库内部将知识库包装为 LangChain Tool，AI 自主决定何时检索
- 检索结果作为 ToolMessage 留在消息历史中，后续对话可引用
- 嵌入模型**不内置**，由使用者传入（如 HuggingFace 本地模型、OpenAI Embeddings 等）
- 向量存储使用**内存**（MemoryVectorStore），进程重启则重建
- 集成方式要足够简单，与现有 `defineToolKit`、`defineScene` 保持一致的声明式风格

### 使用者画像

下游开发者，使用 `agent-scene-toolkit` 构建 AI Agent 应用。
不需要了解 RAG 原理，只需提供文本数据和 Embeddings 实例即可接入。

---

## 2. 产品需求

### 2.1 功能清单

#### F1：defineKnowledgeBase 工厂函数

声明一个知识库，使用者指定名称、描述、文本数据。

```typescript
// 静态文本
const faqKB = defineKnowledgeBase({
  name: 'faq',
  description: '产品常见问题，当用户问功能、价格、退款等问题时检索',
  documents: ['7天内无理由退款', '基础版99元/月', '支持微信支付宝付款'],
})

// 从数据库/API 动态加载
const dynamicKB = defineKnowledgeBase({
  name: 'dynamic-docs',
  description: '从数据库动态加载的文档',
  documents: async () => {
    const res = await fetch('/api/docs')
    return res.json()
  },
})
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | ✅ | 知识库唯一标识，也作为 Tool 名称 |
| description | string | ✅ | 描述知识库用途，AI 据此判断何时检索 |
| documents | `string[] \| () => Promise<string[]>` | ✅ | 纯文本数据：静态数组或异步加载函数 |
| topK | number | ❌ | 返回最相关的前 K 条结果，默认 3 |

#### F2：createAgent 新增配置项

```typescript
const agent = createAgent({
  agents: [assistant],
  knowledgeBases: [faqKB, apiDocsKB],  // ← 新增：知识库列表
  embeddings: new HuggingFaceTransformersEmbeddings({  // ← 新增：嵌入模型
    model: 'Xenova/all-MiniLM-L6-v2',
  }),
  llm: { baseURL: '...', apiKey: '...' },
})
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| knowledgeBases | KnowledgeBase[] | ❌ | 知识库列表，有值则启用 RAG |
| embeddings | Embeddings | 条件必填 | 嵌入模型实例，当 knowledgeBases 存在时必填 |

#### F3：内部自动流程（对使用者透明）

1. Agent 创建时：解析 documents（静态数组直接使用，异步函数则调用获取） → Embeddings 向量化 → 存入内存向量存储
2. 每个知识库自动转换为一个 LangChain DynamicTool
3. Tool 注入 Agent 的工具列表中
4. 对话时 AI 根据 description 自主决定是否检索

#### F4：SSE 事件复用

检索过程复用现有 `tool_start` / `tool_end` 事件：

```
→ {"type":"tool_start","toolName":"faq","input":{"query":"退款政策"}}
→ {"type":"tool_end","toolName":"faq","output":["7天内无理由退款..."]}
→ {"type":"text","content":"根据我们的政策，7天内可以无理由退款..."}
```

前端无需任何改动。

### 2.2 业务流程图

```
使用者定义知识库 (defineKnowledgeBase)
        ↓
createAgent 接收 knowledgeBases + embeddings
        ↓
[初始化阶段] 解析 documents（静态数组 / 异步函数调用）
        ↓
[初始化阶段] 文本 → Embedding 向量化 → 内存向量存储
        ↓
[初始化阶段] 每个知识库 → 包装为 DynamicTool → 注入工具列表
        ↓
[对话阶段] 用户提问
        ↓
AI 判断是否需要检索（根据 description）
        ↓  需要
调用知识库 Tool → 语义检索 topK 条 → 返回结果
        ↓
检索结果作为 ToolMessage 进入消息历史
        ↓
AI 基于检索结果生成回答
```

### 2.3 边界情况处理

| 场景 | 处理策略 |
|------|---------|
| documents 为空数组 | defineKnowledgeBase 校验时抛出错误 |
| documents 是函数但返回空数组 | initVectorStores 跳过该知识库，打印 warning |
| documents 是函数但调用失败 | 抛出错误，Agent 初始化失败 |
| 有 knowledgeBases 但没传 embeddings | createAgent 校验时抛出错误 |
| 向量化过程失败 | 抛出错误，Agent 创建失败（快速失败） |
| 检索返回空结果 | 返回空数组，AI 自行决定如何回应用户 |
| 多个知识库 | AI 根据各自 description 选择检索哪个，可一轮对话中检索多个 |

---

## 3. UI 需求

*本功能为纯后端库能力，无 UI 需求*

---

## 4. 技术选型

### 4.1 嵌入模型接口

| 选项 | 方案 |
|------|------|
| 接口类型 | `@langchain/core` 的 `EmbeddingsInterface` |
| 具体实现 | 由使用者传入（不内置），支持任何 LangChain 兼容的 Embeddings |
| 已有依赖 | ✅ `@langchain/core` 已在 peerDependencies 中 |

**评估**：不新增任何依赖。`EmbeddingsInterface` 定义了 `embedDocuments(string[])` 和 `embedQuery(string)` 两个方法，足以覆盖向量化需求。

### 4.2 向量存储

| 选项 | 方案 |
|------|------|
| 存储方案 | **自实现内存向量存储** |
| 相似度算法 | 余弦相似度 |
| 排序策略 | 按相似度降序，返回 topK 条 |

**评估**：
- LangChain 新版已将 `MemoryVectorStore` 移入 `langchain/vectorstores/memory`（当前 `langchain` 包中不导出此路径）
- 自实现只需 ~50 行代码（存储向量 + 余弦相似度计算 + topK 排序），无需引入额外依赖
- 数据量不大的场景下，内存存储 + 暴力搜索完全足够

### 4.3 Tool 包装

| 选项 | 方案 |
|------|------|
| Tool 类型 | `DynamicTool`（来自 `@langchain/core/tools`） |
| 输入格式 | 纯字符串（AI 传入检索 query） |

**评估**：`DynamicTool` 接收 `string` 输入，正好匹配"AI 传入 query → 返回检索结果"的场景。已有依赖，无需新增。

### 4.4 依赖总结

| 依赖 | 状态 | 用途 |
|------|------|------|
| `@langchain/core` | ✅ 已有 | `EmbeddingsInterface`、`DynamicTool`、`Document` |
| 新增依赖 | ❌ 无 | 向量存储自实现，不引入额外包 |

---

## 5. 架构设计

### 5.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/knowledge.ts` | `defineKnowledgeBase()` 工厂函数，校验 + 冻结 |
| `src/rag.ts` | 向量存储、余弦相似度、Tool 构建 |

### 5.2 修改文件

| 文件 | 变更 |
|------|------|
| `src/types.ts` | 新增 `KnowledgeBase` 接口，`AgentOptions` 增加 `knowledgeBases` + `embeddings` |
| `src/agent.ts` | 构造函数中初始化向量存储，`chat()` 中合并知识库 Tool |
| `src/index.ts` | 导出新增的 `defineKnowledgeBase` 和 `KnowledgeBase` 类型 |

### 5.3 不变文件

`prompt.ts`、`graph/single.ts`、`graph/supervisor.ts`、`sse.ts`、`middleware.ts`、`scene.ts`、`profile.ts`、`toolkit.ts` 均**不修改**。

知识库 Tool 通过现有的工具注入机制进入 Agent，无需修改任何下游模块。

### 5.4 设计决策

| 决策 | 说明 |
|------|------|
| 向量化时机 | **Agent 构造时**（同步初始化，异步向量化）。`createAgent()` 改为 `async` 或 Agent 内部延迟初始化 |
| 延迟初始化 | 采用 `init()` 异步方法 + `ready` Promise 模式。`chat()` 首次调用时 await ready |
| 工具注入点 | `chat()` 方法中，ToolKit 过滤后合并 knowledgeTools |
| 余弦相似度 | 自实现，无外部依赖。`dot(a,b) / (norm(a) * norm(b))` |

### 5.5 初始化流程（延迟模式）

```
createAgent(options)          ← 同步，立即返回 Agent 实例
  └─ constructor()
       ├─ validate()          ← 校验 knowledgeBases + embeddings 配套
       └─ this.readyPromise = this.init()  ← 启动异步初始化

agent.chat()                  ← 首次 chat 时 await readyPromise
  └─ await this.readyPromise
       └─ initVectorStores()  ← embedDocuments → 存储向量
            └─ buildKnowledgeTools()  ← 构建 DynamicTool[]
```

好处：`createAgent()` 保持同步调用（不破坏现有 API），向量化在后台自动完成。

---

## 6. 代码设计

### 6.1 类型定义（types.ts 新增）

```typescript
import type { EmbeddingsInterface } from '@langchain/core/embeddings'

/** 知识库配置 */
interface KnowledgeBase {
  readonly name: string           // 唯一标识，也作为 Tool 名称
  readonly description: string    // AI 据此判断何时检索
  readonly documents: string[] | (() => Promise<string[]>)  // 静态数组或异步加载函数
  readonly topK?: number          // 返回条数，默认 3
}

// AgentOptions 新增字段：
interface AgentOptions {
  // ...existing...
  knowledgeBases?: KnowledgeBase[]
  embeddings?: EmbeddingsInterface
}
```

### 6.2 knowledge.ts

```typescript
function defineKnowledgeBase(input: KnowledgeBase): Readonly<KnowledgeBase>
```

校验规则：
- name、description 非空
- documents 必须是 `string[]`（非空）或 `() => Promise<string[]>`
- topK 若提供则必须为正整数

返回冻结对象。风格与 `defineToolKit`、`defineScene` 一致。

### 6.3 rag.ts — 核心模块

```typescript
/** 内存中的单条向量记录 */
interface VectorRecord {
  text: string
  vector: number[]
}

/** 单个知识库的向量存储 */
interface VectorStore {
  kb: KnowledgeBase
  records: VectorRecord[]
}

/**
 * 初始化所有知识库的向量存储
 * - 解析 documents（静态数组直接使用，函数则 await 调用）
 * - 调用 embeddings.embedDocuments() 批量向量化
 * - 返回 VectorStore[]
 */
async function initVectorStores(
  knowledgeBases: KnowledgeBase[],
  embeddings: EmbeddingsInterface,
): Promise<VectorStore[]>

/**
 * 余弦相似度计算
 */
function cosineSimilarity(a: number[], b: number[]): number

/**
 * 语义检索 — 对单个 VectorStore 执行 topK 检索
 */
async function searchVectorStore(
  store: VectorStore,
  query: string,
  embeddings: EmbeddingsInterface,
): Promise<string[]>

/**
 * 将 VectorStore[] 转换为 DynamicTool[]
 * - 每个知识库 → 一个 DynamicTool
 * - Tool.name = kb.name
 * - Tool.description = kb.description
 * - Tool.func = (query) => searchVectorStore(...)
 */
function buildKnowledgeTools(
  stores: VectorStore[],
  embeddings: EmbeddingsInterface,
): DynamicTool[]
```

### 6.4 agent.ts 变更

```typescript
class Agent {
  private knowledgeTools: DynamicTool[] = []
  private readyPromise: Promise<void>

  constructor(options: AgentOptions) {
    // ...existing...
    this.readyPromise = this.init()
  }

  private async init(): Promise<void> {
    if (this.options.knowledgeBases?.length) {
      const stores = await initVectorStores(
        this.options.knowledgeBases,
        this.options.embeddings!,
      )
      this.knowledgeTools = buildKnowledgeTools(stores, this.options.embeddings!)
    }
  }

  async *chat(chatOptions: ChatOptions): AsyncGenerator<SSEEvent> {
    await this.readyPromise  // ← 确保向量化完成

    // ToolKit 过滤后，合并 knowledgeTools
    const tools = [
      ...activeToolkits.flatMap(tk => tk.tools),
      ...this.knowledgeTools,  // ← 新增
    ]
    // ...rest unchanged...
  }

  private validate(): void {
    // ...existing...
    // 新增校验：有 knowledgeBases 但没有 embeddings
    if (this.options.knowledgeBases?.length && !this.options.embeddings) {
      throw new Error('embeddings is required when knowledgeBases is provided')
    }
  }
}
```

### 6.5 index.ts 新增导出

```typescript
export type { KnowledgeBase } from './types'
export { defineKnowledgeBase } from './knowledge'
```

---

## 7. 开发计划

### Step 1：定义 RAG 类型
- 在 `types.ts` 中添加 `KnowledgeBase` 接口
- 在 `AgentOptions` 中添加 `knowledgeBases` + `embeddings` 字段
- 状态：✅ 已完成

### Step 2：创建 defineKnowledgeBase 工厂函数
- 创建 `src/knowledge.ts`
- 实现 `defineKnowledgeBase()`，校验 + 冻结
- 状态：✅ 已完成

### Step 3：实现 RAG 核心模块
- 创建 `src/rag.ts`
- 实现 `initVectorStores()`：调用 Embeddings 批量向量化
- 实现 `cosineSimilarity()`：余弦相似度计算
- 实现 `searchVectorStore()`：语义检索 topK 条
- 实现 `buildKnowledgeTools()`：VectorStore → DynamicTool
- 状态：✅ 已完成

### Step 4：在 Agent 中集成 RAG
- 修改 `agent.ts`：构造函数中启动异步初始化（readyPromise）
- 修改 `agent.ts`：`chat()` 中 await readyPromise + 合并 knowledgeTools
- 修改 `agent.ts`：`validate()` 中新增 knowledgeBases/embeddings 配套校验
- 状态：✅ 已完成

### Step 5：更新导出
- 修改 `src/index.ts`：导出 `KnowledgeBase` 类型和 `defineKnowledgeBase` 函数
- 状态：✅ 已完成

### Step 6：验证构建
- 运行 `typecheck` 和 `build` 确保无错误
- 状态：✅ 已完成

### Step 7（迭代）：支持 documents 异步加载
- `types.ts`：`documents` 类型从 `string[]` 扩展为 `string[] | () => Promise<string[]>`
- `knowledge.ts`：校验逻辑适配两种类型
- `rag.ts`：`initVectorStores` 中先判断 documents 类型再解析
- 状态：✅ 已完成

