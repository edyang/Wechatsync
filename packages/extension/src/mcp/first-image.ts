/**
 * Select the first valid image in the article body (never the site's OG image).
 * Ignore Markdown code fences and inline code samples.
 */
export function firstContentImage(markdown: string, html: string): string | undefined {
  const valid = (value: string): boolean =>
    /^https?:\/\//i.test(value) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)

  const plain = markdown
    .replace(/^`{3,}[^\n]*\n[\s\S]*?^`{3,}[^\n]*$/gm, '')
    .replace(/^~{3,}[^\n]*\n[\s\S]*?^~{3,}[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '')
  const imagePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['"][^'"]*['"])?\s*\)/g
  for (const match of plain.matchAll(imagePattern)) {
    const url = (match[1] || match[2] || '').trim()
    if (valid(url)) return url
  }
  const htmlPattern = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
  for (const match of html.matchAll(htmlPattern)) {
    const url = match[1].trim()
    if (valid(url)) return url
  }
  return undefined
}
