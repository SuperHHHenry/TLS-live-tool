import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { createLogger } from '../logger'
import { type BrowserSession, browserManager } from './BrowserSessionManager'
import { createViewerAccountLogger } from './ViewerAccountLogger'
import { createViewerCommentLogger } from './ViewerCommentLogger'
import { isRotationCurrent } from './ViewerRotationGate'
import { createViewerRuntimeStatus } from './ViewerRuntimeStatus'

export type ViewerStatus =
  | 'disconnected'
  | 'opening'
  | 'waiting-login'
  | 'entering-room'
  | 'in-room'
  | 'error'

class ViewerSessionManager {
  private sessions = new Map<string, BrowserSession>()
  private accountNames = new Map<string, string>()
  private commentTimers = new Map<
    string,
    { timer: ReturnType<typeof setInterval>; accountName: string }
  >()
  private rotationTimer: ReturnType<typeof setTimeout> | undefined
  private rotationGeneration = 0
  private rotationAccountNames: string[] = []
  isActive(id: string) {
    return this.sessions.has(id)
  }
  getRuntimeStatus() {
    return createViewerRuntimeStatus(
      this.sessions,
      this.commentTimers,
      this.rotationAccountNames.length > 0,
    )
  }
  private statePath(id: string) {
    return path.join(app.getPath('userData'), 'viewer-accounts', id, 'storage-state.json')
  }
  private async loadState(id: string) {
    try {
      return JSON.parse(await fs.readFile(this.statePath(id), 'utf8'))
    } catch {
      return undefined
    }
  }
  private validRoom(url: string) {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname !== 'live.douyin.com')
      throw new Error('请输入有效的抖音直播间 URL')
    if (!/^\d+$/.test(u.pathname.slice(1))) throw new Error('直播间地址格式无效')
    return u.toString()
  }
  async open(
    id: string,
    accountName: string,
    roomUrl: string,
    onStatus?: (s: ViewerStatus) => void,
  ) {
    const logger = createViewerAccountLogger(accountName, createLogger)
    try {
      const url = this.validRoom(roomUrl)
      await this.disconnect(id)
      onStatus?.('opening')
      const state = await this.loadState(id)
      const session = await browserManager.createSession(false, state)
      this.sessions.set(id, session)
      this.accountNames.set(id, accountName)
      session.page.on('close', () => {
        if (this.sessions.get(id) !== session) return
        this.sessions.delete(id)
        this.stopAutoComment(id)
        logger.disconnected()
        onStatus?.('disconnected')
      })
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      const logged = await this.isLoggedIn(session)
      if (!logged) {
        onStatus?.('waiting-login')
        await this.openLogin(session)
        await this.waitLogin(session)
        await fs.mkdir(path.dirname(this.statePath(id)), { recursive: true })
        await fs.writeFile(this.statePath(id), JSON.stringify(await session.context.storageState()))
      }
      onStatus?.('entering-room')
      await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      onStatus?.('in-room')
      logger.loginSucceeded()
      return true
    } catch (error) {
      logger.loginFailed(error)
      throw error
    }
  }
  private async isLoggedIn(s: BrowserSession) {
    const teaConfig = await s.page.locator('#script-set-tea-config').getAttribute('data-value')
    if (teaConfig) {
      try {
        const config = JSON.parse(teaConfig) as { user_is_login?: number | boolean }
        if (config.user_is_login === 0 || config.user_is_login === false) return false
        if (config.user_is_login === 1 || config.user_is_login === true) return true
      } catch {
        // 页面配置格式变化时继续使用 DOM 和 Cookie 作为兜底。
      }
    }
    // 直播页未登录时不会跳转到固定 login URL，而是在聊天区显示提示。
    const unauthenticated = s.page
      .getByText(/需先登录|请先登录|登录后才能/, { exact: false })
      .first()
    if (await unauthenticated.isVisible().catch(() => false)) return false
    const loginButton = s.page.getByText('登录', { exact: true }).first()
    if (await loginButton.isVisible().catch(() => false)) return false
    const cookies = await s.context.cookies('https://live.douyin.com')
    return cookies.some(
      cookie =>
        /^(sessionid|sessionid_ss|sid_tt|uid_tt)$/.test(cookie.name) && cookie.value.length > 0,
    )
  }
  private async openLogin(s: BrowserSession) {
    const end = Date.now() + 30000
    while (Date.now() < end) {
      // 当前直播页的入口是聊天区中的 span「登录」，它本身没有 button/a 祖先。
      const exactLoginSpans = s.page.locator('span').filter({ hasText: /^登录$/ })
      if (await this.clickFirstVisible(exactLoginSpans)) return

      const triggers = s.page.getByText(/登录/, { exact: false })
      if (await this.clickFirstVisible(triggers)) return
      await s.page.waitForTimeout(500)
    }
    throw new Error('30 秒内未找到抖音直播页的登录入口')
  }
  private async clickFirstVisible(triggers: ReturnType<BrowserSession['page']['locator']>) {
    for (let i = 0; i < (await triggers.count()); i++) {
      const trigger = triggers.nth(i)
      if (await trigger.isVisible().catch(() => false)) {
        const clicked = await trigger
          .evaluate(element => {
            const clickable = element.closest('button, [role="button"], a') ?? element
            ;(clickable as HTMLElement).click()
            return true
          })
          .catch(() => false)
        if (clicked) return true
      }
    }
    return false
  }
  private async waitLogin(s: BrowserSession) {
    const end = Date.now() + 300000
    while (Date.now() < end) {
      if (await this.isLoggedIn(s)) return
      await s.page.waitForTimeout(1000)
    }
    throw new Error('等待抖音账号登录超时')
  }
  async disconnect(id: string) {
    this.stopAutoComment(id)
    const s = this.sessions.get(id)
    if (s) {
      this.sessions.delete(id)
      await s.browser.close().catch(() => {})
      const accountName = this.accountNames.get(id)
      if (accountName) createViewerAccountLogger(accountName, createLogger).disconnected()
    }
    return true
  }
  async startAutoComment(id: string, accountName: string, message: string, interval: number) {
    const s = this.sessions.get(id)
    if (!s) throw new Error('账号尚未进入直播间')
    if (!message.trim()) throw new Error('评论内容不能为空')
    this.stopAutoComment(id)
    await this.sendCommentOnce(id, accountName, message)
    const timer = setInterval(
      () => {
        this.sendCommentOnce(id, accountName, message).catch(() => this.stopAutoComment(id))
      },
      Math.max(1000, interval),
    )
    this.commentTimers.set(id, { timer, accountName })
    createViewerCommentLogger(accountName, createLogger).started()
    return true
  }
  private async sendCommentOnce(id: string, accountName: string, message: string) {
    const s = this.sessions.get(id)
    if (!s) throw new Error('账号尚未进入直播间')
    if (!message.trim()) throw new Error('评论内容不能为空')
    const logger = createViewerCommentLogger(accountName, createLogger)
    await logger.run(message, async () => {
      const input = s.page
        .locator('#chatInput, [contenteditable="true"], textarea, input[placeholder*="评论"]')
        .first()
      if (!(await input.count())) throw new Error('未找到评论输入框')
      await input.click()
      // 抖音评论框是 contenteditable div，不能使用 fill；先清空再模拟键盘输入
      await input.press('ControlOrMeta+A')
      await input.press('Backspace')
      await input.pressSequentially(message)
      const sendButton = input.locator('xpath=..').locator('button, [role="button"], svg').last()
      if (!(await sendButton.count())) throw new Error('未找到评论发送按钮')
      await sendButton.click()
    })
  }
  stopAutoComment(id: string) {
    const activeComment = this.commentTimers.get(id)
    if (activeComment) {
      clearInterval(activeComment.timer)
      this.commentTimers.delete(id)
      createViewerCommentLogger(activeComment.accountName, createLogger).stopped()
    }
    return true
  }
  async startAutoCommentAll(config: {
    accounts: { id: string; name: string; messages: string[]; commentInterval: [number, number] }[]
    accountInterval: number
    count: [number, number]
  }) {
    if (!config.accounts.length || config.accounts.some(a => !a.messages.length))
      throw new Error('请为每个账号配置评论模板')
    this.stopAutoCommentAll()
    const generation = ++this.rotationGeneration
    this.rotationAccountNames = config.accounts.map(account => account.name)
    for (const accountName of this.rotationAccountNames) {
      createViewerCommentLogger(accountName, createLogger).started()
    }
    let index = 0
    const run = async () => {
      const account = config.accounts[index % config.accounts.length]
      index++
      const id = account.id
      const s = this.sessions.get(id)
      if (s) {
        const n =
          Math.floor(Math.random() * (config.count[1] - config.count[0] + 1)) + config.count[0]
        const pool = [...account.messages].sort(() => Math.random() - 0.5)
        const total = Math.min(n, pool.length)
        for (let i = 0; i < total; i++) {
          if (!isRotationCurrent(generation, this.rotationGeneration)) return
          await this.sendCommentOnce(id, account.name, pool[i])
          if (i < total - 1) {
            const delay =
              account.commentInterval[0] * 1000 +
              Math.random() *
                Math.max(0, (account.commentInterval[1] - account.commentInterval[0]) * 1000)
            await new Promise(r => setTimeout(r, Math.max(1000, delay)))
            if (!isRotationCurrent(generation, this.rotationGeneration)) return
          }
        }
      }
      if (generation === this.rotationGeneration) {
        this.rotationTimer = setTimeout(run, config.accountInterval)
      }
    }
    void run().catch(() => this.stopAutoCommentAll())
    return true
  }
  stopAutoCommentAll() {
    this.rotationGeneration++
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer)
      this.rotationTimer = undefined
    }
    for (const accountName of this.rotationAccountNames) {
      createViewerCommentLogger(accountName, createLogger).stopped()
    }
    this.rotationAccountNames = []
    for (const id of this.commentTimers.keys()) this.stopAutoComment(id)
    return true
  }
  async logout(id: string, accountName: string) {
    await this.disconnect(id)
    await fs.rm(path.dirname(this.statePath(id)), { recursive: true, force: true })
    this.accountNames.delete(id)
    createViewerAccountLogger(accountName, createLogger).loggedOut()
    return true
  }
  async cleanup() {
    for (const id of this.sessions.keys()) await this.disconnect(id)
  }
}
export const viewerSessionManager = new ViewerSessionManager()
