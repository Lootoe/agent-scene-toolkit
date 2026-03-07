require('dotenv').config()

const express = require('express')
const path = require('path')
const { ChatOpenAI } = require('@langchain/openai')
const { tool } = require('@langchain/core/tools')
const { z } = require('zod')
const {
  createAgent,
  defineProfile,
  defineScene,
  defineToolKit,
} = require('@lilo-agent/core')

const app = express()
app.use(express.json())
app.use('/playground', express.static(path.join(__dirname, 'public')))

const AGENT_MODE = process.env.AGENT_MODE || 'multi' // 'single' | 'multi'

// ─── Demo Tools ────────────────────────────────────────

const calculatorTool = tool(
  async ({ expression }) => {
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '')
      const result = Function(`"use strict"; return (${sanitized})`)()
      return JSON.stringify({ expression, result: Number(result) })
    } catch {
      return JSON.stringify({ expression, error: 'invalid expression' })
    }
  },
  {
    name: 'calculator',
    description: 'Calculate a math expression. Use this for ANY math — never do mental math.',
    schema: z.object({
      expression: z.string().describe('Math expression, e.g. "12345 * 67890"'),
    }),
  }
)

const webSearchTool = tool(
  async ({ query }) => {
    return JSON.stringify({
      query,
      results: [
        { title: `Result #1 for "${query}"`, snippet: `Simulated info about "${query}".` },
        { title: `Result #2 for "${query}"`, snippet: `More data about "${query}".` },
      ],
    })
  },
  {
    name: 'web_search',
    description: 'Search the internet for real-time information.',
    schema: z.object({
      query: z.string().describe('Search keywords'),
    }),
  }
)

const fileWriteTool = tool(
  async ({ filename, content }) => {
    return JSON.stringify({ filename, bytesWritten: content.length, status: 'success' })
  },
  {
    name: 'file_write',
    description: 'Write content to a file. Use when you need to save generated content.',
    schema: z.object({
      filename: z.string().describe('File name, e.g. "output.txt"'),
      content: z.string().describe('File content to write'),
    }),
  }
)

// ─── Shared Config ─────────────────────────────────────

const llmConfig = {
  baseURL: process.env.LLM_BASE_URL || 'https://api3.wlai.vip/v1',
  apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
}
const defaultModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'

const toolkit = defineToolKit({
  name: 'debug',
  tools: [calculatorTool, webSearchTool, fileWriteTool],
  prompt: `Available tools:
- calculator: ALL math must go through this tool, never do mental math
- web_search: use when you need to look up information
- file_write: use when you need to save generated content to a file`,
})

const scene = defineScene({
  name: 'playground',
  toolkits: ['debug'],
  prompt: ctx => `env=${ctx.env || 'local'}`,
  onToolEnd: (toolName, result) => {
    console.log(`[onToolEnd] ${toolName}:`, JSON.stringify(result).slice(0, 200))
  },
})

// ─── Agent Profiles ────────────────────────────────────

// 单 Agent 模式：通用助手
const assistant = defineProfile({
  name: 'assistant',
  systemPrompt: '你叫喵呜，由喵箱公司开发！你是一个全能AI助手，擅长回答问题、做数学计算、搜索信息和编写文件。',
  model: defaultModel,
})

// 多 Agent 模式：3 个角色协作
const director = defineProfile({
  name: 'director',
  systemPrompt: `你是团队主管。你的职责：
- 分析用户需求，拆解为子任务
- 将研究类任务分配给 researcher
- 将编程/计算类任务分配给 coder
- 汇总各成员的工作结果，给出最终回答
- 如果任务简单无需分派，你可以直接回答`,
  model: defaultModel,
})

const researcher = defineProfile({
  name: 'researcher',
  systemPrompt: `你是研究员，擅长信息检索与分析。你的职责：
- 使用 web_search 工具搜索信息
- 整理搜索结果，提炼关键信息
- 将研究结论汇报给主管`,
  model: defaultModel,
})

const coder = defineProfile({
  name: 'coder',
  systemPrompt: `你是程序员，擅长计算与文件操作。你的职责：
- 使用 calculator 工具进行数学计算
- 使用 file_write 工具保存生成的内容
- 将计算结果或文件操作结果汇报给主管`,
  model: defaultModel,
})

// ─── 构建 Agent 实例 ───────────────────────────────────

const profiles = AGENT_MODE === 'multi'
  ? [director, researcher, coder]
  : [assistant]

const agent = createAgent({
  agents: profiles,
  toolkits: [toolkit],
  scene,
  llm: llmConfig,
  ...(AGENT_MODE === 'multi' ? { supervisor: 'director' } : {}),
})

// ─── Routes ────────────────────────────────────────────

app.get('/playground/api/agents', (_req, res) => {
  res.json(profiles.map(p => ({ name: p.name, model: p.model })))
})
app.get('/playground/api/scenes', (_req, res) => {
  res.json([{ name: scene.name, toolkits: scene.toolkits }])
})
app.get('/playground/api/config', (_req, res) => {
  res.json({
    mode: AGENT_MODE,
    supervisor: AGENT_MODE === 'multi' ? 'director' : null,
    baseURL: llmConfig.baseURL,
    model: defaultModel,
    hasApiKey: Boolean(llmConfig.apiKey),
  })
})
app.get('/playground/api/ping-llm', async (_req, res) => {
  try {
    const m = new ChatOpenAI({
      model: defaultModel,
      apiKey: llmConfig.apiKey,
      configuration: { baseURL: llmConfig.baseURL },
    })
    await m.invoke('reply with pong only')
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
app.post('/playground/api/chat', (req, _res, next) => {
  console.log('[chat] req.body:', JSON.stringify(req.body))
  next()
}, agent.handleRequest())

const port = Number(process.env.PORT || 3001)
app.listen(port, () => {
  console.log(`Playground: http://localhost:${port}/playground`)
  console.log(`  mode: ${AGENT_MODE}`)
  console.log(`  model: ${defaultModel}`)
  if (AGENT_MODE === 'multi') {
    console.log(`  supervisor: director`)
    console.log(`  workers: researcher, coder`)
  }
})

