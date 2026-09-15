import { Title } from '@/components/common/Title'
import { CarbonPlayFilledAlt, CarbonStopFilledAlt } from '@/components/icons/carbon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAutoLuckyBag } from '@/hooks/useAutoLuckyBag'
import { useCurrentLiveControl } from '@/hooks/useLiveControl'

export default function AutoLuckyBag() {
  const { intervalMinutes, setIntervalMinutes, isRunning, start, stop } = useAutoLuckyBag()
  const isConnected = useCurrentLiveControl(context => context.isConnected)

  return (
    <div className="container py-8 space-y-4">
      <Title title="自动发福袋" description="定时开始百应中控台中待开始的福袋活动" />
      <Card>
        <CardHeader>
          <CardTitle>任务设置</CardTitle>
          <CardDescription>
            启动后立即尝试发放福袋，每次执行完成后等待设定间隔再继续。暂无待开始活动时自动等待下次执行。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="lucky-bag-interval">循环间隔（分钟）</Label>
            <Input
              id="lucky-bag-interval"
              type="number"
              min="1"
              max="35791"
              step="1"
              value={intervalMinutes}
              onChange={event => setIntervalMinutes(Number(event.target.value))}
              disabled={isRunning}
              className="w-40"
            />
            <p className="text-xs text-muted-foreground">
              请输入 1 到 35791 的整数分钟，默认为 10 分钟。
            </p>
          </div>
          <Button
            onClick={isRunning ? stop : start}
            disabled={!isRunning && isConnected !== 'connected'}
            size="lg"
          >
            {isRunning ? (
              <CarbonStopFilledAlt className="mr-2 h-4 w-4" />
            ) : (
              <CarbonPlayFilledAlt className="mr-2 h-4 w-4" />
            )}
            {isRunning ? '停止任务' : '开始任务'}
          </Button>
          {isConnected !== 'connected' && (
            <p className="text-sm text-muted-foreground">请先连接直播控制台</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
