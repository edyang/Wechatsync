// Automated smoke test. No browser login and NO platform publishing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('./.env', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.trimStart().startsWith('#'))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
const wsPort = Number(env.WS_HOST_PORT || 9527)
const httpPort = Number(env.MCP_HOST_PORT || 9528)
const url = 'http://127.0.0.1:' + httpPort
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function awaitHealth() {
  for (let i = 0; i < 45; i++) {
    try {
      const res = await fetch(url + '/health', { signal: AbortSignal.timeout(2000) })
      const body = await res.json()
      if (res.ok && body.status === 'ok') return body
    } catch {}
    await pause(750)
  }
  throw new Error('MCP /health never became ready')
}

await awaitHealth()
const blocked = await fetch(url + '/sse', { signal: AbortSignal.timeout(3000) })
assert.equal(blocked.status, 401, 'SSE must reject an unauthenticated connection')

const ws = new WebSocket('ws://127.0.0.1:' + wsPort)
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Host-to-container WS failed')), 4000)
  ws.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
  ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Host Chrome cannot access WebSocket bridge')) }, { once: true })
})
let connected = false
for (let i = 0; i < 10; i++) {
  if ((await awaitHealth()).extensionConnected === true) { connected = true; break }
  await pause(200)
}
assert.ok(connected, 'WebSocket connection must become visible via health')
// Emulate the Chrome extension, without using a real account or posting content.
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  assert.equal(message.token, env.WECHATSYNC_TOKEN)
  if (message.method === 'listPlatforms') {
    ws.send(JSON.stringify({
      id: message.id,
      result: [{ id: 'zhihu', name: '知乎', isAuthenticated: true }],
    }))
  }
})

const controller = new AbortController()
const globalTimeout = setTimeout(() => controller.abort(), 25_000)
try {
  // Real legacy MCP over SSE: GET /sse, then POST /message?sessionId=...
  const stream = await fetch(url + '/sse', {
    headers: {
      Authorization: 'Bearer ' + env.WECHATSYNC_HTTP_TOKEN,
      Accept: 'text/event-stream',
    },
    signal: controller.signal,
  })
  assert.equal(stream.status, 200, 'Authorized SSE GET should succeed')
  assert.match(stream.headers.get('content-type') || '', /text\/event-stream/)
  const reader = stream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  async function nextFrame() {
    while (true) {
      // Node 22 fetch chunks may contain several or half of an SSE frame.
      const boundary = buffer.indexOf('\n\n')
      if (boundary !== -1) {
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const lines = raw.split('\n')
        const type = lines.find(x => x.startsWith('event:'))?.slice(6).trim() || 'message'
        const data = lines.filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n')
        if (data) return { type, data }
        continue
      }
      const chunk = await reader.read()
      assert.ok(!chunk.done, 'MCP SSE closed before JSON-RPC handshake completed')
      buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r', '')
    }
  }
  const firstFrame = await nextFrame()
  assert.equal(firstFrame.type, 'endpoint', 'MCP SSE must provide endpoint event')
  const endpoint = new URL(firstFrame.data, url)
  assert.equal(endpoint.pathname, '/message')
  assert.ok(endpoint.searchParams.get('sessionId'), 'MCP SSE requires sessionId')

  async function postRpc(message) {
    const reply = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.WECHATSYNC_HTTP_TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    })
    const responseText = await reply.text()
    assert.equal(reply.status, 202,
      'MCP POST ' + message.method + ' must return 202 (got ' + reply.status
      + ': ' + responseText.slice(0, 300) + ')')
  }
  async function rpcResult(id) {
    for (let n = 0; n < 50; n++) {
      const frame = await nextFrame()
      if (frame.type !== 'message') continue
      const rpc = JSON.parse(frame.data)
      if (rpc.id !== id) continue
      if (rpc.error) throw new Error('MCP JSON-RPC error: ' + JSON.stringify(rpc.error))
      assert.ok(rpc.result, 'MCP result missing for id ' + id)
      return rpc.result
    }
    throw new Error('Could not find MCP response for id ' + id)
  }

  await postRpc({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'baize-smoke-test', version: '1.0.0' },
    },
  })
  const initialized = await rpcResult(1)
  assert.ok(initialized.protocolVersion)
  await postRpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await postRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const listed = await rpcResult(2)
  assert.ok(listed.tools.some(t => t.name === 'list_platforms'),
    'Manager requires MCP list_platforms tool')

  // Exercise precisely what the Manager "测试连接" button invokes.
  await postRpc({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'list_platforms', arguments: { forceRefresh: true } },
  })
  const toolCall = await rpcResult(3)
  const textBlock = toolCall.content?.find(c => c.type === 'text')?.text
  assert.ok(textBlock, 'list_platforms must return a JSON text content block')
  const platformList = JSON.parse(textBlock)
  assert.equal(platformList[0].id, 'zhihu')
  assert.equal(platformList[0].isAuthenticated, true)
  await reader.cancel()
} finally {
  clearTimeout(globalTimeout)
  controller.abort()
  ws.close()
}

console.log('PASS: Docker health, SSE Bearer, Chrome WS, MCP initialize, tools/list, tools/call')

