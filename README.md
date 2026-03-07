# agent-scene-toolkit

Lightweight Agent orchestration library built on LangChain, with unified SSE streaming.

> **3 分钟上手**：定义 Profile → 定义 ToolKit → 创建 Agent → 对话。

## ✨ Features

- **ToolKit**（静态能力包）：按领域分组的工具集 + 使用策略 Prompt
- **Profile**（角色身份）：只需定义 name + systemPrompt + model
- **Scene**（运行时上下文）：注入动态业务状态 + 工具集过滤
- **单/多 Agent 自动切换**：配置 `supervisor` 即启用多 Agent 协作
- **标准化 SSE 事件流**：`text` / `tool_start` / `tool_end` / `handoff` / `agent` / `error` / `done`
- **Express 一行集成**：`app.post('/chat', agent.handleRequest())`

## 📦 Install

```bash
npm install agent-scene-toolkit @langchain/core @langchain/langgraph @langchain/openai langchain express
```

## 🚀 Quick Start

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
  llm: { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-xxx' },
})

// 5. 发起对话
for await (const event of agent.chat({ message: '你好', threadId: 'thread-001' })) {
  console.log(event)
}
```

## 🤝 Multi-Agent

配置 `supervisor` 后自动启用 Supervisor 策略：

```typescript
const agent = createAgent({
  toolkits: [canvasToolKit, aiToolKit],
  agents: [director, screenwriter],
  supervisor: '导演', // ← 指定 Supervisor
  llm: { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-xxx' },
})
```

## 🌐 Express Integration

```typescript
import express from 'express'

const app = express()
app.use(express.json())
app.post('/chat', agent.handleRequest())
```

## 📡 SSE Event Protocol

| Event | Trigger | Payload |
|-------|---------|---------|
| `text` | LLM outputs text token | `{ content: string }` |
| `tool_start` | Tool call begins | `{ toolName: string, input: Record<string, any> }` |
| `tool_end` | Tool call ends | `{ toolName: string, output: any }` |
| `handoff` | Agent switch (multi-agent) | `{ from: string, to: string }` |
| `agent` | Current answering agent | `{ name: string }` |
| `error` | Execution error | `{ message: string }` |
| `done` | Stream ends | `{}` |

## ⚙️ Full Configuration

```typescript
const agent = createAgent({
  toolkits: [canvasToolKit, aiToolKit],   // Global toolkit pool
  agents: [director],                      // Agent profiles
  supervisor: '导演',                      // Optional: enables multi-agent
  scene: timelineScene,                    // Optional: runtime context + tool filtering
  checkpointer: new MemorySaver(),         // Optional: memory persistence
  maxMessages: 50,                         // Optional: sliding window size
  callbacks: [langfuseHandler],            // Optional: LangChain callbacks (e.g. LangFuse)
  llm: {                                  // Optional: OpenAI-compatible gateway
    baseURL: 'https://api.openai.com/v1',
    apiKey: 'sk-xxx',
  },
})
```

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

