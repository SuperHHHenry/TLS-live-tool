import { Result } from '@praha/byethrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../shared/ipcChannels'
import { setupAutoLuckyBagIpcHandlers } from './autoLuckyBag'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  getSession: vi.fn(),
  getAccountName: vi.fn(() => '测试账号'),
  scope: vi.fn(),
  error: vi.fn(),
}))

vi.mock('#/utils', () => ({ typedIpcMainHandle: mocks.handle }))
vi.mock('#/managers/AccountManager', () => ({ accountManager: mocks }))
vi.mock('#/logger', () => ({ createLogger: () => ({ scope: mocks.scope }) }))

function handler(channel: string) {
  const match = mocks.handle.mock.calls.find(([name]) => name === channel)
  if (!match) throw new Error(`Missing handler: ${channel}`)
  return match[1]
}

describe('autoLuckyBag IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.scope.mockReturnValue({ error: mocks.error })
    setupAutoLuckyBagIpcHandlers()
  })

  it('starts the configured task in the requested account and returns true', async () => {
    const startTask = vi.fn().mockResolvedValue(Result.succeed())
    mocks.getSession.mockReturnValue(Result.succeed({ startTask }))
    expect(
      await handler(IPC_CHANNELS.tasks.autoLuckyBag.start)(null, 'account-1', {
        intervalMinutes: 10,
      }),
    ).toBe(true)
    expect(mocks.getSession).toHaveBeenCalledWith('account-1')
    expect(startTask).toHaveBeenCalledWith({
      type: 'auto-lucky-bag',
      config: { intervalMinutes: 10 },
    })
  })

  it('stops the requested account task and returns true', async () => {
    const stopTask = vi.fn()
    mocks.getSession.mockReturnValue(Result.succeed({ stopTask }))
    expect(await handler(IPC_CHANNELS.tasks.autoLuckyBag.stop)(null, 'account-1')).toBe(true)
    expect(mocks.getSession).toHaveBeenCalledWith('account-1')
    expect(stopTask).toHaveBeenCalledWith('auto-lucky-bag')
  })

  it.each(['start', 'stop'] as const)(
    'returns false and logs a missing session on %s',
    async action => {
      const error = new Error('account missing')
      mocks.getSession.mockReturnValue(Result.fail(error))
      expect(
        await handler(IPC_CHANNELS.tasks.autoLuckyBag[action])(null, 'account-1', {
          intervalMinutes: 10,
        }),
      ).toBe(false)
      expect(mocks.scope).toHaveBeenCalledWith('自动发福袋')
      expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error)
    },
  )

  it('returns false when the task cannot be created', async () => {
    const error = new Error('invalid configuration')
    const startTask = vi.fn().mockResolvedValue(Result.fail(error))
    mocks.getSession.mockReturnValue(Result.succeed({ startTask }))
    expect(
      await handler(IPC_CHANNELS.tasks.autoLuckyBag.start)(null, 'account-1', {
        intervalMinutes: 0,
      }),
    ).toBe(false)
    expect(mocks.error).toHaveBeenCalledWith(expect.any(String), error)
  })
})
