import { htmlToMarkdownNative } from '../../../core/src/lib/turndown'

/** The Baize hero/cover is outside <main>; generic reader extraction loses it and can include site branding. */
export function extractBaizeArticle() {
  if (!['chsparta.com', 'www.chsparta.com'].includes(window.location.hostname)
    || !/^\/insights\/[^/]+\/?$/.test(window.location.pathname)) return null
  const body = document.querySelector('.article-shell')
  const title = document.querySelector('.article-hero h1')?.textContent?.trim()
  if (!body || !title) return null
  const cloned = body.cloneNode(true) as HTMLElement
  cloned.querySelectorAll('script,style,iframe,nav,button,noscript').forEach(node => node.remove())
  const originalImages = [...body.querySelectorAll('img')]
  cloned.querySelectorAll('img').forEach((img, index) => {
    const original = originalImages[index]
    const src = original?.currentSrc || original?.getAttribute('data-src') || original?.getAttribute('src')
    if (src) img.setAttribute('src', new URL(src, document.baseURI).href)
  })
  const coverImage = document.querySelector('.article-cover img') as HTMLImageElement | null
  const coverSrc = coverImage?.currentSrc || coverImage?.getAttribute('src')
    || document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  const cover = coverSrc ? new URL(coverSrc, document.baseURI).href : undefined
  if (cover && ![...cloned.querySelectorAll('img')].some(img => img.getAttribute('src') === cover)) {
    const figure = document.createElement('figure')
    const img = document.createElement('img')
    img.src = cover
    img.alt = coverImage?.alt || title
    figure.append(img)
    cloned.prepend(figure)
  }
  cloned.querySelectorAll('img').forEach(img => {
    for (const attribute of [...img.attributes]) {
      if (['srcset', 'sizes'].includes(attribute.name) || attribute.name.startsWith('data-') || /^on/i.test(attribute.name)) {
        img.removeAttribute(attribute.name)
      }
    }
  })
  const summary = document.querySelector('.article-lead')?.textContent?.trim()
    || document.querySelector('meta[property="og:description"]')?.getAttribute('content') || undefined
  if (summary && !body.textContent?.trim().startsWith(summary)) {
    const lead = document.createElement('p')
    lead.textContent = summary
    cloned.prepend(lead)
  }
  const html = cloned.innerHTML
  return { title, html, markdown: htmlToMarkdownNative(html), summary, cover,
    source: { url: window.location.href, platform: 'baize' } }
}
