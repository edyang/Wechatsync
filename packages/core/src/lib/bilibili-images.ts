import { parseHTML } from 'linkedom'
import { isPlatformImage, resolveImageUrl } from './article-images'

export const BILIBILI_IMAGE_DOMAINS = ['hdslb.com', 'biliimg.com']

export function normalizeBilibiliImageUrl(value: string): string {
  const url = new URL(value.startsWith('//') ? 'https:' + value : value)
  if (!isPlatformImage(url.href, BILIBILI_IMAGE_DOMAINS)) {
    throw new Error('B站未返回合法的站内图片地址')
  }
  url.protocol = 'https:'
  return url.href
}

export function prepareBilibiliHtml(content: string, baseUrl?: string): string {
  const { document } = parseHTML('<html><body>' + content + '</body></html>')
  document.querySelectorAll('script,style,iframe,object,embed,svg,video,audio,source').forEach(node => node.remove())
  document.querySelectorAll('*').forEach(node => {
    node.removeAttribute('style')
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name)
    }
  })
  document.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || ''
    if (!src) throw new Error('B站正文中有图片缺少地址')
    img.setAttribute('src', resolveImageUrl(src, baseUrl))
    for (const attr of [...img.attributes]) {
      if (['srcset', 'sizes'].includes(attr.name) || attr.name.startsWith('data-')) img.removeAttribute(attr.name)
    }
  })
  document.querySelectorAll('picture').forEach(node => node.replaceWith(...node.childNodes))
  return document.body.innerHTML
}

/** B站上传入口只接收明确的位图；网站 WebP/AVIF 转为真实 PNG，而非仅改文件名。 */
export async function prepareBilibiliImage(blob: Blob): Promise<{ blob: Blob; filename: string }> {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  const ascii = String.fromCharCode(...header)
  if (header[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return { blob: new Blob([blob], { type: 'image/png' }), filename: 'image.png' }
  if (header[0] === 0xff && header[1] === 0xd8) return { blob: new Blob([blob], { type: 'image/jpeg' }), filename: 'image.jpg' }
  if (/^GIF8[79]a/.test(ascii)) return { blob: new Blob([blob], { type: 'image/gif' }), filename: 'image.gif' }
  const convertible = ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
    || ascii.slice(4, 8) === 'ftyp' && /avif|avis/.test(ascii)
    || /^image\/(?:webp|avif|svg\+xml)$/i.test(blob.type)
  if (!convertible) throw new Error('下载内容不是可上传的图片，可能返回了错误页')
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('当前浏览器无法转换图片，请更新 Chrome/Edge')
  }
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片转换画布不可用')
    context.drawImage(bitmap, 0, 0)
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), filename: 'image.png' }
  } finally { bitmap.close() }
}
