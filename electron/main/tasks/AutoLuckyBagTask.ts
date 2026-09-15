import { Result } from '@praha/byethrow'
import { IPC_CHANNELS } from '../../../shared/ipcChannels'
import { AbortError } from '../errors/AppError'
import type { ScopedLogger } from '../logger'
import type { IStartLuckyBag } from '../platforms/IPlatform'
import windowManager from '../windowManager'
import { createTask } from './BaseTask'

export interface Scheduler {
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

const nativeScheduler: Scheduler = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const TASK_NAME = '自动发福袋'
const MAX_INTERVAL_MINUTES = Math.floor(2_147_483_647 / 60_000)

export function createAutoLuckyBagTask(
  platform: IStartLuckyBag,
  config: AutoLuckyBagConfig,
  account: Account,
  parentLogger: ScopedLogger,
  scheduler: Scheduler = nativeScheduler,
) {
  if (
    !Number.isInteger(config.intervalMinutes) ||
    config.intervalMinutes <= 0 ||
    config.intervalMinutes > MAX_INTERVAL_MINUTES
  ) {
    return Result.fail(new Error(`福袋间隔必须是 1 到 ${MAX_INTERVAL_MINUTES} 的整数分钟`))
  }

  const logger = parentLogger.scope(TASK_NAME)
  const delay = config.intervalMinutes * 60_000
  let timer: unknown
  let controller: AbortController | undefined

  const task = createTask(
    { taskName: TASK_NAME, logger },
    {
      onStart: runOnce,
      onStop() {
        if (timer !== undefined) scheduler.clearTimeout(timer)
        timer = undefined
        controller?.abort()
      },
    },
  )

  async function runOnce() {
    if (!task.isRunning()) return
    timer = undefined
    const currentController = new AbortController()
    controller = currentController
    const { signal } = currentController
    try {
      const result = await platform.startFirstPendingLuckyBag(signal)
      if (signal.aborted || !task.isRunning()) return
      if (Result.isFailure(result)) throw result.error
      if (result.value === 'started') {
        logger.success('福袋活动已开始')
      } else {
        logger.warn('暂无待开始的福袋活动，等待下次执行')
      }
    } catch (error) {
      if (signal.aborted || !task.isRunning()) return
      if (error instanceof AbortError || (error instanceof Error && error.name === 'AbortError')) {
        task.stop()
        return
      }
      logger.error('发福袋失败，等待下次执行：', error)
    }
    if (!signal.aborted && task.isRunning()) {
      timer = scheduler.setTimeout(runOnce, delay)
    }
  }

  task.addStopListener(() => {
    windowManager.send(IPC_CHANNELS.tasks.autoLuckyBag.stoppedEvent, account.id)
  })

  return Result.succeed(task)
}
