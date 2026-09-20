import { useMemoizedFn } from 'ahooks'
import { useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { type LiveControlAutomationOwnership, useConnectLiveControl } from './useConnectLiveControl'
import { useIpcListener } from './useIpc'

// 在应用层监听，离开中控页面也能衔接原有连接及自动启动流程。
export function useScheduledLiveConnection() {
  const { connectLiveControl, isConnected } = useConnectLiveControl()
  const handledStartedAt = useRef<number | null>(null)
  const ownership = useRef<LiveControlAutomationOwnership | null>(null)
  const latestStatus = useRef<ScheduledLiveStatus>('idle')

  const stopOwnedAutomation = useMemoizedFn(async () => {
    const current = ownership.current
    if (!current) return
    ownership.current = null
    const requests: Promise<unknown>[] = [
      window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, current.accountId),
      ...current.viewerAccountIds.map(accountId =>
        window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.disconnect, accountId),
      ),
    ]
    if (current.viewerRotationStarted) {
      requests.push(window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.autoCommentStopAll))
    }
    await Promise.allSettled(requests)
  })

  useIpcListener(IPC_CHANNELS.tasks.scheduledLive.statusChanged, snapshot => {
    latestStatus.current = snapshot.status
    if (snapshot.status === 'completed') {
      void stopOwnedAutomation()
      return
    }
    if (snapshot.status === 'cancelled' || snapshot.status === 'failed') {
      ownership.current = null
      return
    }
    if (snapshot.status === 'countingDown' && snapshot.startedAt !== null) {
      if (handledStartedAt.current === snapshot.startedAt) return
      handledStartedAt.current = snapshot.startedAt
      if (isConnected !== 'disconnected') return
      void connectLiveControl().then(result => {
        if (latestStatus.current === 'cancelled' || latestStatus.current === 'failed') return
        ownership.current = result
        if (result && latestStatus.current === 'completed') void stopOwnedAutomation()
      })
    }
  })
}
