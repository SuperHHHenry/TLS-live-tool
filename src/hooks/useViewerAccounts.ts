import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewerAccount = {
  id: string
  name: string
  templates: string[]
  commentInterval: [number, number]
}
type Store = {
  accounts: ViewerAccount[]
  roomUrl: string
  setRoomUrl: (url: string) => void
  add: (name: string) => void
  rename: (id: string, name: string) => void
  updateComment: (id: string, templates: string[], commentInterval: [number, number]) => void
  remove: (id: string) => void
}
export const useViewerAccounts = create<Store>()(
  persist(
    set => ({
      accounts: [],
      roomUrl: '',
      setRoomUrl: roomUrl => set({ roomUrl }),
      add: name =>
        set(s => ({
          accounts: [
            ...s.accounts,
            { id: crypto.randomUUID(), name, templates: [], commentInterval: [5, 15] },
          ],
        })),
      updateComment: (id: string, templates: string[], commentInterval: [number, number]) =>
        set(s => ({
          accounts: s.accounts.map(a => (a.id === id ? { ...a, templates, commentInterval } : a)),
        })),
      rename: (id, name) =>
        set(s => ({ accounts: s.accounts.map(a => (a.id === id ? { ...a, name } : a)) })),
      remove: id => set(s => ({ accounts: s.accounts.filter(a => a.id !== id) })),
    }),
    {
      name: 'viewer-accounts',
      version: 2,
      migrate: (state: unknown) => {
        const saved = state as Partial<Store> | undefined
        return {
          ...saved,
          accounts: (saved?.accounts || []).map(account => ({
            ...account,
            templates: (account as ViewerAccount).templates || [],
            commentInterval: (account as ViewerAccount).commentInterval || [5, 15],
          })),
        } as Store
      },
    },
  ),
)
