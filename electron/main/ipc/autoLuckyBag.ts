import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import { accountManager } from '#/managers/AccountManager'
import { typedIpcMainHandle } from '#/utils'

const TASK_NAME = '自动发福袋'
const TASK_TYPE = 'auto-lucky-bag'

export function setupAutoLuckyBagIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.tasks.autoLuckyBag.start, async (_, accountId, config) => {
    const result = await Result.pipe(
      accountManager.getSession(accountId),
      Result.andThen(session => session.startTask({ type: TASK_TYPE, config })),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
        logger.error('启动任务失败：', error)
      }),
    )
    return Result.isSuccess(result)
  })

  typedIpcMainHandle(IPC_CHANNELS.tasks.autoLuckyBag.stop, (_, accountId) => {
    return Result.pipe(
      accountManager.getSession(accountId),
      Result.inspect(session => session.stopTask(TASK_TYPE)),
      Result.inspectError(error => {
        const logger = createLogger(`@${accountManager.getAccountName(accountId)}`).scope(TASK_NAME)
        logger.error('停止任务失败：', error)
      }),
      Result.isSuccess,
    )
  })
}
