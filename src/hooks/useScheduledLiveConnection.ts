import { useRef } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useConnectLiveControl } from './useConnectLiveControl'
import { useIpcListener } from './useIpc'

// 在应用层监听，离开中控页面也能衔接原有连接及自动启动流程。
export function useScheduledLiveConnection() {
  const { connectLiveControl, isConnected } = useConnectLiveControl()
  const handledStartedAt = useRef<number | null>(null)

  useIpcListener(IPC_CHANNELS.tasks.scheduledLive.statusChanged, snapshot => {
    if (snapshot.status !== 'countingDown' || snapshot.startedAt === null) return
    if (handledStartedAt.current === snapshot.startedAt) return
    handledStartedAt.current = snapshot.startedAt
    if (isConnected !== 'disconnected') return
    void connectLiveControl()
  })
}
