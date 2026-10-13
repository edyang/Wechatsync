/**
 * 文章内容
 *
 * 内容格式说明：
 * - markdown: 主要内容格式，由 content script 使用 Turndown + 原生 DOM 转换
 * - html: 可选的原始 HTML，某些平台可能需要
 */
export interface Article {
  title: string
  markdown: string    // Markdown 格式内容（主要）
  html?: string       // 原始 HTML（可选，用于某些需要 HTML 的平台）
  summary?: string
  cover?: string
  tags?: string[]
  category?: string
  source?: {
    url: string
    platform: string
  }
}

export type PublishStatus =
  | 'draft'
  | 'submitted'
  | 'reviewing'
  | 'scheduled'
  | 'published'
  | 'action_required'
  | 'rejected'
  | 'failed'
  | 'unknown'

export type PublishVisibility = 'public' | 'private' | 'unlisted' | 'unknown'

export type PublishInterventionReason =
  | 'captcha'
  | 'login_required'
  | 'identity_mismatch'
  | 'rate_limited'
  | 'review_rejected'
  | 'content_rejected'
  | 'unknown'

export interface PublishIntervention {
  reason: PublishInterventionReason
  message: string
  action: string
  detectedAt: number
  retryPublish: false
}

export interface PublishVerification {
  verified: boolean
  status: PublishStatus
  checkedAt: number
  method: 'publish_response' | 'public_api' | 'public_url' | 'cms_response'
  postId?: string
  postUrl?: string
  expectedTitle?: string
  actualTitle?: string
  authorId?: string
  authorName?: string
  visibility?: PublishVisibility
  error?: string
}

/**
 * 同步结果
 */
export interface SyncResult {
  platform: string
  success: boolean
  postId?: string
  postUrl?: string
  draftOnly?: boolean  // 是否只保存了草稿
  status?: PublishStatus
  verification?: PublishVerification
  intervention?: PublishIntervention
  error?: string
  message?: string  // 额外提示信息
  timestamp: number
}

/**
 * 认证状态
 */
export interface AuthResult {
  isAuthenticated: boolean
  username?: string
  userId?: string
  avatar?: string
  error?: string
}

/**
 * 平台能力
 */
export type PlatformCapability =
  | 'article'      // 发布文章
  | 'draft'        // 草稿支持
  | 'image_upload' // 图片上传
  | 'categories'   // 分类
  | 'tags'         // 标签
  | 'cover'        // 封面图
  | 'schedule'     // 定时发布
  | 'direct_publish' // 支持从完整草稿继续正式发布

/**
 * 平台元信息
 */
export interface PlatformMeta {
  id: string
  name: string
  icon: string
  homepage: string
  capabilities: PlatformCapability[]
}

/**
 * Cookie
 */
export interface Cookie {
  name: string
  value: string
  domain: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
}

/**
 * Header 规则
 */
export interface HeaderRule {
  id?: string
  urlFilter: string
  headers: Record<string, string>
  resourceTypes?: string[]
}

/**
 * 请求选项
 */
export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown>
  timeout?: number
}
