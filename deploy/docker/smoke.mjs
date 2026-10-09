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

const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 4000)
try {
  const response = await fetch(url + '/sse', {
    headers: { Authorization: 'Bearer ' + env.WECHATSYNC_HTTP_TOKEN },
    signal: controller.signal,
  })
  assert.equal(response.status, 200, 'SSE must accept a valid Bearer Token')
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
  const first = await response.body.getReader().read()
  assert.match(new TextDecoder().decode(first.value), /endpoint|sessionId/)
} finally {
  clearTimeout(timeout)
  controller.abort()
}

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
ws.close()

console.log('PASS: Docker /health, SSE Bearer auth, host Chrome WebSocket connectivity')
