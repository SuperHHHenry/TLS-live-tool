import { useCallback, useEffect, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'

const EMPTY_SNAPSHOT: ScheduledLiveSnapshot = {
  status: 'idle',
  durationMs: null,
  startedAt: null,
  endsAt: null,
  error: null,
}

export function useScheduledLive() {
  const [snapshot, setSnapshot] = useState<ScheduledLiveSnapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    let active = true
    window.ipcRenderer
      .invoke(IPC_CHANNELS.tasks.scheduledLive.status)
      .then(value => active && setSnapshot(value))
    const unsubscribe = window.ipcRenderer.on(
      IPC_CHANNELS.tasks.scheduledLive.statusChanged,
      setSnapshot,
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const start = useCallback(async (hours: number, minutes: number) => {
    const value = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.scheduledLive.start, {
      hours,
      minutes,
    })
    setSnapshot(value)
  }, [])

  const cancel = useCallback(async () => {
    const value = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.scheduledLive.cancel)
    setSnapshot(value)
  }, [])

  return { snapshot, start, cancel }
}
