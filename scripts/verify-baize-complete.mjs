import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'dist/Wechatsync-Baize-Complete')
const manifest = JSON.parse(await readFile(resolve(output, 'manifest.json'), 'utf8'))
const report = JSON.parse(await readFile(resolve(output, 'BUILD_REPORT.json'), 'utf8'))
const vite = JSON.parse(await readFile(resolve(output, '.vite/manifest.json'), 'utf8'))
const memory = {}
const events = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn) }, removeListener() {} })
const storage = { async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, memory[k]])) },
  async set(items) { Object.assign(memory, items) }, async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete memory[k] } }
globalThis.chrome = {
  runtime: { id: 'mock-extension', getManifest: () => manifest, getURL: name => 'chrome-extension://mock-extension/' + name,
    onMessage: events(), onStartup: events(), onInstalled: events(), async sendMessage() {} },
  storage: { local: storage, session: storage, sync: storage },
  cookies: { async getAll() { return [{ name: 'bili_jct', value: 'mock-csrf' }] } },
  tabs: { onUpdated: events(), async query() { return [] }, async sendMessage() {}, async create() {} },
  alarms: { create() {}, onAlarm: events() }, contextMenus: { create() {}, onClicked: events() },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  declarativeNetRequest: { RuleActionType: { MODIFY_HEADERS: 'modifyHeaders' }, HeaderOperation: { SET: 'set' },
    async getDynamicRules() { return [] }, async updateDynamicRules() {} },
}
globalThis.self = globalThis
// No account requests leave this test process; every fetch is replaced below.
let mode = 'success'
const drafts = []
const uploadFiles = []
let savedWeiboTitle = ''
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jmiQAAAAASUVORK5CYII=', 'base64')
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, options = {}) => {
  const address = String(url)
  if (address.includes('/x/web-interface/nav')) return json({ code: 0, data: { isLogin: true, mid: 1, uname: 'mock-user' } })
  if (address.startsWith('https://chsparta.com/')) return new Response(png, { headers: { 'Content-Type': 'image/png' } })
  if (address.includes('/article/upcover')) {
    const file = options.body.get('binary')
    uploadFiles.push({ name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })
    return json({ code: 0, data: { url: mode === 'external-url' ? 'https://chsparta.com/bad.png' : '//i0.hdslb.com/bfs/article/uploaded.png', size: png.length } })
  }
  if (address.includes('/draft/addupdate')) { drafts.push(new URLSearchParams(options.body)); return json({ code: 0, data: { aid: 42 } }) }
  if (address === 'https://card.weibo.com/article/v5/editor') return new Response("config: JSON.parse('{\"uid\":\"mock-user\",\"nick\":\"mock-user\"}')")
  if (address.includes('/draft/create')) return json({ code: 100000, data: { id: 'mock-draft' } })
  if (address.includes('/draft/save')) { savedWeiboTitle = new URLSearchParams(options.body).get('title'); return json({ code: '100000' }) }
  return new Response('{}', { status: 404 })
}

const background = resolve(output, vite['src/background/index.ts'].file)
const syntax = ts.createSourceFile('background.js', await readFile(background, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
assert.equal(syntax.parseDiagnostics.length, 0)
// Browser bundles must not enter js-md5's Node-only path while running this mock worker.
const nodeProcess = globalThis.process
globalThis.process = undefined
try { await import(pathToFileURL(background).href) } finally { globalThis.process = nodeProcess }
async function message(value) {
  const listener = chrome.runtime.onMessage.listeners[0]
  assert.equal(typeof listener, 'function')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Mock extension response timeout')), 10000)
    listener(value, {}, result => { clearTimeout(timer); resolve(result) })
  })
}
const { platforms } = await message({ type: 'GET_PLATFORMS' })
assert.deepEqual(platforms.map(p => p.id).sort(), report.platforms)
assert.equal(platforms.length, 29)
const article = { title: 'AI日报｜工业智能体责任链', html: '<p>正文</p><img src="/assets/cover.webp" srcset="/assets/old.webp 2x">', markdown: '正文', source: { platform: 'baize', url: 'https://chsparta.com/insights/test/' } }
article.platformContents = { bilibili: { html: article.html, markdown: article.markdown } }
const synced = await message({ type: 'SYNC_ARTICLE', payload: { article, platforms: ['bilibili'], skipHistory: true } })
assert.equal(synced.results[0].success, true, JSON.stringify(synced))
assert.equal(drafts.length, 1)
assert.ok(drafts[0].get('content').includes('https://i0.hdslb.com/bfs/article/uploaded.png'))
assert.ok(!drafts[0].get('content').includes('chsparta.com'))
assert.ok(!drafts[0].get('content').includes('srcset'))
assert.equal(uploadFiles[0].name, 'image.png')
assert.equal(uploadFiles[0].type, 'image/png')
assert.deepEqual(uploadFiles[0].bytes, png)
mode = 'external-url'
const rejected = await message({ type: 'SYNC_ARTICLE', payload: { article, platforms: ['bilibili'], skipHistory: true } })
assert.equal(rejected.results[0].success, false)
assert.match(rejected.results[0].error, /站内图片/)
assert.equal(drafts.length, 1, 'An invalid image URL must never reach draft/addupdate')
mode = 'success'
const weibo = { title: 'AI日报｜' + '工业智能体'.repeat(12), html: '<p>正文</p>', markdown: '正文' }
weibo.platformContents = { weibo: { html: weibo.html, markdown: weibo.markdown } }
const weiboResult = await message({ type: 'SYNC_ARTICLE', payload: { article: weibo, platforms: ['weibo'], skipHistory: true } })
assert.equal(weiboResult.results[0].success, true, JSON.stringify(weiboResult))
assert.equal(savedWeiboTitle.length, 32)
assert.ok(weibo.title.length > 32, 'Do not mutate the source article')

// Test the exact extractor delivered in the final ZIP, with a browser-like DOM.
const requireCore = createRequire(resolve(root, 'packages/core/package.json'))
const { parseHTML } = requireCore('linkedom')
const { window, document } = parseHTML('<html><head><title>标题 | 白泽智能公司</title></head><body><header><img src="/logo.png"></header><section class="article-hero"><h1>真正的文章标题</h1><p class="article-lead">导语</p><figure class="article-cover"><img src="/cover.webp"></figure></section><main class="article-shell"><p>完整正文</p><img src="/body.webp" srcset="/old.webp 2x"></main><footer><img src="/footer-logo.png"></footer></body></html>')
window.location = { hostname: 'chsparta.com', pathname: '/insights/test/', href: 'https://chsparta.com/insights/test/' }
Object.defineProperty(document, 'baseURI', { value: window.location.href })
globalThis.window = window
globalThis.document = document
globalThis.HTMLElement = window.HTMLElement
const { extractBaizeArticle } = await import(pathToFileURL(resolve(output, 'assets/baize-extractor.js')).href)
const extracted = extractBaizeArticle()
assert.equal(extracted.title, '真正的文章标题')
assert.ok(extracted.html.includes('https://chsparta.com/cover.webp'))
assert.ok(extracted.html.includes('https://chsparta.com/body.webp'))
assert.ok(!extracted.html.includes('logo.png'))
assert.ok(!extracted.html.includes('srcset'))
assert.ok(extracted.markdown.includes('完整正文'))
console.log(JSON.stringify({ complete_platforms: platforms.length, service_worker_loaded: true,
  bilibili_draft_has_only_platform_images: true, invalid_image_blocks_draft: true,
  image_filename_and_bytes_match: true, weibo_title_units: savedWeiboTitle.length,
  baize_cover_and_body_images_preserved: true, real_account_requests: 0 }, null, 2))
process.exit(0)
