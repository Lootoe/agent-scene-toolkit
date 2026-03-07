import type { Request, RequestHandler, Response } from 'express'
import type { Agent } from './agent'
import { formatSSE } from './sse'
import type { ChatOptions } from './types'

/**
 * 写入 SSE 必要响应头。
 */
function writeSSEHeaders(res: Response): void {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

/**
 * 从请求体中提取 chat 参数。
 */
function parseChatOptions(req: Request): ChatOptions {
  const body = (req.body ?? {}) as Partial<ChatOptions>
  return {
    message: typeof body.message === 'string' ? body.message : '',
    threadId: typeof body.threadId === 'string' ? body.threadId : '',
    sceneContext: body.sceneContext,
  }
}

/**
 * 为 Agent 创建 Express SSE 处理器。
 *
 * 请求体格式：
 * {
 *   "message": "...",
 *   "threadId": "...",
 *   "sceneContext": { ... }
 * }
 */
export function createExpressHandler(agent: Agent): RequestHandler {
  return async (req: Request, res: Response) => {
    writeSSEHeaders(res)

    try {
      const chatOptions = parseChatOptions(req)
      for await (const event of agent.chat(chatOptions)) {
        res.write(formatSSE(event))
      }
    } catch (error) {
      res.write(
        formatSSE({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      res.write(formatSSE({ type: 'done' }))
    } finally {
      res.end()
    }
  }
}

