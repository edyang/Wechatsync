/** Count conservatively using UTF-16 units, without splitting surrogate pairs. */
export function limitArticleTitle(title: string, maxLength = 32): string {
  const normalized = title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  let result = ''
  for (const char of normalized) {
    if (result.length + char.length > maxLength) break
    result += char
  }
  return result.trim()
}
