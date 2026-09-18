import { Clock3Icon, PlayIcon, XIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useScheduledLive } from '@/hooks/useScheduledLive'
import { useToast } from '@/hooks/useToast'

const ACTIVE_STATUSES: ScheduledLiveStatus[] = [
  'starting',
  'waitingForLive',
  'countingDown',
  'stopping',
  'verifyingStopped',
]

const STATUS_LABELS: Record<ScheduledLiveStatus, string> = {
  idle: '等待启动',
  starting: '正在打开直播伴侣并点击开始直播',
  waitingForLive: '等待确认开播成功',
  countingDown: '直播中，正在倒计时',
  stopping: '正在点击关播',
  verifyingStopped: '正在确认直播已经结束',
  completed: '定时直播已完成',
  cancelled: '任务已取消，直播不会自动关闭',
  failed: '任务执行失败',
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainingSeconds = seconds % 60
  return [hours, minutes, remainingSeconds].map(value => String(value).padStart(2, '0')).join(':')
}

export default function ScheduledLiveCard() {
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('30')
  const [now, setNow] = useState(Date.now())
  const { snapshot, start, cancel } = useScheduledLive()
  const { toast } = useToast()
  const isActive = ACTIVE_STATUSES.includes(snapshot.status)

  useEffect(() => {
    if (snapshot.status !== 'countingDown') return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [snapshot.status])

  const validationError = useMemo(() => {
    const hourValue = Number(hours)
    const minuteValue = Number(minutes)
    if (!Number.isInteger(hourValue) || hourValue < 0) return '小时必须是非负整数'
    if (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 59) {
      return '分钟必须是 0 到 59 的整数'
    }
    if (hourValue === 0 && minuteValue === 0) return '直播时长必须大于 0'
    return null
  }, [hours, minutes])

  const handleStart = async () => {
    if (validationError) return
    try {
      await start(Number(hours), Number(minutes))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '启动定时直播失败')
    }
  }

  const handleCancel = async () => {
    try {
      await cancel()
      toast.success('自动任务已取消，不会主动关闭当前直播')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '取消任务失败')
    }
  }

  const remaining = snapshot.endsAt ? snapshot.endsAt - now : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>定时开关播</CardTitle>
        <CardDescription>确认开播成功后开始计时，到时自动完成关播确认</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="scheduled-live-hours">小时</Label>
            <Input
              id="scheduled-live-hours"
              className="w-28"
              type="number"
              min={0}
              step={1}
              value={hours}
              disabled={isActive}
              onChange={event => setHours(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduled-live-minutes">分钟</Label>
            <Input
              id="scheduled-live-minutes"
              className="w-28"
              type="number"
              min={0}
              max={59}
              step={1}
              value={minutes}
              disabled={isActive}
              onChange={event => setMinutes(event.target.value)}
            />
          </div>
          {isActive ? (
            <Button variant="outline" onClick={handleCancel}>
              <XIcon className="mr-2 h-4 w-4" />
              取消任务
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={!!validationError}>
                  <PlayIcon className="mr-2 h-4 w-4" />
                  启动任务
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认启动定时直播？</AlertDialogTitle>
                  <AlertDialogDescription>
                    程序会将抖音直播伴侣恢复并置于前台，然后点击“开始直播”。确认开播后才会开始倒计时。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleStart}>确认启动</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {validationError && !isActive && (
          <p className="text-sm text-destructive">{validationError}</p>
        )}

        <Alert variant={snapshot.status === 'failed' ? 'destructive' : 'default'}>
          <Clock3Icon className="h-4 w-4" />
          <AlertTitle>{STATUS_LABELS[snapshot.status]}</AlertTitle>
          <AlertDescription>
            {snapshot.status === 'countingDown' && remaining !== null
              ? `剩余时间 ${formatDuration(remaining)}`
              : snapshot.error || '应用退出后任务不会恢复。取消任务不会主动关闭正在进行的直播。'}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}
