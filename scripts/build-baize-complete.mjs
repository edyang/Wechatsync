import { readFile, writeFile, mkdir, rm, cp, realpath } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireCore = createRequire(resolve(root, 'packages/core/package.json'))
const JSZip = requireCore('jszip')
const requireVite = createRequire(await realpath(resolve(root, 'packages/extension/node_modules/vite/package.json')))
const { build } = requireVite('esbuild')
const officialUrl = 'https://wpics.oss-cn-shanghai.aliyuncs.com/wechatsync-2.0.9.zip?date=20260324'
const officialSha256 = 'dfb191decd63a45063c4f6d8f7687745e5ecebe34363792dd6781b657d69fd29'
const version = '2.0.10.1'
const hash = buffer => createHash('sha256').update(buffer).digest('hex')
const inputIndex = process.argv.indexOf('--input')
const bytes = inputIndex >= 0
  ? await readFile(resolve(process.argv[inputIndex + 1]))
  : Buffer.from(await (await fetch(officialUrl, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
if (hash(bytes) !== officialSha256) throw new Error('Official ZIP changed; inspect it before updating the pinned hash.')
const original = await JSZip.loadAsync(bytes)
const output = resolve(root, 'dist/Wechatsync-Baize-Complete')
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
for (const [name, file] of Object.entries(original.files)) {
  if (file.dir) continue
  if (name.includes('..') || name.startsWith('/')) throw new Error('Unsafe ZIP entry: ' + name)
  const target = resolve(output, name)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, await file.async('nodebuffer'))
}

await build({ entryPoints: [resolve(root, 'packages/extension/src/baize-complete-patch.ts')],
  outfile: resolve(output, 'assets/baize-complete-patch.js'), bundle: true, format: 'esm',
  platform: 'browser', target: 'chrome109', minify: true, legalComments: 'eof',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' } })
await build({ entryPoints: [resolve(root, 'packages/extension/src/lib/baize-extractor.ts')],
  outfile: resolve(output, 'assets/baize-extractor.js'), bundle: true, format: 'esm',
  platform: 'browser', target: 'chrome109', minify: true, legalComments: 'eof',
  define: { 'import.meta.env.PROD': 'true', 'import.meta.env.DEV': 'false' } })

function nodesIn(code) {
  const source = ts.createSourceFile('bundle.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const nodes = []
  const walk = node => { nodes.push(node); ts.forEachChild(node, walk) }
  walk(source)
  return { source, nodes }
}
function unique(nodes, predicate, label) {
  const found = nodes.filter(predicate)
  if (found.length !== 1) throw new Error(label + ': expected exactly one match, got ' + found.length)
  return found[0]
}
function platformId(node, source) {
  if (!ts.isClassDeclaration(node)) return null
  const constructor = node.members.find(ts.isConstructorDeclaration)
  return constructor?.getText(source).match(/\bid:"([a-z0-9-]+)"/)?.[1] || null
}
function edit(code, edits) {
  return edits.sort((a, b) => b.start - a.start).reduce((text, change) => text.slice(0, change.start) + change.text + text.slice(change.end), code)
}
const viteManifest = JSON.parse(await readFile(resolve(output, '.vite/manifest.json'), 'utf8'))
const backgroundPath = resolve(output, viteManifest['src/background/index.ts'].file)
const background = await readFile(backgroundPath, 'utf8')
const { source, nodes } = nodesIn(background)
const ids = nodes.map(node => platformId(node, source)).filter(Boolean).sort()
const expected = ['51cto','baijiahao','bilibili','cnblogs','csdn','dayu','douban','douyin','eastmoney','imooc','jianshu','juejin','netease','oschina','segmentfault','smzdm','sohu','sohufocus','toutiao','weibo','weixin','woshipm','x','xiaohongshu','xueqiu','yidian','yuque','zhihu','zip-download'].sort()
if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Error('Complete platform list differs from the pinned 29-adapter distribution.')
const biliClass = unique(nodes, node => platformId(node, source) === 'bilibili', 'Bilibili class')
const weiboClass = unique(nodes, node => platformId(node, source) === 'weibo', 'Weibo class')
const baseName = biliClass.heritageClauses[0].types[0].expression.getText(source)
const baseClass = unique(nodes, node => ts.isClassDeclaration(node) && node.name?.text === baseName, 'Image processing base')
const processMethod = unique([...baseClass.members], node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'processImages', 'processImages method')
const weiboPublish = unique([...weiboClass.members], node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'publish', 'Weibo publish method')
const articleParam = weiboPublish.parameters[0].name.getText(source)
const patchedBackground = edit(background, [
  { start: biliClass.getStart(source), end: biliClass.end, text: 'const ' + biliClass.name.text + '=BaizeBilibiliAdapter;' },
  { start: processMethod.getStart(source), end: processMethod.end, text: 'async processImages(content,upload,options){return baizeProcessArticleImages(content,upload,options)}' },
  { start: weiboPublish.body.getStart(source) + 1, end: weiboPublish.body.getStart(source) + 1,
    text: articleParam + '={...' + articleParam + ',title:baizeLimitArticleTitle(' + articleParam + '.title)};' },
])
await writeFile(backgroundPath, 'import { BilibiliAdapter as BaizeBilibiliAdapter, processArticleImages as baizeProcessArticleImages, limitArticleTitle as baizeLimitArticleTitle } from "./baize-complete-patch.js";\n' + patchedBackground)

const extractorPath = resolve(output, viteManifest['src/content/extractor.ts'].file)
const extractor = await readFile(extractorPath, 'utf8')
const extractAst = nodesIn(extractor)
const extractFunction = unique(extractAst.nodes, node => ts.isFunctionDeclaration(node) && node.body
  && node.body.getText(extractAst.source).includes('window.location.href')
  && node.body.getText(extractAst.source).includes('mp.weixin.qq.com')
  && node.body.getText(extractAst.source).includes('feishu.cn'), 'Generic article extraction entry')
const at = extractFunction.body.getStart(extractAst.source) + 1
await writeFile(extractorPath, 'import {extractBaizeArticle as baizeExtractArticle} from "./baize-extractor.js";\n'
  + edit(extractor, [{ start: at, end: at, text: 'const __baizeArticle=baizeExtractArticle();if(__baizeArticle)return __baizeArticle;' }]))

const manifestPath = resolve(output, 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
manifest.name = '白泽文章同步助手（完整渠道修复版）'
manifest.version = version
manifest.version_name = version + ' · 29渠道 · B站图片转存 · 微博短标题'
manifest.description = '保留官方全部29个渠道适配器与CMS。官网正文和题图完整提取，B站图片转存并校验，微博标题最多32字。同步草稿后人工发布。'
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
await cp(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'))
await cp(resolve(root, 'docs/BAIZE_COMPLETE_IMAGE_FIX.md'), resolve(output, '安装与使用说明.md'))
const sourceFiles = [
  'scripts/build-baize-complete.mjs', 'packages/extension/src/baize-complete-patch.ts',
  'packages/extension/src/lib/baize-extractor.ts', 'packages/core/src/adapters/platforms/bilibili.ts',
  'packages/core/src/adapters/code-adapter.ts', 'packages/core/src/lib/article-images.ts',
  'packages/core/src/lib/article-title.ts', 'packages/core/src/lib/bilibili-images.ts',
]
for (const file of sourceFiles) {
  const target = resolve(output, 'PATCH_SOURCE', file)
  await mkdir(dirname(target), { recursive: true })
  await cp(resolve(root, file), target)
}
const report = { version, base_version: '2.0.9', official_url: officialUrl, official_sha256: officialSha256,
  platforms: expected, platform_count: expected.length, mode: 'draft_then_manual_publish',
  patches: ['Bilibili adapter', 'image transfer base method', 'Weibo title guard', 'Baize article extractor'],
  account_publication_tested: false }
await writeFile(resolve(output, 'BUILD_REPORT.json'), JSON.stringify(report, null, 2) + '\n')
const archive = new JSZip()
const { readdir } = await import('node:fs/promises')
async function addDirectory(folder, relative = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = relative ? relative + '/' + entry.name : entry.name
    if (entry.isDirectory()) await addDirectory(resolve(folder, entry.name), name)
    else archive.file('Wechatsync-Baize-Complete/' + name, await readFile(resolve(folder, entry.name)))
  }
}
await addDirectory(output)
const zipPath = resolve(root, 'dist/Wechatsync-Baize-Complete-' + version + '.zip')
const zipBytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
await writeFile(zipPath, zipBytes)
await writeFile(zipPath + '.sha256', hash(zipBytes) + '  ' + zipPath.split('/').pop() + '\n')
console.log(JSON.stringify({ zipPath, bytes: zipBytes.length, sha256: hash(zipBytes), platforms: ids.length, output }, null, 2))
