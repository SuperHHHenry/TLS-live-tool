import { IPC_CHANNELS } from 'shared/ipcChannels'
import { scheduledLiveService } from '#/services/ScheduledLiveService'
import { typedIpcMainHandle } from '#/utils'

export function setupScheduledLiveIpcHandlers() {
  typedIpcMainHandle(IPC_CHANNELS.tasks.scheduledLive.start, (_, params) => {
    return scheduledLiveService.start(params.hours, params.minutes)
  })
  typedIpcMainHandle(IPC_CHANNELS.tasks.scheduledLive.cancel, () => {
    return scheduledLiveService.cancel()
  })
  typedIpcMainHandle(IPC_CHANNELS.tasks.scheduledLive.status, () => {
    return scheduledLiveService.getSnapshot()
  })
}
