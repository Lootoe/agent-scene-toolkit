# agent-scene-toolkit

Lightweight Agent orchestration library built on LangChain.

> **3 分钟上手**：定义 Profile → 定义 ToolKit → 创建 Agent → 对话。

## 核心概念

- **ToolKit**：静态能力包，按领域分组的工具集 + 使用策略 Prompt
- **AgentProfile**：角色身份，只需定义 name + systemPrompt + model
- **Scene**：运行时场景，注入动态上下文 + 决定当前可用的 ToolKit
- **KnowledgeBase**：知识库（RAG），纯文本数据 + 语义检索，AI 按需查阅

## 📦 Install

```bash
npm install agent-scene-toolkit @langchain/core @langchain/langgraph @langchain/openai langchain express
```

## 快速开始 — 最小示例

```typescript
import { createAgent, defineProfile, defineToolKit, defineScene } from 'agent-scene-toolkit'

// 1. 定义能力包
const canvasToolKit = defineToolKit({
  name: 'canvas',
  tools: [bindElementTool],
  prompt: '画面调整时优先使用 canvas 工具...',
})

// 2. 定义角色
const director = defineProfile({
  name: '导演',
  systemPrompt: '你是一位视频导演...',
  model: 'gpt-4o',
})

// 3. 定义场景
const timelineScene = defineScene({
  name: 'timeline-editing',
  toolkits: ['canvas'],
  prompt: (ctx) => `视频时长: ${ctx.duration}秒`,
})

// 4. 创建 Agent
const agent = createAgent({
  toolkits: [canvasToolKit],
  agents: [director],
  scene: timelineScene,
  llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
})

// 5. 发起对话
for await (const event of agent.chat({ message: '你好', threadId: 'thread-001' })) {
  console.log(event)
}
```

## 完整配置

展示所有可选字段：记忆持久化、滑动窗口、Scene 生命周期回调、动态运行时上下文。

```typescript
import { createAgent, defineProfile, defineToolKit, defineScene } from 'agent-scene-toolkit'
import { MemorySaver } from '@langchain/langgraph'

const agent = createAgent({
  toolkits: [canvasToolKit, aiToolKit],
  agents: [director],
  scene: defineScene({
    name: 'timeline-editing',
    toolkits: ['canvas', 'ai'],
    prompt: (ctx) => `用户在时间线编辑器，视频时长: ${ctx.duration}秒`,
    onToolEnd: (toolName, result) => {           // 工具调用完成回调
      if (toolName === 'bindTrack') refreshTimeline()
    },
  }),
  checkpointer: new MemorySaver(),                // 记忆持久化（生产环境用 PostgresSaver）
  maxMessages: 50,                                // 滑动窗口大小（默认 50）
  llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
})

// 传入 sceneContext 注入动态运行时数据 → scene.prompt(ctx)
for await (const event of agent.chat({
  message: '帮我调整第3秒的转场',
  threadId: 'thread-001',
  sceneContext: { duration: 30, currentTime: 3 },
})) {
  switch (event.type) {
    case 'text':       process.stdout.write(event.content); break
    case 'tool_start': console.log(`🔧 调用 ${event.toolName}`); break
    case 'tool_end':   console.log(`✅ ${event.toolName}`, event.output); break
    case 'error':      console.error(`❌ ${event.message}`); break
    case 'done':       console.log('\n--- 结束 ---'); break
  }
}
```

## 多 Agent 模式

配置 `supervisor` 后自动启用 Supervisor 策略，Supervisor 根据任务自动 handoff 给合适的 Worker。

```typescript
const director = defineProfile({
  name: '导演',
  systemPrompt: '你是一位视频导演，负责统筹任务分派...',
  model: 'gpt-4o',
})
const screenwriter = defineProfile({
  name: '编剧',
  systemPrompt: '你是一位编剧，擅长剧本创作...',
  model: 'gpt-4o-mini',
})

const agent = createAgent({
  toolkits: [canvasToolKit, aiToolKit],
  agents: [director, screenwriter],
  supervisor: '导演',                             // ← 指定 Supervisor，自动启用多 Agent
  llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
})

for await (const event of agent.chat({ message: '写一个30秒的广告脚本', threadId: 'thread-002' })) {
  if (event.type === 'agent')   console.log(`🎭 ${event.name} 正在回答`)
  if (event.type === 'handoff') console.log(`🔀 ${event.from} → ${event.to}`)
  if (event.type === 'text')    process.stdout.write(event.content)
}
```

## RAG 知识库

让 Agent 具备**按需检索外部知识**的能力。只需提供文本数据 + 嵌入模型，AI 自动判断何时检索。

### 基本用法

```typescript
import { createAgent, defineProfile, defineKnowledgeBase } from 'agent-scene-toolkit'
// 使用者自行选择嵌入模型（本地免费 / OpenAI / 其他）
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers'

// 1. 定义知识库
const faqKB = defineKnowledgeBase({
  name: 'faq',
  description: '产品常见问题，当用户问功能、价格、退款等问题时检索',
  documents: [
    '7天内无理由退款，联系客服即可办理',
    '基础版99元/月，专业版299元/月',
    '支持微信、支付宝、银行卡付款',
    '工作日 9:00-18:00 提供在线客服',
  ],
})

// 2. 创建 Agent，传入知识库 + 嵌入模型
const agent = createAgent({
  agents: [defineProfile({ name: '客服', systemPrompt: '你是产品客服...', model: 'gpt-4o' })],
  knowledgeBases: [faqKB],
  embeddings: new HuggingFaceTransformersEmbeddings({
    model: 'Xenova/all-MiniLM-L6-v2',
  }),
  llm: { baseURL: 'https://api.bltcy.ai', apiKey: 'sk-xxx' },
})

// 3. 对话 — AI 自动判断是否需要检索
for await (const event of agent.chat({ message: '怎么退款？', threadId: 't-1' })) {
  if (event.type === 'text') process.stdout.write(event.content)
}
```

### 从数据库 / API 动态加载

`documents` 支持异步函数，Agent 创建时自动调用加载数据：

```typescript
const dynamicKB = defineKnowledgeBase({
  name: 'product-docs',
  description: '产品操作手册',
  documents: async () => {
    // 从数据库加载
    const rows = await db.query('SELECT content FROM docs')
    return rows.map(r => r.content)

    // 或从 API 加载
    // const res = await fetch('https://my-api.com/docs')
    // return res.json()
  },
})
```

### 多知识库

AI 根据每个知识库的 `description` 自动选择检索哪个：

```typescript
const faqKB = defineKnowledgeBase({
  name: 'faq',
  description: '产品常见问题',
  documents: ['7天内无理由退款', ...],
})

const apiDocsKB = defineKnowledgeBase({
  name: 'api-docs',
  description: 'API 接口文档，当用户问技术集成、接口调用时检索',
  documents: ['POST /api/users 创建用户', ...],
  topK: 5,  // 返回前 5 条最相关结果（默认 3）
})

const agent = createAgent({
  agents: [developer],
  knowledgeBases: [faqKB, apiDocsKB],
  embeddings: new HuggingFaceTransformersEmbeddings({ model: 'Xenova/all-MiniLM-L6-v2' }),
  llm: { ... },
})
```

### SSE 事件

知识库检索复用 `tool_start` / `tool_end` 事件，**前端无需任何改动**：

```
data: {"type":"tool_start","toolName":"faq","input":{"query":"退款政策"}}
data: {"type":"tool_end","toolName":"faq","output":"7天内无理由退款，联系客服即可办理"}
data: {"type":"text","content":"根据我们的政策，7天内可以无理由退款..."}
```

### 嵌入模型选择

库不内置嵌入模型，由使用者自行选择：

```typescript
// 方案 A：本地免费模型（推荐）
import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/hf_transformers'
const embeddings = new HuggingFaceTransformersEmbeddings({ model: 'Xenova/all-MiniLM-L6-v2' })

// 方案 B：OpenAI Embeddings（需 API Key）
import { OpenAIEmbeddings } from '@langchain/openai'
const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' })
```

## Express 集成

```typescript
import express from 'express'

const app = express()
app.use(express.json())

// 一行挂载 SSE 路由
app.post('/chat', agent.handleRequest())

// 请求体：{ message: string, threadId: string, sceneContext?: Record<string, any> }
// 响应：SSE 事件流（text/event-stream）
//   data: {"type":"agent","name":"导演"}
//   data: {"type":"text","content":"我来帮你调整"}
//   data: {"type":"tool_start","toolName":"bindTrack","input":{"trackId":"t-01"}}
//   data: {"type":"tool_end","toolName":"bindTrack","output":{"success":true}}
//   data: {"type":"done"}
```

## 📡 SSE Event Protocol

| Event | Trigger | Payload |
|-------|---------|---------|
| `text` | LLM 输出文本 token | `{ content: string }` |
| `tool_start` | 工具调用开始 | `{ toolName: string, input: Record<string, any> }` |
| `tool_end` | 工具调用结束 | `{ toolName: string, output: any }` |
| `handoff` | Agent 切换（多 Agent） | `{ from: string, to: string }` |
| `agent` | 当前回答的 Agent 身份 | `{ name: string }` |
| `error` | 执行出错 | `{ message: string }` |
| `done` | 流结束 | `{}` |

## 📖 API Documentation

```bash
npm run docs
```

Generates TypeDoc documentation from TSDoc comments.

## 🛠️ Development

```bash
npm run build      # Build ESM + CJS + .d.ts
npm run dev        # Watch mode
npm run typecheck  # Type check
npm run playground # Launch debug playground
```

## 📄 License

MIT © [Lootoe](https://github.com/Lootoe)

