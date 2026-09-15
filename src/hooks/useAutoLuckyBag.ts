import { useCallback, useEffect } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAccounts } from './useAccounts'
import { useToast } from './useToast'

interface LuckyBagContext {
  intervalMinutes: number
  isRunning: boolean
}

interface LuckyBagStore {
  contexts: Record<string, LuckyBagContext>
  setIntervalMinutes: (accountId: string, intervalMinutes: number) => void
  setIsRunning: (accountId: string, isRunning: boolean) => void
}

// Pending requests are shared by page/sidebar hook instances and never persisted.
const pendingStarts = new Map<string, symbol>()
const pendingStops = new Map<string, symbol>()

export function createDefaultLuckyBagContext(): LuckyBagContext {
  return { intervalMinutes: 10, isRunning: false }
}

export function toLuckyBagConfig(intervalMinutes: number): AutoLuckyBagConfig {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 35791) {
    throw new Error('循环间隔必须为 1 到 35791 的整数分钟')
  }
  return { intervalMinutes }
}

export const useAutoLuckyBagStore = create<LuckyBagStore>()(
  persist(
    set => ({
      contexts: {},
      setIntervalMinutes: (accountId, intervalMinutes) =>
        set(state => ({
          contexts: {
            ...state.contexts,
            [accountId]: {
              ...(state.contexts[accountId] ?? createDefaultLuckyBagContext()),
              intervalMinutes,
            },
          },
        })),
      setIsRunning: (accountId, isRunning) =>
        set(state => ({
          contexts: {
            ...state.contexts,
            [accountId]: {
              ...(state.contexts[accountId] ?? createDefaultLuckyBagContext()),
              isRunning,
            },
          },
        })),
    }),
    {
      name: 'auto-lucky-bag-storage',
      partialize: state => ({
        contexts: Object.fromEntries(
          Object.entries(state.contexts).map(([accountId, context]) => [
            accountId,
            { intervalMinutes: context.intervalMinutes },
          ]),
        ),
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as
          | { contexts?: Record<string, Pick<LuckyBagContext, 'intervalMinutes'>> }
          | undefined
        return {
          ...currentState,
          contexts: Object.fromEntries(
            Object.entries(persisted?.contexts ?? {}).map(([accountId, context]) => [
              accountId,
              { intervalMinutes: context.intervalMinutes, isRunning: false },
            ]),
          ),
        }
      },
    },
  ),
)

export function useAutoLuckyBag() {
  const accountId = useAccounts(state => state.currentAccountId)
  const intervalMinutes = useAutoLuckyBagStore(
    state => state.contexts[accountId]?.intervalMinutes ?? 10,
  )
  const isRunning = useAutoLuckyBagStore(state => state.contexts[accountId]?.isRunning ?? false)
  const updateInterval = useAutoLuckyBagStore(state => state.setIntervalMinutes)
  const setIsRunning = useAutoLuckyBagStore(state => state.setIsRunning)
  const { toast } = useToast()

  const setIntervalMinutes = useCallback(
    (value: number) => updateInterval(accountId, value),
    [accountId, updateInterval],
  )

  const start = useCallback(async () => {
    const requestToken = Symbol()
    let requestRegistered = false
    try {
      const config = toLuckyBagConfig(intervalMinutes)
      pendingStops.delete(accountId)
      pendingStarts.set(accountId, requestToken)
      requestRegistered = true
      setIsRunning(accountId, true)
      const started = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoLuckyBag.start,
        accountId,
        config,
      )
      if (pendingStarts.get(accountId) !== requestToken) return
      if (started) {
        toast.success('自动发福袋任务已开始')
      } else {
        setIsRunning(accountId, false)
        toast.error('自动发福袋任务启动失败，请查看日志')
      }
    } catch (error) {
      if (requestRegistered) {
        if (pendingStarts.get(accountId) !== requestToken) return
        setIsRunning(accountId, false)
      }
      toast.error(error instanceof Error ? error.message : '自动发福袋任务启动出错')
    } finally {
      if (pendingStarts.get(accountId) === requestToken) pendingStarts.delete(accountId)
    }
  }, [accountId, intervalMinutes, setIsRunning, toast])

  const stop = useCallback(async () => {
    const requestToken = Symbol()
    pendingStops.set(accountId, requestToken)
    try {
      const stopped = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.autoLuckyBag.stop,
        accountId,
      )
      if (pendingStops.get(accountId) !== requestToken) return
      if (stopped) {
        pendingStarts.delete(accountId)
        setIsRunning(accountId, false)
        toast.success('自动发福袋任务已停止')
      } else {
        toast.error('自动发福袋任务停止失败，请查看日志')
      }
    } catch {
      if (pendingStops.get(accountId) === requestToken) {
        toast.error('自动发福袋任务停止出错')
      }
    } finally {
      if (pendingStops.get(accountId) === requestToken) pendingStops.delete(accountId)
    }
  }, [accountId, setIsRunning, toast])

  useEffect(
    () =>
      window.ipcRenderer.on(IPC_CHANNELS.tasks.autoLuckyBag.stoppedEvent, stoppedAccountId => {
        pendingStarts.delete(stoppedAccountId)
        setIsRunning(stoppedAccountId, false)
      }),
    [setIsRunning],
  )

  return { intervalMinutes, setIntervalMinutes, isRunning, start, stop }
}
