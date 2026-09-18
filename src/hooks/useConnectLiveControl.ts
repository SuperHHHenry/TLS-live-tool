import { useMemoizedFn } from 'ahooks'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { useAccounts } from '@/hooks/useAccounts'
import {
  createDefaultLuckyBagContext,
  toLuckyBagConfig,
  useAutoLuckyBagStore,
} from '@/hooks/useAutoLuckyBag'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { createDefaultAutoReplyConfig, useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { useCurrentChromeConfig } from '@/hooks/useChromeConfig'
import { useCurrentLiveControl, useCurrentLiveControlActions } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { startViewerAutomation } from '@/utils/startViewerAutomation'

export function useConnectLiveControl() {
  const { setIsConnected } = useCurrentLiveControlActions()
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const chromePath = useCurrentChromeConfig(context => context.path)
  const storageState = useCurrentChromeConfig(context => context.storageState)
  let headless = useCurrentChromeConfig(context => context.headless)
  const account = useAccounts(store => store.getCurrentAccount())

  if (platform === 'taobao') {
    headless = false
  }

  const { toast } = useToast()

  const connectLiveControl = useMemoizedFn(async () => {
    try {
      if (!account) {
        toast.error('找不到对应账号')
        return
      }
      setIsConnected('connecting')
      const result = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.connect, {
        headless,
        chromePath,
        storageState,
        platform,
        account,
      })

      if (result) {
        setIsConnected('connected')
        toast.success('已连接到直播控制台')
        if (platform === 'buyin') {
          await new Promise(resolve => window.setTimeout(resolve, 8000))
          const autoPopUpStore = useAutoPopUpStore.getState()
          const autoPopUp = autoPopUpStore.contexts[account.id]
          if (autoPopUp && !autoPopUp.isRunning) {
            try {
              const started = await window.ipcRenderer.invoke(
                IPC_CHANNELS.tasks.autoPopUp.start,
                account.id,
                autoPopUp.config,
              )
              autoPopUpStore.setIsRunning(account.id, started)
              if (started) toast.success('自动弹窗任务已启动')
              else toast.error('自动弹窗任务启动失败')
            } catch (error) {
              autoPopUpStore.setIsRunning(account.id, false)
              toast.error(error instanceof Error ? error.message : '自动弹窗任务启动失败')
            }
          }
          const luckyBagStore = useAutoLuckyBagStore.getState()
          const luckyBag = luckyBagStore.contexts[account.id] ?? createDefaultLuckyBagContext()
          if (!luckyBag.isRunning) {
            try {
              const started = await window.ipcRenderer.invoke(
                IPC_CHANNELS.tasks.autoLuckyBag.start,
                account.id,
                toLuckyBagConfig(luckyBag.intervalMinutes),
              )
              luckyBagStore.setIsRunning(account.id, started)
              if (started) toast.success('自动发福袋任务已开始')
              else toast.error('自动发福袋任务启动失败，请查看日志')
            } catch (error) {
              luckyBagStore.setIsRunning(account.id, false)
              toast.error(error instanceof Error ? error.message : '自动发福袋任务启动出错')
            }
          }
          const autoReplyStore = useAutoReplyStore.getState()
          const autoReply = autoReplyStore.contexts[account.id]
          if (autoReply?.isListening !== 'listening') {
            const savedConfig = useAutoReplyConfigStore.getState().contexts[account.id]?.config
            const config = savedConfig ?? createDefaultAutoReplyConfig()
            autoReplyStore.setIsListening(account.id, 'waiting')
            try {
              const started = await window.ipcRenderer.invoke(
                IPC_CHANNELS.tasks.autoReply.startCommentListener,
                account.id,
                {
                  source: config.entry,
                  ws: config.ws?.enable ? { port: config.ws.port } : undefined,
                },
              )
              if (started) {
                autoReplyStore.setIsListening(account.id, 'listening')
                autoReplyStore.setIsRunning(account.id, true)
                toast.success('自动回复任务已启动')
              } else {
                autoReplyStore.setIsListening(account.id, 'error')
                autoReplyStore.setIsRunning(account.id, false)
                toast.error('自动回复任务启动失败')
              }
            } catch (error) {
              autoReplyStore.setIsListening(account.id, 'error')
              autoReplyStore.setIsRunning(account.id, false)
              toast.error(error instanceof Error ? error.message : '自动回复任务启动失败')
            }
          } else if (!autoReply.isRunning) {
            autoReplyStore.setIsRunning(account.id, true)
            toast.success('自动回复任务已启动')
          }
          await startViewerAutomation(toast)
        }
      } else {
        throw new Error('连接直播控制台失败')
      }
    } catch (error) {
      setIsConnected('disconnected')
      toast.error(error instanceof Error ? error.message : '连接直播控制台失败')
    }
  })

  return { connectLiveControl, isConnected }
}
