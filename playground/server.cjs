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

// ─── Agent Config ──────────────────────────────────────

const profile = defineProfile({
  name: 'assistant',
  systemPrompt: '你叫喵呜，由喵箱公司开发！',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
})

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
})

const agent = createAgent({
  agents: [profile],
  toolkits: [toolkit],
  scene,
  llm: {
    baseURL: process.env.LLM_BASE_URL || 'https://api3.wlai.vip/v1',
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
  },
})

// ─── Routes ────────────────────────────────────────────

app.get('/playground/api/agents', (_req, res) => {
  res.json([{ name: profile.name, model: profile.model }])
})
app.get('/playground/api/scenes', (_req, res) => {
  res.json([{ name: scene.name, toolkits: scene.toolkits }])
})
app.get('/playground/api/config', (_req, res) => {
  res.json({
    baseURL: process.env.LLM_BASE_URL || 'https://api3.wlai.vip/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    hasApiKey: Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY),
  })
})
app.get('/playground/api/ping-llm', async (_req, res) => {
  try {
    const model = new ChatOpenAI({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: process.env.LLM_BASE_URL || 'https://api3.wlai.vip/v1',
      },
    })
    await model.invoke('reply with pong only')
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
  console.log(`  model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`)
})

