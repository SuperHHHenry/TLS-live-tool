import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewerAccount = {
  id: string
  name: string
  templates: string[]
  commentInterval: [number, number]
}
export type LiveAccountStatus = 'live' | 'offline' | 'unknown' | 'checking'
export type LiveAccount = {
  id: string
  sourceUrl: string
  accountId: string | null
  accountName: string
  liveStatus: LiveAccountStatus
  roomUrl: string | null
  lastCheckedAt: string | null
  error?: string
}
type Store = {
  accounts: ViewerAccount[]
  liveAccounts: LiveAccount[]
  roomUrl: string
  setRoomUrl: (url: string) => void
  add: (name: string) => void
  rename: (id: string, name: string) => void
  updateComment: (id: string, templates: string[], commentInterval: [number, number]) => void
  remove: (id: string) => void
  addLiveAccount: (account: LiveAccount) => void
  updateLiveAccount: (id: string, update: Partial<LiveAccount>) => void
  removeLiveAccount: (id: string) => void
}
export const useViewerAccounts = create<Store>()(
  persist(
    set => ({
      accounts: [],
      liveAccounts: [],
      roomUrl: '',
      setRoomUrl: roomUrl => set({ roomUrl }),
      add: name =>
        set(s => ({
          accounts: [
            ...s.accounts,
            { id: crypto.randomUUID(), name, templates: [], commentInterval: [120, 130] },
          ],
        })),
      updateComment: (id: string, templates: string[], commentInterval: [number, number]) =>
        set(s => ({
          accounts: s.accounts.map(a => (a.id === id ? { ...a, templates, commentInterval } : a)),
        })),
      rename: (id, name) =>
        set(s => ({ accounts: s.accounts.map(a => (a.id === id ? { ...a, name } : a)) })),
      remove: id => set(s => ({ accounts: s.accounts.filter(a => a.id !== id) })),
      addLiveAccount: account => set(s => ({ liveAccounts: [...s.liveAccounts, account] })),
      updateLiveAccount: (id, update) =>
        set(s => ({
          liveAccounts: s.liveAccounts.map(a => (a.id === id ? { ...a, ...update } : a)),
        })),
      removeLiveAccount: id =>
        set(s => ({ liveAccounts: s.liveAccounts.filter(a => a.id !== id) })),
    }),
    {
      name: 'viewer-accounts',
      version: 3,
      migrate: (state: unknown) => {
        const saved = state as Partial<Store> | undefined
        return {
          ...saved,
          accounts: (saved?.accounts || []).map(account => ({
            ...account,
            templates: (account as ViewerAccount).templates || [],
            commentInterval: (account as ViewerAccount).commentInterval || [120, 130],
          })),
          liveAccounts: saved?.liveAccounts || [],
        } as Store
      },
    },
  ),
)
