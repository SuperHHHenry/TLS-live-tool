import { Result } from '@praha/byethrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../shared/ipcChannels'
import { AbortError, UnexpectedError } from '../errors/AppError'
import type { ScopedLogger } from '../logger'
import type { IStartLuckyBag } from '../platforms/IPlatform'
import windowManager from '../windowManager'
import { createAutoLuckyBagTask, type Scheduler } from './AutoLuckyBagTask'

vi.mock('../windowManager', () => ({ default: { send: vi.fn() } }))

function createFakeScheduler() {
  let id = 0
  const pending = new Map<number, { callback: () => void; delay: number }>()
  return {
    setTimeout(callback: () => void, delay: number) {
      pending.set(++id, { callback, delay })
      return id
    },
    clearTimeout(handle: unknown) {
      pending.delete(handle as number)
    },
    lastDelay: () => [...pending.values()].at(-1)?.delay,
    pendingCount: () => pending.size,
    async runNext() {
      const next = pending.entries().next().value
      if (!next) throw new Error('No scheduled run')
      pending.delete(next[0])
      await next[1].callback()
    },
  } satisfies Scheduler & Record<string, unknown>
}

function createFixture(
  perform = vi
    .fn<IStartLuckyBag['startFirstPendingLuckyBag']>()
    .mockResolvedValue(Result.succeed('started')),
) {
  const scheduler = createFakeScheduler()
  const logger = {
    scope: vi.fn(() => logger),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const platform: IStartLuckyBag = {
    _isStartLuckyBag: true,
    startFirstPendingLuckyBag: perform,
    getLuckyBagPage: () => null,
  }
  const account = { id: 'account-1', name: '测试账号' }
  const makeTask = (intervalMinutes = 10) =>
    createAutoLuckyBagTask(
      platform,
      { intervalMinutes },
      account,
      logger as unknown as ScopedLogger,
      scheduler,
    )
  const result = makeTask()
  if (Result.isFailure(result)) throw result.error
  return { task: result.value, perform, scheduler, logger, makeTask, account }
}

describe('createAutoLuckyBagTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs immediately and schedules the next run after configured minutes', async () => {
    const { task, perform, scheduler, logger } = createFixture()
    await task.start()
    expect(perform).toHaveBeenCalledOnce()
    expect(scheduler.lastDelay()).toBe(600_000)
    expect(logger.scope).toHaveBeenCalledWith('自动发福袋')
    expect(logger.success).toHaveBeenCalledOnce()
    expect(task.isRunning()).toBe(true)
  })

  it('keeps scheduling after no activity and a recoverable failure', async () => {
    const perform = vi
      .fn<IStartLuckyBag['startFirstPendingLuckyBag']>()
      .mockResolvedValueOnce(Result.succeed('no-pending-activity'))
      .mockResolvedValueOnce(Result.fail(new UnexpectedError({ description: 'DOM changed' })))
    const { task, scheduler, logger } = createFixture(perform)
    await task.start()
    expect(logger.warn).toHaveBeenCalledOnce()
    await scheduler.runNext()
    expect(logger.error).toHaveBeenCalledOnce()
    expect(task.isRunning()).toBe(true)
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('recovers from a rejected run and creates a fresh signal for the next run', async () => {
    const perform = vi
      .fn<IStartLuckyBag['startFirstPendingLuckyBag']>()
      .mockRejectedValueOnce(new Error('page closed'))
      .mockResolvedValueOnce(Result.succeed('started'))
    const { task, scheduler, logger } = createFixture(perform)
    await task.start()
    await scheduler.runNext()
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.success).toHaveBeenCalledOnce()
    expect(perform.mock.calls[0][0]).not.toBe(perform.mock.calls[1][0])
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('aborts the last run and clears the timer on stop, notifying once', async () => {
    const { task, perform, scheduler, account } = createFixture()
    await task.start()
    task.stop()
    task.stop()
    expect(scheduler.pendingCount()).toBe(0)
    expect(perform.mock.calls[0][0]?.aborted).toBe(true)
    expect(task.isRunning()).toBe(false)
    expect(windowManager.send).toHaveBeenCalledExactlyOnceWith(
      IPC_CHANNELS.tasks.autoLuckyBag.stoppedEvent,
      account.id,
    )
  })

  it('stops an in-flight first run without scheduling after it settles', async () => {
    let finish!: () => void
    const perform = vi.fn<IStartLuckyBag['startFirstPendingLuckyBag']>().mockImplementation(
      () =>
        new Promise(resolve => {
          finish = () => resolve(Result.succeed('started'))
        }),
    )
    const { task, scheduler, logger } = createFixture(perform)
    const starting = task.start()
    task.stop()
    expect(perform.mock.calls[0][0]?.aborted).toBe(true)
    finish()
    await starting
    expect(scheduler.pendingCount()).toBe(0)
    expect(logger.success).not.toHaveBeenCalled()
  })

  it.each([new AbortError(), new DOMException('Aborted', 'AbortError')])(
    'stops on cancellation without logging a recoverable error: %s',
    async error => {
      const perform = vi.fn<IStartLuckyBag['startFirstPendingLuckyBag']>().mockRejectedValue(error)
      const { task, scheduler, logger } = createFixture(perform)
      await task.start()
      expect(scheduler.pendingCount()).toBe(0)
      expect(task.isRunning()).toBe(false)
      expect(logger.error).not.toHaveBeenCalled()
      expect(windowManager.send).toHaveBeenCalledOnce()
    },
  )

  it('does not duplicate runs when started twice', async () => {
    const { task, perform, scheduler } = createFixture()
    await task.start()
    await task.start()
    expect(perform).toHaveBeenCalledOnce()
    expect(scheduler.pendingCount()).toBe(1)
  })

  it('ignores an old run that completes after a stop and restart', async () => {
    let finish!: () => void
    const perform = vi
      .fn<IStartLuckyBag['startFirstPendingLuckyBag']>()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = () => resolve(Result.succeed('started'))
          }),
      )
      .mockResolvedValue(Result.succeed('started'))
    const { task, scheduler, logger } = createFixture(perform)
    const firstStart = task.start()
    task.stop()
    await task.start()
    finish()
    await firstStart
    expect(task.isRunning()).toBe(true)
    expect(scheduler.pendingCount()).toBe(1)
    expect(logger.success).toHaveBeenCalledOnce()
  })

  it('accepts the largest minute interval supported by Node timers', async () => {
    const { makeTask, scheduler } = createFixture()
    const result = makeTask(35_791)
    if (Result.isFailure(result)) throw result.error
    await result.value.start()
    expect(scheduler.lastDelay()).toBe(2_147_460_000)
    result.value.stop()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 35_792, Number.MAX_SAFE_INTEGER])(
    'rejects invalid minute intervals: %s',
    intervalMinutes => {
      const { makeTask, perform, scheduler } = createFixture()
      expect(Result.isFailure(makeTask(intervalMinutes))).toBe(true)
      expect(perform).not.toHaveBeenCalled()
      expect(scheduler.pendingCount()).toBe(0)
    },
  )
})
