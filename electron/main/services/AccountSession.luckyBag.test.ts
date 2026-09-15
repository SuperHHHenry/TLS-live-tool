import { Result } from '@praha/byethrow'
import type { CDPSession, Page } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScopedLogger } from '../logger'
import { XiaohongshuCommentListener } from '../platforms/xiaohongshu/commentListener'
import { type ITask, type TaskStopCallback, TaskStopReason } from '../tasks/ITask'
import { AccountSession } from './AccountSession'

const mocks = vi.hoisted(() => ({
  supported: true,
  createLuckyBagTask: vi.fn(),
  createCommentListenerTask: vi.fn(),
  perform: vi.fn(),
  commentListener: null as XiaohongshuCommentListener | null,
  logger: {
    scope: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('#/errors/AppError', () => import('../errors/AppError'))
vi.mock('#/event/eventBus', () => ({ emitter: { emit: vi.fn() } }))
vi.mock('#/logger', () => ({ createLogger: () => mocks.logger }))
vi.mock('#/managers/BrowserSessionManager', () => ({ browserManager: {} }))
vi.mock('#/platforms', () => ({
  platformFactory: {
    buyin: class {
      platformName = '百应'
      _isCommentListener = true
      startFirstPendingLuckyBag = mocks.perform
      startCommentListener(onComment: (comment: LiveMessage) => void) {
        return mocks.commentListener?.startCommentListener(onComment)
      }
      stopCommentListener() {
        mocks.commentListener?.stopCommentListener()
      }
      get _isStartLuckyBag() {
        return mocks.supported
      }
    },
  },
}))
vi.mock('#/platforms/IPlatform', () => import('../platforms/IPlatform'))
vi.mock('#/tasks/AutoCommentTask', () => ({ createAutoCommentTask: vi.fn() }))
vi.mock('#/tasks/AutoLuckyBagTask', () => ({ createAutoLuckyBagTask: mocks.createLuckyBagTask }))
vi.mock('#/tasks/AutoPopupTask', () => ({ createAutoPopupTask: vi.fn() }))
vi.mock('#/tasks/CommentListenerTask', () => ({
  createCommentListenerTask: mocks.createCommentListenerTask,
}))
vi.mock('#/services/WebSocketService', () => ({ WebSocketService: vi.fn() }))
vi.mock('#/tasks/PinCommentTask', () => ({ createPinCommentTask: vi.fn() }))
vi.mock('#/tasks/SendBatchMessageTask', () => ({ createSendBatchMessageTask: vi.fn() }))
vi.mock('#/windowManager', () => ({ default: { send: vi.fn() } }))

function fixture() {
  let finish!: () => void
  let running = false
  const listeners: TaskStopCallback[] = []
  const task: ITask = {
    start: vi.fn(() => {
      running = true
      return new Promise<void>(resolve => {
        finish = resolve
      })
    }),
    stop: vi.fn(() => {
      running = false
      for (const listener of listeners) listener('task-id', TaskStopReason.MANUAL)
    }),
    getTaskId: () => 'task-id',
    isRunning: () => running,
    addStopListener: listener => {
      listeners.push(listener)
    },
  }
  mocks.createLuckyBagTask.mockReturnValue(Result.succeed(task))
  const account = { id: 'account-1', name: '测试账号' }
  const session = new AccountSession('buyin', account, mocks.logger as unknown as ScopedLogger)
  return { session, task, account, finish: () => finish() }
}

describe('AccountSession lucky bag tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.supported = true
    mocks.logger.scope.mockReturnValue(mocks.logger)
    mocks.perform.mockReset()
    mocks.commentListener = null
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('creates the lucky bag task on a supported platform', async () => {
    const { session, account, task, finish } = fixture()
    const starting = session.startTask({ type: 'auto-lucky-bag', config: { intervalMinutes: 10 } })
    expect(mocks.createLuckyBagTask).toHaveBeenCalledWith(
      expect.anything(),
      { intervalMinutes: 10 },
      account,
      mocks.logger,
    )
    finish()
    expect(Result.isSuccess(await starting)).toBe(true)
    session.stopTask('auto-lucky-bag')
    expect(task.stop).toHaveBeenCalledOnce()
  })

  it('rejects platforms without the lucky bag capability', async () => {
    mocks.supported = false
    const { session } = fixture()
    const result = await session.startTask({
      type: 'auto-lucky-bag',
      config: { intervalMinutes: 10 },
    })
    expect(Result.isFailure(result)).toBe(true)
    expect(mocks.createLuckyBagTask).not.toHaveBeenCalled()
  })

  it('can stop during the first run and does not re-register the stopped task', async () => {
    const { session, task, finish } = fixture()
    const starting = session.startTask({ type: 'auto-lucky-bag', config: { intervalMinutes: 10 } })
    session.stopTask('auto-lucky-bag')
    expect(task.stop).toHaveBeenCalledOnce()
    finish()
    await starting
    session.stopTask('auto-lucky-bag')
    expect(task.stop).toHaveBeenCalledOnce()
  })
  it.each(['stop', 'disconnect'] as const)(
    'keeps one loop for consecutive same-account starts, then cancels it on %s',
    async cleanup => {
      vi.useFakeTimers()
      const { createAutoLuckyBagTask } = await vi.importActual<
        typeof import('../tasks/AutoLuckyBagTask')
      >('../tasks/AutoLuckyBagTask')
      mocks.createLuckyBagTask.mockImplementation(createAutoLuckyBagTask)
      mocks.perform.mockResolvedValue(Result.succeed('started'))
      const session = new AccountSession('buyin', { id: 'account-1', name: '测试账号' })
      const input = { type: 'auto-lucky-bag', config: { intervalMinutes: 10 } } as const
      await session.startTask(input)
      await session.startTask(input)
      expect(mocks.perform).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(1)
      if (cleanup === 'stop') session.stopTask('auto-lucky-bag')
      else session.disconnect()
      expect(mocks.perform.mock.calls.every(([signal]) => signal.aborted)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(mocks.perform).toHaveBeenCalledOnce()
    },
  )

  it.each(['stop', 'disconnect'] as const)(
    'keeps one in-flight run for concurrent same-account starts, then cancels it on %s',
    async cleanup => {
      vi.useFakeTimers()
      const { createAutoLuckyBagTask } = await vi.importActual<
        typeof import('../tasks/AutoLuckyBagTask')
      >('../tasks/AutoLuckyBagTask')
      mocks.createLuckyBagTask.mockImplementation(createAutoLuckyBagTask)
      let finish!: () => void
      const pending = new Promise(resolve => {
        finish = () => resolve(Result.succeed('started'))
      })
      mocks.perform.mockReturnValue(pending)
      const session = new AccountSession('buyin', { id: 'account-1', name: '测试账号' })
      const input = { type: 'auto-lucky-bag', config: { intervalMinutes: 10 } } as const
      const starting = session.startTask(input)
      const duplicate = session.startTask(input)
      expect(mocks.perform).toHaveBeenCalledOnce()
      if (cleanup === 'stop') session.stopTask('auto-lucky-bag')
      else session.disconnect()
      expect(mocks.perform.mock.calls.every(([signal]) => signal.aborted)).toBe(true)
      finish()
      await Promise.all([starting, duplicate])
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(600_000)
      expect(mocks.perform).toHaveBeenCalledOnce()
    },
  )

  it('does not let an old stop listener remove a replacement lucky bag task', async () => {
    const first = fixture()
    const input = { type: 'auto-lucky-bag', config: { intervalMinutes: 10 } } as const
    const firstStart = first.session.startTask(input)
    first.finish()
    await firstStart
    first.session.stopTask('auto-lucky-bag')
    const second = fixture()
    const secondStart = first.session.startTask(input)
    second.finish()
    await secondStart
    first.task.stop()
    first.session.stopTask('auto-lucky-bag')
    expect(second.task.stop).toHaveBeenCalledOnce()
  })

  it('retains cleanup for a comment listener after late CDP initialization', async () => {
    const { createCommentListenerTask } = await vi.importActual<
      typeof import('../tasks/CommentListenerTask')
    >('../tasks/CommentListenerTask')
    mocks.createCommentListenerTask.mockImplementation(createCommentListenerTask)
    const cdpHandlers = new Set<unknown>()
    const pageHandlers = new Set<unknown>()
    const client = {
      send: vi.fn().mockResolvedValue(undefined),
      on: (_event: string, handler: unknown) => cdpHandlers.add(handler),
      off: (_event: string, handler: unknown) => cdpHandlers.delete(handler),
    } as unknown as CDPSession
    let finish!: () => void
    const pending = new Promise<CDPSession>(resolve => {
      finish = () => resolve(client)
    })
    const page = {
      context: () => ({ newCDPSession: () => pending }),
      on: (_event: string, handler: unknown) => pageHandlers.add(handler),
      off: (_event: string, handler: unknown) => pageHandlers.delete(handler),
    } as unknown as Page
    mocks.commentListener = new XiaohongshuCommentListener(page)
    const session = new AccountSession('buyin', { id: 'account-1', name: '测试账号' })
    const starting = session.startTask({ type: 'comment-listener', config: { source: 'compass' } })
    session.stopTask('comment-listener')
    finish()
    await starting
    expect(cdpHandlers.size).toBe(1)
    expect(pageHandlers.size).toBe(1)
    session.stopTask('comment-listener')
    session.disconnect()
    expect(cdpHandlers.size).toBe(0)
    expect(pageHandlers.size).toBe(0)
  })
})
