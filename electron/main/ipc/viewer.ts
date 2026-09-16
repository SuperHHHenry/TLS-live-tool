import { IPC_CHANNELS } from 'shared/ipcChannels'
import { viewerSessionManager } from '#/managers/ViewerSessionManager'
import { typedIpcMainHandle } from '#/utils'

export function setupViewerIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.login, async (_, id, accountName, url) => {
    try {
      await viewerSessionManager.open(id, accountName, url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.enterRoom, async (_, id, accountName, url) => {
    try {
      await viewerSessionManager.open(id, accountName, url)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.disconnect, (_, id) =>
    viewerSessionManager.disconnect(id),
  )
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.logout, (_, id, accountName) =>
    viewerSessionManager.logout(id, accountName),
  )
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.status, (_, id) => viewerSessionManager.isActive(id))
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.runtimeStatus, () =>
    viewerSessionManager.getRuntimeStatus(),
  )
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.autoCommentStart, async (_, id, config) => {
    try {
      await viewerSessionManager.startAutoComment(
        id,
        config.accountName,
        config.message,
        config.interval,
      )
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.autoCommentStop, (_, id) =>
    viewerSessionManager.stopAutoComment(id),
  )
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.autoCommentStartAll, async (_, config) => {
    try {
      await viewerSessionManager.startAutoCommentAll(config)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.autoCommentStopAll, () =>
    viewerSessionManager.stopAutoCommentAll(),
  )
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.detectLiveAccount, (_, url) =>
    viewerSessionManager.detectLiveAccount(url),
  )
  typedIpcMainHandle(IPC_CHANNELS.tasks.viewer.detectLiveAccounts, (_, urls) =>
    Promise.all(urls.map(url => viewerSessionManager.detectLiveAccount(url))),
  )
}
