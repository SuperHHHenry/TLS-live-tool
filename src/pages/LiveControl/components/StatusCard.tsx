import { useMemoizedFn } from 'ahooks'
import { CheckIcon, CircleAlert, GlobeIcon, XIcon } from 'lucide-react'
import React, { useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAccounts } from '@/hooks/useAccounts'
import {
  createDefaultLuckyBagContext,
  toLuckyBagConfig,
  useAutoLuckyBagStore,
} from '@/hooks/useAutoLuckyBag'
import { useAutoPopUpStore } from '@/hooks/useAutoPopUp'
import { useAutoReplyStore } from '@/hooks/useAutoReply'
import { createDefaultAutoReplyConfig, useAutoReplyConfigStore } from '@/hooks/useAutoReplyConfig'
import { useCurrentChromeConfig, useCurrentChromeConfigActions } from '@/hooks/useChromeConfig'
import { useCurrentLiveControl, useCurrentLiveControlActions } from '@/hooks/useLiveControl'
import { useToast } from '@/hooks/useToast'
import { startViewerAutomation } from '@/utils/startViewerAutomation'
import PlatformSelect from './PlatformSelect'

const StatusAlert = React.memo(() => {
  const platform = useCurrentLiveControl(state => state.platform)
  if (platform === 'wxchannel') {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>你选择了视频号平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>再连接中控台
            </li>
            <li>
              视频号助手无法<strong>一号多登</strong>，在别处登录视频号助手会
              <strong>中断连接</strong>!
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  if (platform === 'taobao') {
    return (
      <Alert>
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>你选择了淘宝平台，请注意以下事项：</AlertTitle>
        <AlertDescription>
          <ol className="list-decimal list-inside">
            <li>
              请先确认<strong>开播后</strong>
              再连接中控台，因为进入淘宝中控台需要获取<strong>直播间ID</strong>
            </li>
            <li>
              目前淘宝会触发人机验证，所以将<strong>强制关闭无头模式</strong>
              ，除了登录和人机验证之外请尽量不要操作浏览器
            </li>
          </ol>
        </AlertDescription>
      </Alert>
    )
  }
  return null
})

const StatusCard = React.memo(() => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>控制台状态</CardTitle>
        <CardDescription>查看并管理直播控制台的连接状态</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <ConnectState />
            <div className="flex items-center gap-2">
              <PlatformSelect />
              <ConnectToLiveControl />
            </div>
          </div>
          <StatusAlert />
          <Separator />
          <HeadlessSetting />
        </div>
      </CardContent>
    </Card>
  )
})

const ConnectToLiveControl = React.memo(() => {
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

  const disconnectLiveControl = useMemoizedFn(async () => {
    if (!account) {
      toast.error('找不到对应账号')
      return
    }
    try {
      await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.liveControl.disconnect, account.id)
      toast.success('已断开连接')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '断开连接失败')
    } finally {
      setIsConnected('disconnected')
    }
  })

  const handleButtonClick = useMemoizedFn(() => {
    if (isConnected === 'connected') {
      disconnectLiveControl()
    } else {
      connectLiveControl()
    }
  })

  return isConnected === 'connected' ? (
    <DisconnectButton handleButtonClick={handleButtonClick} />
  ) : (
    <ConnectButton isLoading={isConnected === 'connecting'} handleButtonClick={handleButtonClick} />
  )
})

const ConnectButton = React.memo(
  ({ isLoading, handleButtonClick }: { isLoading: boolean; handleButtonClick: () => void }) => {
    return (
      <Button variant={'default'} onClick={handleButtonClick} disabled={isLoading} size="sm">
        <GlobeIcon className="mr-2 h-4 w-4" />
        {isLoading ? '连接中...' : '连接直播控制台'}
      </Button>
    )
  },
)

const DisconnectButton = React.memo(({ handleButtonClick }: { handleButtonClick: () => void }) => {
  const [isHovered, setIsHovered] = useState(false)
  return (
    <Button
      variant="secondary"
      onClick={handleButtonClick}
      size="sm"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isHovered ? (
        <>
          <XIcon className="mr-2 h-4 w-4" />
          断开连接
        </>
      ) : (
        <>
          <CheckIcon className="mr-2 h-4 w-4" />
          已连接
        </>
      )}
    </Button>
  )
})

const ConnectState = React.memo(() => {
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const accountName = useCurrentLiveControl(context => context.accountName)
  return (
    <div className="flex items-center gap-4">
      <div
        className={`w-2 h-2 rounded-full ${isConnected === 'connected' ? 'bg-green-500' : 'bg-gray-300'}`}
      />
      <span className="text-sm text-muted-foreground">
        {isConnected === 'connected' ? `已连接${accountName ? ` (${accountName})` : ''}` : '未连接'}
      </span>
    </div>
  )
})

const HeadlessSetting = () => {
  const headless = useCurrentChromeConfig(context => context.headless ?? false)
  const platform = useCurrentLiveControl(context => context.platform)
  const isConnected = useCurrentLiveControl(context => context.isConnected)
  const { setHeadless } = useCurrentChromeConfigActions()
  return (
    <div className="flex justify-between items-center">
      <div>
        <div className="text-sm">无头模式</div>
        <div className="text-muted-foreground text-xs">
          开启后浏览器将在后台运行，不会在桌面显示
        </div>
      </div>
      <Switch
        checked={headless && platform !== 'taobao'}
        disabled={platform === 'taobao' || isConnected !== 'disconnected'}
        onCheckedChange={v => setHeadless(v)}
      />
    </div>
  )
}

export default StatusCard
