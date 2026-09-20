import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useViewerAccounts } from '@/hooks/useViewerAccounts'

type Notify = {
  success: (message: string) => void
  error: (message: string) => void
}

export interface ViewerAutomationOwnership {
  accountIds: string[]
  rotationStarted: boolean
}

const EMPTY_OWNERSHIP: ViewerAutomationOwnership = { accountIds: [], rotationStarted: false }

export async function startViewerAutomation(notify: Notify): Promise<ViewerAutomationOwnership> {
  const store = useViewerAccounts.getState()
  if (!store.liveAccounts.length || !store.accounts.length) return EMPTY_OWNERSHIP

  let roomUrl: string | null = null
  for (const liveAccount of store.liveAccounts) {
    store.updateLiveAccount(liveAccount.id, { liveStatus: 'checking' })
    const result = await window.ipcRenderer.invoke(
      IPC_CHANNELS.tasks.viewer.detectLiveAccount,
      liveAccount.sourceUrl,
    )
    store.updateLiveAccount(liveAccount.id, {
      ...result,
      lastCheckedAt: new Date().toISOString(),
    })
    if (result.liveStatus === 'live' && result.roomUrl) {
      roomUrl = result.roomUrl
      break
    }
  }

  if (!roomUrl) {
    notify.error('当前没有检测到可进入的直播间')
    return EMPTY_OWNERSHIP
  }

  const enteredIds = new Set<string>()
  for (const account of store.accounts) {
    const result = await window.ipcRenderer.invoke(
      IPC_CHANNELS.tasks.viewer.login,
      account.id,
      account.name,
      roomUrl,
    )
    if (result.ok) enteredIds.add(account.id)
  }

  if (!enteredIds.size) {
    notify.error('观众账号均未能进入直播间')
    return EMPTY_OWNERSHIP
  }

  const commentAccounts = store.accounts
    .filter(
      account => enteredIds.has(account.id) && account.templates.some(message => message.trim()),
    )
    .map(account => ({
      id: account.id,
      name: account.name,
      messages: account.templates.filter(message => message.trim()),
      commentInterval: account.commentInterval,
    }))

  if (commentAccounts.length) {
    const result = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.autoCommentStartAll, {
      accounts: commentAccounts,
      accountInterval: 30000,
      count: [5, 10],
    })
    if (!result.ok) {
      notify.error(result.error || '自动评论轮换启动失败')
      return { accountIds: [...enteredIds], rotationStarted: false }
    }
  }

  notify.success(
    commentAccounts.length ? '观众账号已进入直播间并开启评论轮换' : '观众账号已进入直播间',
  )
  return { accountIds: [...enteredIds], rotationStarted: commentAccounts.length > 0 }
}
