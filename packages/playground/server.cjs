require('dotenv').config()

const express = require('express')
const path = require('path')
const { ChatOpenAI } = require('@langchain/openai')
const { DynamicTool } = require('@langchain/core/tools')
const {
  createAgent,
  defineProfile,
  defineScene,
  defineToolKit,
} = require('@lilo-agent/core')

const app = express()
app.use(express.json())
app.use('/playground', express.static(path.join(__dirname, 'public')))

const pingTool = new DynamicTool({
  name: 'ping',
  description: '测试工具调用链路',
  func: async input => `pong: ${String(input ?? '')}`,
})

const profile = defineProfile({
  name: '助手',
  systemPrompt: '你是调试助手。简洁回答。需要测试工具时调用 ping。',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
})

const toolkit = defineToolKit({
  name: 'debug',
  tools: [pingTool],
  prompt: '当用户说“测试工具”时调用 ping。',
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
app.post('/playground/api/chat', (req, res, next) => {
  console.log('[chat] req.body:', JSON.stringify(req.body))
  next()
}, agent.handleRequest())

const port = Number(process.env.PORT || 3001)
app.listen(port, () => {
  const resolvedBaseURL = process.env.LLM_BASE_URL || 'https://api.bltcy.ai/v1'
  const resolvedModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const resolvedKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY
  console.log(`✅ Playground: http://localhost:${port}/playground`)
  console.log(`   baseURL : ${resolvedBaseURL}`)
  console.log(`   model   : ${resolvedModel}`)
  console.log(`   apiKey  : ${resolvedKey ? resolvedKey.slice(0, 8) + '...' : '❌ NOT SET'}`)
})

