import { describe, it, expect, vi } from 'vitest'
import { processArticleImages, isPlatformImage } from '../article-images'
import { normalizeBilibiliImageUrl, prepareBilibiliHtml, prepareBilibiliImage } from '../bilibili-images'
import { limitArticleTitle } from '../article-title'

describe('image transfer', () => {
  it('transfers single/double/unquoted sources, decodes entities and removes stale source attributes', async () => {
    const upload = vi.fn(async () => ({ url: 'https://i0.hdslb.com/bfs/article/new.png' }))
    const html = await processArticleImages('<img src=\'/images/a.webp?v=1&amp;b=2\' srcset="https://chsparta.com/old.webp 2x"><img src=/images/a.webp?v=1&amp;b=2>', upload, { baseUrl: 'https://chsparta.com/insights/test/' })
    expect(upload).toHaveBeenCalledOnce()
    expect(upload).toHaveBeenCalledWith('https://chsparta.com/images/a.webp?v=1&b=2')
    expect(html).not.toContain('chsparta.com')
    expect(html).not.toContain('srcset')
    expect(html.match(/new.png/g)).toHaveLength(2)
  })
  it('does not accept domains embedded in another hostname or query', () => {
    expect(isPlatformImage('https://evil.example/?hdslb.com', ['hdslb.com'])).toBe(false)
    expect(isPlatformImage('https://hdslb.com.evil.example/a', ['hdslb.com'])).toBe(false)
    expect(isPlatformImage('https://i0.hdslb.com/a', ['hdslb.com'])).toBe(true)
  })
  it('fails before draft save when an upload fails', async () => {
    await expect(processArticleImages('<img src="https://chsparta.com/a.webp">', async () => { throw new Error('HTTP 403') })).rejects.toThrow('未保存草稿')
  })
  it('also transfers markdown and reports completed images including native ones', async () => {
    const progress = vi.fn()
    const result = await processArticleImages('![x](https://chsparta.com/a.webp)\n<img src="https://i0.hdslb.com/b.png">', async () => ({ url: 'https://i0.hdslb.com/a.png' }), { skipPatterns: ['hdslb.com'], onProgress: progress })
    expect(result).not.toContain('chsparta.com')
    expect(progress).toHaveBeenLastCalledWith(2, 2)
  })
})

describe('Bilibili image content', () => {
  it('normalizes protocol-relative CDN URLs and rejects external sources', () => {
    expect(normalizeBilibiliImageUrl('//i0.hdslb.com/bfs/article/a.png')).toBe('https://i0.hdslb.com/bfs/article/a.png')
    expect(() => normalizeBilibiliImageUrl('https://chsparta.com/a.png')).toThrow('站内图片')
    expect(() => normalizeBilibiliImageUrl('https://bilibili.com/a.png')).toThrow('站内图片')
  })
  it('resolves relative/lazy images and removes responsive/background references', () => {
    const result = prepareBilibiliHtml('<p style="background:url(https://chsparta.com/bg.webp)">文字</p><picture><source srcset="/a.webp"><img data-src="/real.webp" src="data:image/gif;base64,placeholder" srcset="/old.webp" onerror="bad()"></picture><svg><image href="/x.svg"></image></svg>', 'https://chsparta.com/insights/test/')
    expect(result).toContain('https://chsparta.com/real.webp')
    for (const stale of ['placeholder', 'srcset', 'background', 'onerror', '<source', '<svg', 'data-src']) expect(result).not.toContain(stale)
  })
  it('keeps matching JPEG/PNG filenames and rejects HTML error pages', async () => {
    expect((await prepareBilibiliImage(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }))).filename).toBe('image.jpg')
    expect((await prepareBilibiliImage(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }))).filename).toBe('image.png')
    await expect(prepareBilibiliImage(new Blob(['<html>Site Unavailable</html>'], { type: 'text/html' }))).rejects.toThrow('不是可上传的图片')
  })
  it('converts WebP bytes into a real PNG blob', async () => {
    const close = vi.fn()
    const draw = vi.fn()
    const convert = vi.fn(async () => new Blob(['PNG bytes'], { type: 'image/png' }))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 20, close })))
    vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage: draw } } convertToBlob = convert })
    try {
      const result = await prepareBilibiliImage(new Blob(['RIFFxxxxWEBPxxxx'], { type: 'image/webp' }))
      expect(result.filename).toBe('image.png')
      expect(result.blob.type).toBe('image/png')
      expect(draw).toHaveBeenCalledOnce()
      expect(convert).toHaveBeenCalledWith({ type: 'image/png' })
      expect(close).toHaveBeenCalledOnce()
    } finally { vi.unstubAllGlobals() }
  })
})

describe('article title guard', () => {
  it('counts prefixes, punctuation, Latin text and spaces in the 32-unit limit', () => {
    const title = limitArticleTitle('AI日报｜' + '工业智能体'.repeat(10))
    expect(title.length).toBe(32)
    expect(title.startsWith('AI日报｜')).toBe(true)
  })
  it('does not split emoji surrogate pairs', () => {
    const title = limitArticleTitle('中'.repeat(31) + '😀')
    expect(title).toBe('中'.repeat(31))
  })
  it('preserves already valid titles and normalizes accidental line breaks', () => {
    expect(limitArticleTitle('AI日报｜智能体责任链')).toBe('AI日报｜智能体责任链')
    expect(limitArticleTitle(' 标题\n  正文 ')).toBe('标题 正文')
  })
})
