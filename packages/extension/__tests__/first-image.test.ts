import { describe, expect, it } from 'vitest'
import { firstContentImage } from '../src/mcp/first-image'

describe('Baize cover fallback', () => {
  it('chooses the first actual markdown image, ignoring fenced examples', () => {
    const md = ['\`\`\`md', '![fake](https://example.com/code.png)', '\`\`\`',
      '文章', '![first](https://example.com/first.png)', '![second](https://example.com/next.png)'].join('\n')
    expect(firstContentImage(md, '')).toBe('https://example.com/first.png')
  })
  it('supports HTML-only articles', () => {
    expect(firstContentImage('', '<p><img src="https://example.com/a.jpg"></p>')).toBe('https://example.com/a.jpg')
  })
  it('does not return unsafe or local paths', () => {
    expect(firstContentImage('![bad](javascript:alert) ![relative](/local.png)', '')).toBeUndefined()
  })
  it('accepts inline images as data URI', () => {
    expect(firstContentImage('![inline](data:image/png;base64,AAAA)', '')).toBe('data:image/png;base64,AAAA')
  })
})
