import type { ScopedLogger } from '../logger'

type LoggerFactory = (name: string) => ScopedLogger

export function createViewerCommentLogger(accountName: string, loggerFactory: LoggerFactory) {
  const logger = loggerFactory(`@${accountName}`).scope('自动评论')

  return {
    started() {
      logger.info('已启动自动评论')
    },
    async run<T>(content: string, send: () => Promise<T>) {
      try {
        const result = await send()
        logger.success(`已发送评论：${content}`)
        return result
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error(`评论发送失败：${reason}；评论内容：${content}`)
        throw error
      }
    },
    stopped() {
      logger.info('已停止自动评论')
    },
  }
}
