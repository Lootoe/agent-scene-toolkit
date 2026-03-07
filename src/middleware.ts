import type { Request, RequestHandler, Response } from 'express'
import type { Agent } from './agent'
import { formatSSE } from './sse'
import type { ChatOptions, SSEEvent } from './types'

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
 *
 * ## 错误处理
 *
 * - **请求体解析异常**：parseChatOptions 失败时返回 `error` 事件
 * - **agent.chat() 异常**：流迭代过程中的异常会被捕获并转换为 `error` 事件
 * - **响应写入异常**：res.write() 失败时（客户端断开连接）静默捕获，避免服务器崩溃
 * - **所有异常路径**：确保最终都会发送 `done` 事件并关闭响应
 */
export function createExpressHandler(agent: Agent): RequestHandler {
  return async (req: Request, res: Response) => {
    // 写入 SSE 响应头
    try {
      writeSSEHeaders(res)
    } catch (error) {
      // 响应头写入失败（极少见），记录错误并尝试返回 500
      console.error('[createExpressHandler] Failed to write SSE headers:', error)
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to initialize SSE stream' })
      }
      return
    }

    // 安全写入 SSE 事件 — 捕获客户端断开连接等异常
    const safeWrite = (event: SSEEvent): boolean => {
      try {
        return res.write(formatSSE(event))
      } catch (error) {
        // 客户端断开连接时 res.write() 会抛出异常，静默捕获
        console.error('[createExpressHandler] Failed to write SSE event:', error)
        return false
      }
    }

    try {
      const chatOptions = parseChatOptions(req)

      // 迭代 agent.chat() 流
      for await (const event of agent.chat(chatOptions)) {
        const success = safeWrite(event)
        // 如果写入失败（客户端断开），提前退出循环
        if (!success && event.type !== 'done') {
          console.warn('[createExpressHandler] Client disconnected, stopping stream')
          break
        }
      }
    } catch (error) {
      // agent.chat() 或流迭代异常
      const message = error instanceof Error ? error.message : String(error)
      console.error('[createExpressHandler] Stream error:', message)
      safeWrite({ type: 'error', message })
      safeWrite({ type: 'done' })
    } finally {
      // 确保响应最终关闭
      try {
        res.end()
      } catch (error) {
        // res.end() 失败（客户端已断开），静默捕获
        console.error('[createExpressHandler] Failed to end response:', error)
      }
    }
  }
}

