import type { ScopedLogger } from '../logger'

type LoggerFactory = (name: string) => ScopedLogger

export function createViewerAccountLogger(accountName: string, loggerFactory: LoggerFactory) {
  const logger = loggerFactory(`@${accountName}`).scope('观众账号')

  return {
    loginSucceeded() {
      logger.success('登录并进入直播间成功')
    },
    loginFailed(error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error(`登录或进入直播间失败：${reason}`)
    },
    disconnected() {
      logger.info('已退出直播间')
    },
    loggedOut() {
      logger.info('已退出账号并清除登录状态')
    },
  }
}
