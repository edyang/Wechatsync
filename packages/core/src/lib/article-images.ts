import { parseHTML } from 'linkedom'
import { parseMarkdownImages } from './markdown-images'
import type { ImageProcessOptions, ImageUploadResult } from '../adapters/code-adapter'

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function resolveImageUrl(src: string, baseUrl?: string): string {
  if (/^data:image\//i.test(src)) return src
  const url = new URL(src, baseUrl)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('图片地址必须为 HTTP(S) 或图片 data URL')
  }
  return url.href
}

/** Match the hostname, never a query string or a lookalike suffix. */
export function isPlatformImage(src: string, domains: string[]): boolean {
  try {
    const url = new URL(src)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && domains.some(domain => {
      const hostname = domain.replace(/^\./, '').toLowerCase()
      return url.hostname === hostname || url.hostname.endsWith('.' + hostname)
    })
  } catch { return false }
}

/** Worker-safe HTML/Markdown image transfer. A failed upload never leaves an external image behind. */
export async function processArticleImages(
  content: string,
  upload: (src: string) => Promise<ImageUploadResult>,
  options: ImageProcessOptions = {},
): Promise<string> {
  const matches: Array<{ full: string; src: string; alt: string; html: boolean }> = []
  const imageTag = /<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  for (const match of content.matchAll(imageTag)) {
    const { document } = parseHTML('<html><body>' + match[0] + '</body></html>')
    const img = document.querySelector('img')
    if (!img) continue
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || ''
    if (!src) throw new Error('文章图片缺少地址，请重新提取文章')
    matches.push({ full: match[0], src, alt: img.getAttribute('alt') || '', html: true })
  }
  for (const match of parseMarkdownImages(content)) {
    matches.push({ full: match.full, src: match.src, alt: match.alt, html: false })
  }
  let result = content
  const cache = new Map<string, ImageUploadResult>()
  for (const [index, match] of matches.entries()) {
    let uploaded: ImageUploadResult
    try {
      const src = resolveImageUrl(match.src, options.baseUrl)
      if (isPlatformImage(src, options.skipPatterns || [])) {
        uploaded = { url: src }
      } else {
        const cached = cache.get(src)
        uploaded = cached || await upload(src)
        cache.set(src, uploaded)
      }
      const uploadedUrl = resolveImageUrl(uploaded.url)
      if (uploadedUrl.startsWith('data:')) throw new Error('平台返回了未转存的图片')
      let replacement: string
      if (match.html) {
        replacement = '<img src="' + escapeAttribute(uploadedUrl) + '" alt="' + escapeAttribute(match.alt) + '"'
        for (const [key, value] of Object.entries(uploaded.attrs || {})) {
          if (/^[a-z][\w:-]*$/i.test(key) && !/^(?:src|srcset|style|on\w+|data-src|data-original)$/i.test(key)) {
            replacement += ' ' + key + '="' + escapeAttribute(String(value)) + '"'
          }
        }
        replacement += ' />'
      } else {
        replacement = '![' + match.alt + '](' + uploadedUrl + ')'
      }
      result = result.replace(match.full, replacement)
    } catch (error) {
      throw new Error('第' + (index + 1) + '张图片转存失败，未保存草稿：' + (error as Error).message)
    }
    options.onProgress?.(index + 1, matches.length)
  }
  return result
}
