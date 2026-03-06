/**
 * @lilo-agent/core
 *
 * Lightweight Agent orchestration library built on LangChain.
 */

// Core types
export type {
  ToolKit,
  AgentProfile,
  Scene,
  AgentOptions,
  ChatOptions,
  SSEEvent,
} from './types'

// Factory APIs
export { defineProfile } from './profile'
export { defineToolKit } from './toolkit'
export { defineScene } from './scene'

// Runtime APIs
export { createAgent, Agent } from './agent'
export { createExpressHandler } from './middleware'

// Advanced / low-level APIs
export { buildPromptChain } from './prompt'
export { buildSingleGraph } from './graph/single'
export { transformStream, formatSSE } from './sse'

