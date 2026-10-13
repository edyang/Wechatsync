/**
 * Sync Assistant MCP Server
 *
 * 支持两种模式：
 * 1. stdio 模式（推荐）: claude mcp add sync-assistant node dist/index.js
 * 2. SSE 模式: 先启动服务，再 claude mcp add --transport sse sync-assistant http://localhost:9528/sse
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import express, { type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { timingSafeEqual } from 'node:crypto'
import { ExtensionBridge } from './ws-bridge.js'
import type { PlatformInfo, SyncResult } from './types.js'

const WS_PORT = parseInt(process.env.SYNC_WS_PORT || '9527', 10)
const WS_HOST = process.env.SYNC_WS_HOST || '127.0.0.1'
const HTTP_PORT = parseInt(process.env.SYNC_HTTP_PORT || '9528', 10)

// 检查是否是 SSE 模式
const isSSEMode = process.argv.includes('--sse')

// Extension WebSocket 桥接
// The bridge's internal HTTP API must not collide with the public MCP SSE port.
const BRIDGE_API_PORT = parseInt(process.env.SYNC_BRIDGE_API_PORT || String(HTTP_PORT + 1), 10)
const bridge = new ExtensionBridge(WS_PORT, {
  apiPort: isSSEMode ? BRIDGE_API_PORT : WS_PORT + 1,
  host: WS_HOST,
})

const HTTP_ACCESS_TOKEN = process.env.WECHATSYNC_HTTP_TOKEN || ''
function authorizeHttp(req: Request, res: Response): boolean {
  if (!HTTP_ACCESS_TOKEN) {
    res.status(503).json({ error: 'Set WECHATSYNC_HTTP_TOKEN before enabling remote MCP' })
    return false
  }
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(HTTP_ACCESS_TOKEN, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

/**
 * 创建 MCP Server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'sync-assistant',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_platforms',
          description: '列出所有支持的平台及其登录状态',
          inputSchema: {
            type: 'object',
            properties: {
              forceRefresh: {
                type: 'boolean',
                description: '是否强制刷新登录状态（默认使用缓存）',
              },
            },
          },
        },
        {
          name: 'check_auth',
          description: '检查指定平台的登录状态',
          inputSchema: {
            type: 'object',
            properties: {
              platform: {
                type: 'string',
                description: '平台 ID，如 zhihu, juejin, toutiao 等',
              },
            },
            required: ['platform'],
          },
        },
        {
          name: 'sync_article',
          description: '同步文章到平台，默认仅保存草稿。知乎、掘金、CSDN 可在明确授权后正式发布，其他平台不可直接发布。',
          inputSchema: {
            type: 'object',
            properties: {
              platforms: {
                type: 'array',
                items: { type: 'string' },
                description: '目标平台 ID 列表，如 ["zhihu", "juejin"]',
              },
              title: {
                type: 'string',
                description: '文章标题（纯文本，不含 # 号）',
              },
              markdown: {
                type: 'string',
                description: '文章正文内容（Markdown 格式，推荐）。注意：1) 不要包含标题行（# xxx），只传正文部分；2) 本地图片必须转换为 base64 data URI 格式，如 ![图片](data:image/png;base64,iVBORw0KGgo...)',
              },
              content: {
                type: 'string',
                description: '文章正文内容（HTML 格式，可选）。如果提供了 markdown 则此字段可忽略。',
              },
              cover: {
                type: 'string',
                description: '封面图 URL 或 base64 data URI。省略时使用正文第一张有效图片。',
              },
              summary: { type: 'string', description: '文章摘要' },
              tags: { type: 'array', items: { type: 'string' }, description: '文章标签。CSDN 正式发布必须提供标签。' },
              publish: { type: 'boolean', description: '显式 true 才正式发布（仅知乎、CSDN、掘金）' },
              confirmPublish: { type: 'string', description: '正式发布时必须传 PUBLISH' },
              idempotencyKey: { type: 'string', description: 'Manager 投递幂等标识，避免重复发稿' },
            },
            required: ['platforms', 'title', 'markdown'],
          },
        },
        {
          name: 'extract_article',
          description: '从当前浏览器页面提取文章内容',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'upload_image_file',
          description: '从本地文件路径上传图片到图床平台，返回可公开访问的 URL。推荐使用此方法，无需手动转换 base64。',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: '本地图片文件的绝对路径，如 /Users/xxx/image.png',
              },
              platform: {
                type: 'string',
                description: '上传到哪个平台作为图床，默认 weibo。可选: weibo, zhihu, juejin, jianshu, woshipm',
              },
            },
            required: ['filePath'],
          },
        },
      ],
    }
  })

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    try {
      // 检查 Extension 是否连接
      if (!bridge.isConnected()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Chrome Extension 未连接。请确保：\n1. 已安装同步助手扩展\n2. 扩展已启用 MCP 连接（点击设置图标开启）',
              }),
            },
          ],
          isError: true,
        }
      }

      let result: unknown

      switch (name) {
        case 'list_platforms':
          result = await bridge.request<PlatformInfo[]>('listPlatforms', {
            forceRefresh: (args as { forceRefresh?: boolean })?.forceRefresh,
          })
          break

        case 'check_auth':
          result = await bridge.request<PlatformInfo>('checkAuth', {
            platform: (args as { platform: string }).platform,
          })
          break

        case 'sync_article': {
          const input = args as {
            platforms: string[]; title: string; content?: string; markdown?: string
            cover?: string; summary?: string; tags?: string[]; publish?: boolean
            confirmPublish?: string; idempotencyKey?: string
          }
          if (!Array.isArray(input.platforms) || input.platforms.length === 0 ||
              !input.platforms.every(p => typeof p === 'string')) {
            throw new Error('At least one valid platform ID is required')
          }
          if (!input.title || (!input.markdown && !input.content)) {
            throw new Error('Title and article body are required')
          }
          if (input.publish) {
            if (input.confirmPublish !== 'PUBLISH') {
              throw new Error('正式发布必须明确传入 confirmPublish=PUBLISH')
            }
            const supported = new Set(['zhihu', 'juejin', 'csdn'])
            if (input.platforms.some(p => !supported.has(p))) {
              throw new Error('当前只支持知乎、掘金、CSDN 的正式发布，其他平台只能保存草稿')
            }
          }
          result = await bridge.request('syncArticle', {
            platforms: input.platforms,
            article: {
              title: input.title,
              content: input.content,
              markdown: input.markdown,
              cover: input.cover,
              summary: input.summary,
              tags: input.tags,
            },
            publish: input.publish === true,
            confirmPublish: input.confirmPublish,
            idempotencyKey: input.idempotencyKey,
          })
          break
        }

        case 'extract_article':
          result = await bridge.request('extractArticle')
          break

        case 'upload_image_file': {
          // 从文件路径读取图片并上传
          const filePath = (args as { filePath: string }).filePath
          const platform = (args as { platform?: string }).platform || 'weibo'

          // 检查文件是否存在
          if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`)
          }

          // 读取文件并转为 base64
          const fileBuffer = fs.readFileSync(filePath)
          const imageData = fileBuffer.toString('base64')

          // 根据扩展名确定 MIME 类型
          const ext = path.extname(filePath).toLowerCase()
          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
          }
          const mimeType = mimeTypes[ext] || 'image/png'

          // 使用分片上传
          result = await bridge.uploadImageChunked(imageData, mimeType, platform)
          break
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: (error as Error).message }),
          },
        ],
        isError: true,
      }
    }
  })

  return server
}

/**
 * stdio 模式启动
 */
async function startStdioMode() {
  // 启动 WebSocket 服务器（Extension 连接）
  await bridge.start()

  const server = createServer()
  const transport = new StdioServerTransport()

  await server.connect(transport)

  // 日志输出到 stderr（不影响 stdio 通信）
  console.error('[MCP] Sync Assistant started (stdio mode)')
  console.error(`[MCP] Extension WebSocket: ws://${WS_HOST}:${WS_PORT}`)
}

/**
 * SSE 模式启动
 */
async function startSSEMode() {
  // 启动 WebSocket 服务器（Extension 连接）
  await bridge.start()

  const app = express()
  const sessions = new Map<string, { transport: SSEServerTransport; server: Server }>()

  // Each client gets its own MCP Server/Transport; never route via a global transport.
  app.get('/sse', async (req: Request, res: Response) => {
    if (!authorizeHttp(req, res)) return
    const server = createServer()
    const transport = new SSEServerTransport('/message', res)
    sessions.set(transport.sessionId, { transport, server })
    res.on('close', () => {
      sessions.delete(transport.sessionId)
      void server.close().catch(() => {})
    })
    try {
      await server.connect(transport)
    } catch (error) {
      sessions.delete(transport.sessionId)
      console.error('[MCP] SSE connection failed:', error)
      if (!res.headersSent) res.status(500).end()
      else res.end()
    }
  })

  app.post('/message', express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
    if (!authorizeHttp(req, res)) return
    const session = sessions.get(String(req.query.sessionId || ''))
    if (!session) {
      res.status(404).json({ error: 'Unknown or expired SSE session' })
      return
    }
    try {
      // express.json() has already consumed the request stream. Pass req.body
      // explicitly or the SDK tries to parse an empty stream and replies HTTP 400.
      await session.transport.handlePostMessage(req, res, req.body)
    } catch (error) {
      console.error('[MCP] Message failed:', error)
      if (!res.headersSent) res.status(500).json({ error: 'MCP transport failure' })
    }
  })

  // 健康检查
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      extensionConnected: bridge.isConnected(),
    })
  })

  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'Sync Assistant MCP Server',
      version: '1.0.0',
      extensionConnected: bridge.isConnected(),
    })
  })

  const host = process.env.SYNC_HTTP_HOST || '127.0.0.1'
  if (BRIDGE_API_PORT === HTTP_PORT || WS_PORT === HTTP_PORT || BRIDGE_API_PORT === WS_PORT) {
    throw new Error('SYNC_HTTP_PORT, SYNC_WS_PORT and SYNC_BRIDGE_API_PORT must be distinct')
  }
  app.listen(HTTP_PORT, host, () => {
    console.error('[MCP] Sync Assistant started (SSE mode)')
    console.error(`[MCP] HTTP Server: http://localhost:${HTTP_PORT}`)
    console.error(`[MCP] Claude Code: http://localhost:${HTTP_PORT}/sse`)
    console.error(`[MCP] Extension WebSocket: ws://${WS_HOST}:${WS_PORT}`)
  })
}

// 启动
if (isSSEMode) {
  startSSEMode().catch((error) => {
    console.error('[MCP] Failed to start:', error)
    process.exit(1)
  })
} else {
  startStdioMode().catch((error) => {
    console.error('[MCP] Failed to start:', error)
    process.exit(1)
  })
}

// 处理退出信号
process.on('SIGINT', () => {
  console.error('[MCP] Shutting down...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.error('[MCP] Shutting down...')
  process.exit(0)
})
