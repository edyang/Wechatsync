/**
 * CSDN 适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta, PublishVerification } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('CSDN')

interface CSDNUserInfo {
  csdnid: string
  username: string
  avatarurl: string
}

export class CSDNAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'csdn',
    name: 'CSDN',
    icon: 'https://g.csdnimg.cn/static/logo/favicon32.ico',
    homepage: 'https://editor.csdn.net/md/',
    capabilities: ['article', 'draft', 'image_upload', 'categories', 'tags', 'direct_publish'],
  }

  /** 预处理配置: CSDN 使用 Markdown 格式 */
  readonly preprocessConfig = {
    outputFormat: 'markdown' as const,
  }

  private userInfo: CSDNUserInfo | null = null

  // CSDN API 签名密钥
  private readonly API_KEY = '203803574'
  private readonly API_SECRET = '9znpamsyl2c7cdrr9sas0le9vbc3r6ba'

  /** CSDN API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://bizapi.csdn.net/*',
      headers: {
        'Origin': 'https://editor.csdn.net',
        'Referer': 'https://editor.csdn.net/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://imgservice.csdn.net/*',
      headers: {
        'Origin': 'https://editor.csdn.net',
        'Referer': 'https://editor.csdn.net/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/*',
      headers: {
        'Origin': 'https://editor.csdn.net',
        'Referer': 'https://editor.csdn.net/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  async checkAuth(): Promise<AuthResult> {
    try {
      return await this.withHeaderRules(this.HEADER_RULES, () => this.checkAuthRequest())
    } catch (error) {
      // CSDN 的身份接口偶尔会被 CORS/WAF 拦截。网页已登录时，
      // 使用 CSDN 自身的账号 + 会话 Cookie 作为受限回退，不读取密码。
      const cookieAuth = await this.checkCookieAuth()
      if (cookieAuth) return cookieAuth
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  private async checkAuthRequest(): Promise<AuthResult> {
    try {
      // 使用带签名的 API
      const apiPath = '/blog-console-api/v3/editor/getBaseInfo'
      const headers = await this.signRequest(apiPath, 'GET')

      const response = await this.runtime.fetch(
        `https://bizapi.csdn.net${apiPath}`,
        {
          method: 'GET',
          credentials: 'include',
          headers,
        }
      )

      const res = await response.json() as {
        code?: number | string
        message?: string
        msg?: string
        data?: {
          name?: string
          username?: string
          nickname?: string
          nickName?: string
          avatar?: string
          avatarurl?: string
          blog_url?: string
        }
      }

      logger.debug('checkAuth response:', res)

      const userId = res.data?.name || res.data?.username
      const username = res.data?.nickname || res.data?.nickName || userId
      const avatar = res.data?.avatar || res.data?.avatarurl || ''
      if (Number(res.code) === 200 && userId) {
        this.userInfo = {
          csdnid: userId,
          username: username || userId,
          avatarurl: avatar,
        }
        return {
          isAuthenticated: true,
          userId,
          username: username || userId,
          avatar,
        }
      }

      const cookieAuth = await this.checkCookieAuth()
      if (cookieAuth) return cookieAuth
      return {
        isAuthenticated: false,
        error: res.msg || res.message || `CSDN 认证接口返回异常（${res.code ?? '无状态码'}）`,
      }
    } catch (error) {
      const cookieAuth = await this.checkCookieAuth()
      if (cookieAuth) return cookieAuth
      throw error
    }
  }

  /**
   * CSDN 网页登录会写入 UserName/UserToken；同时要求账号标识和
   * 会话标识都存在，避免把遗留的昵称 Cookie 误判为有效登录。
   */
  private async checkCookieAuth(): Promise<AuthResult | null> {
    if (!this.runtime.getCookie) return null
    const domain = '.csdn.net'
    const [rawUserId, rawNickname, userToken, session] = await Promise.all([
      this.runtime.getCookie(domain, 'UserName'),
      this.runtime.getCookie(domain, 'UserNick'),
      this.runtime.getCookie(domain, 'UserToken'),
      this.runtime.getCookie(domain, 'SESSION'),
    ])
    if (!rawUserId || (!userToken && !session)) return null

    const decode = (value: string) => {
      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
    const userId = decode(rawUserId).trim()
    const username = rawNickname ? decode(rawNickname).trim() : userId
    if (!userId) return null

    this.userInfo = { csdnid: userId, username: username || userId, avatarurl: '' }
    return {
      isAuthenticated: true,
      userId,
      username: username || userId,
    }
  }

  /**
   * 生成 UUID
   */
  private createUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * HMAC-SHA256 签名 (使用 Web Crypto API)
   */
  private async hmacSha256(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(message)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)

    // 转换为 Base64
    const bytes = new Uint8Array(signature)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * 生成 CSDN API 签名
   * 签名格式: METHOD\nAccept\nContent-MD5\nContent-Type\n\nHeaders\nPath
   */
  private async signRequest(apiPath: string, method: 'GET' | 'POST' = 'POST'): Promise<Record<string, string>> {
    const nonce = this.createUuid()

    // GET: 没有 Content-Type，所以那一行为空
    // POST: Content-Type 为 application/json
    const signStr = method === 'GET'
      ? `GET\n*/*\n\n\n\nx-ca-key:${this.API_KEY}\nx-ca-nonce:${nonce}\n${apiPath}`
      : `POST\n*/*\n\napplication/json\n\nx-ca-key:${this.API_KEY}\nx-ca-nonce:${nonce}\n${apiPath}`

    logger.debug('Sign string:', JSON.stringify(signStr))

    const signature = await this.hmacSha256(signStr, this.API_SECRET)

    const headers: Record<string, string> = {
      'accept': '*/*',
      'x-ca-key': this.API_KEY,
      'x-ca-nonce': nonce,
      'x-ca-signature': signature,
      'x-ca-signature-headers': 'x-ca-key,x-ca-nonce',
    }

    if (method === 'POST') {
      headers['content-type'] = 'application/json'
    }

    return headers
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish...')

      // 1. 确保已登录
      if (!this.userInfo) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录 CSDN')
        }
      }

      // Use pre-processed markdown content directly
      let markdown = article.markdown || ''

      // Process images in markdown
      markdown = await this.processImages(
        markdown,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['csdnimg.cn', 'csdn.net'],
          onProgress: options?.onImageProgress,
        }
      )

      // Get HTML content (CSDN API needs both markdown and HTML)
      const htmlContent = article.html || ''

      // CSDN requires a CSDN-hosted cover URL, not the site's external OG image.
      let coverImage = article.cover || ''
      if (coverImage && !/(?:csdnimg\.cn|csdn\.net)/i.test(coverImage)) {
        const uploaded = await this.uploadImageByUrl(coverImage)
        coverImage = uploaded.url
      }

      const basePayload = {
        title: article.title,
        markdowncontent: markdown,
        content: htmlContent,
        readType: 'public',
        level: 0,
        tags: article.tags?.join(',') || '',
        categories: article.category || '',
        type: 'original',
        original_link: '',
        authorized_status: false,
        not_auto_saved: '1',
        source: 'pc_mdeditor',
        cover_images: coverImage ? [coverImage] : [],
        cover_type: coverImage ? 1 : 0,
        is_new: 1,
        vote_id: 0,
        resource_id: '',
        creator_activity_id: '',
      }

      // 正式提交前先完整保存草稿，失败时仍可人工处理。
      const draft = await this.saveArticle({
        ...basePayload,
        status: 2,
        pubStatus: 'draft',
      })
      const postId = String(draft.id)
      const draftUrl = `https://editor.csdn.net/md?articleId=${postId}`

      if (options?.draftOnly === false) {
        if (!article.tags?.length) {
          return this.createResult(false, {
            postId,
            postUrl: draftUrl,
            draftOnly: true,
            status: 'failed',
            error: 'CSDN 正式发布至少需要一个标签',
          })
        }
        try {
          return await this.publishDraft(postId, {
            ...basePayload,
            id: postId,
            status: 0,
            pubStatus: 'publish',
          }, article.title, {
            userId: options.expectedUserId,
            username: options.expectedUsername,
          })
        } catch (error) {
          return this.createResult(false, {
            postId,
            postUrl: draftUrl,
            draftOnly: true,
            status: 'failed',
            error: (error as Error).message,
          })
        }
      }

      return this.createResult(true, {
        postId,
        postUrl: draftUrl,
        draftOnly: true,
        status: 'draft',
      })
    }).catch((error) => this.createResult(false, {
      error: (error as Error).message,
    }))
  }

  private async saveArticle(payload: Record<string, unknown>): Promise<{ id: string | number; url?: string }> {
    const apiPath = '/blog-console-api/v3/mdeditor/saveArticle'
    const headers = await this.signRequest(apiPath)
    const response = await this.runtime.fetch(`https://bizapi.csdn.net${apiPath}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    })
    const responseText = await response.text()
    logger.debug('Save article response:', response.status, responseText.substring(0, 300))
    if (!response.ok) {
      throw new Error(`CSDN 保存失败: ${response.status} - ${responseText.substring(0, 300)}`)
    }
    let res: {
      code?: number
      message?: string
      msg?: string
      data?: { id?: string | number; url?: string }
    }
    try {
      res = JSON.parse(responseText)
    } catch {
      throw new Error(`CSDN 保存失败: 响应不是有效 JSON - ${responseText.substring(0, 200)}`)
    }
    if (res.code !== 200 || res.data?.id === undefined) {
      throw new Error(res.msg || res.message || 'CSDN 保存失败')
    }
    return { id: res.data.id, url: res.data.url }
  }

  /** 最终提交只执行一次，不在适配器内自动重试。 */
  private async publishDraft(
    draftId: string,
    payload: Record<string, unknown>,
    expectedTitle: string,
    expectedAuthor: { userId?: string; username?: string } = {},
  ): Promise<SyncResult> {
    const published = await this.saveArticle(payload)
    const articleId = String(published.id || draftId)
    const postUrl = published.url?.startsWith('http')
      ? published.url
      : `https://blog.csdn.net/${this.userInfo!.csdnid}/article/details/${articleId}`
    const verification = await this.verifyPublished(articleId, {
      title: expectedTitle,
      userId: expectedAuthor.userId,
      username: expectedAuthor.username,
    })
    if (verification.status === 'published') {
      return this.createResult(true, {
        postId: articleId,
        postUrl: verification.postUrl || postUrl,
        draftOnly: false,
        status: 'published',
        verification,
        message: '文章已正式发布并通过公开页面验证',
      })
    }
    const accepted: PublishVerification = {
      verified: true,
      status: 'submitted',
      checkedAt: Date.now(),
      method: 'publish_response',
      postId: articleId,
      postUrl,
      expectedTitle,
      visibility: 'unknown',
      error: verification.error,
    }
    return this.createResult(true, {
      postId: articleId,
      postUrl,
      draftOnly: false,
      status: 'submitted',
      verification: accepted,
      message: 'CSDN 已接受发布请求，尚未通过公开页面确认，将进入只读复查',
    })
  }

  async verifyPublished(
    postId: string,
    expected: { title?: string; userId?: string; username?: string } = {},
  ): Promise<PublishVerification> {
    const authorId = expected.userId || this.userInfo?.csdnid
    const postUrl = authorId
      ? `https://blog.csdn.net/${authorId}/article/details/${postId}`
      : `https://blog.csdn.net/article/details/${postId}`
    let lastError = '公开文章页暂不可用'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.runtime.fetch(postUrl, {
          method: 'GET',
          credentials: 'omit',
          headers: { Accept: 'text/html' },
        })
        if (!response.ok) {
          lastError = `公开文章验证失败: HTTP ${response.status}`
        } else {
          const html = await response.text()
          const actualTitle = decodeHtmlEntities(
            html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
              || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
              || '',
          ).replace(/\s*[-_] ?CSDN博客.*$/i, '').trim() || undefined
          const actualAuthorId = html.match(/https:\/\/blog\.csdn\.net\/([^/"'?]+)\/article\/details\//i)?.[1]
            || authorId
          const actualAuthorName = decodeHtmlEntities(
            html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i)?.[1] || '',
          ).trim() || undefined
          const titleMatches = !expected.title || actualTitle === expected.title.trim()
          const authorMatches = !expected.userId || actualAuthorId === expected.userId
          const usernameMatches = !expected.username || !actualAuthorName || actualAuthorName === expected.username
          const verified = Boolean(actualTitle) && titleMatches && authorMatches && usernameMatches
          return {
            verified,
            status: verified ? 'published' : 'unknown',
            checkedAt: Date.now(),
            method: 'public_url',
            postId,
            postUrl,
            expectedTitle: expected.title,
            actualTitle,
            authorId: actualAuthorId,
            authorName: actualAuthorName,
            visibility: verified ? 'public' : 'unknown',
            error: verified ? undefined : '公开文章信息与预期 ID、标题或作者不一致',
          }
        }
      } catch (error) {
        lastError = `公开文章验证失败: ${(error as Error).message}`
      }
      if (attempt < 2) await this.delay(300 * (attempt + 1))
    }
    return {
      verified: false,
      status: 'unknown',
      checkedAt: Date.now(),
      method: 'public_url',
      postId,
      postUrl,
      expectedTitle: expected.title,
      visibility: 'unknown',
      error: lastError,
    }
  }

  /**
   * 通过 Blob 上传图片（覆盖基类方法）
   * 需要设置动态请求头规则以支持 MCP 调用
   */
  async uploadImage(file: Blob, _filename?: string): Promise<string> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      // 转为 data URI 然后调用 uploadImageByUrl
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const result = await this.uploadImageByUrl(dataUri)
      return result.url
    })
  }

  /**
   * 通过 URL 上传图片
   */
  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    // 1. 下载图片
    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + src)
    }
    const imageBlob = await imageResponse.blob()

    // 2. 获取文件扩展名
    const ext = src.split('.').pop()?.toLowerCase()?.split('?')[0] || 'jpg'
    const validExt = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : 'jpg'

    // 3. 获取上传签名 (新 API: bizapi.csdn.net)
    const apiPath = '/resource-api/v1/image/direct/upload/signature'
    const headers = await this.signRequest(apiPath, 'POST')

    const signatureRes = await this.runtime.fetch(
      `https://bizapi.csdn.net${apiPath}`,
      {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          imageTemplate: '',
          appName: 'direct_blog_markdown',
          imageSuffix: validExt,
        }),
      }
    )

    const signatureData = await signatureRes.json() as {
      code: number
      data?: {
        filePath: string
        host: string
        accessId: string
        policy: string
        signature: string
        callbackUrl: string
        callbackBody: string
        callbackBodyType: string
        customParam: {
          rtype: string
          filePath: string
          isAudit: number
          'x-image-app': string
          type: string
          'x-image-suffix': string
          username: string
        }
      }
    }

    logger.debug('Upload signature response:', signatureData)

    if (signatureData.code !== 200 || !signatureData.data) {
      logger.warn('Failed to get upload signature, using original URL')
      return { url: src }
    }

    const uploadData = signatureData.data
    const customParam = uploadData.customParam

    // 4. 上传到华为云 OBS
    const formData = new FormData()
    formData.append('key', uploadData.filePath)
    formData.append('policy', uploadData.policy)
    formData.append('signature', uploadData.signature)
    formData.append('callbackBody', uploadData.callbackBody)
    formData.append('callbackBodyType', uploadData.callbackBodyType)
    formData.append('callbackUrl', uploadData.callbackUrl)
    formData.append('AccessKeyId', uploadData.accessId)
    formData.append('x:rtype', customParam.rtype)
    formData.append('x:filePath', customParam.filePath)
    formData.append('x:isAudit', String(customParam.isAudit))
    formData.append('x:x-image-app', customParam['x-image-app'])
    formData.append('x:type', customParam.type)
    formData.append('x:x-image-suffix', customParam['x-image-suffix'])
    formData.append('x:username', customParam.username)
    formData.append('file', imageBlob, `image.${validExt}`)

    const obsResponse = await this.runtime.fetch(uploadData.host, {
      method: 'POST',
      body: formData,
    })

    const obsRes = await obsResponse.json() as {
      code: number
      data?: { imageUrl: string }
    }

    logger.debug('OBS upload response:', obsRes)

    if (obsRes.code !== 200 || !obsRes.data?.imageUrl) {
      logger.warn('OBS upload failed, using original URL')
      return { url: src }
    }

    return {
      url: obsRes.data.imageUrl,
    }
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
}
