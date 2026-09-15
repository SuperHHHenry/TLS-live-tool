import { LogIn, LogOut, MessageCircle, Plus, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IPC_CHANNELS } from 'shared/ipcChannels'
import { Title } from '@/components/common/Title'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { Message as AutoMessage } from '@/hooks/useAutoMessage'
import { useToast } from '@/hooks/useToast'
import { useViewerAccounts } from '@/hooks/useViewerAccounts'
import MessageEditor from '@/pages/AutoMessage/components/MessageEditor'

export default function ViewerAccounts() {
  const { accounts, roomUrl, setRoomUrl, add, remove, updateComment } = useViewerAccounts()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [watching, setWatching] = useState<Record<string, boolean>>({})
  const [commenting, setCommenting] = useState<Record<string, boolean>>({})
  const [rotating, setRotating] = useState(false)
  const [xDelay, setXDelay] = useState(30)
  useEffect(() => {
    const syncRuntimeStatus = async () => {
      const status = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.runtimeStatus)
      setWatching(Object.fromEntries(status.activeIds.map(id => [id, true])))
      setCommenting(Object.fromEntries(status.commentingIds.map(id => [id, true])))
      setRotating(status.rotating)
    }
    void syncRuntimeStatus()
    const timer = window.setInterval(syncRuntimeStatus, 2000)
    return () => window.clearInterval(timer)
  }, [])
  const { toast } = useToast()
  const connect = async (id: string, accountName: string) => {
    if (!roomUrl.trim()) return toast.error('请输入抖音直播间 URL')
    setBusy(id)
    const result = await window.ipcRenderer.invoke(
      IPC_CHANNELS.tasks.viewer.login,
      id,
      accountName,
      roomUrl,
    )
    setBusy(null)
    if (result.ok) {
      setWatching(s => ({ ...s, [id]: true }))
      toast.success('已登录并进入直播间')
    } else {
      toast.error(result.error || '登录或进入直播间失败')
    }
  }
  return (
    <div className="container py-8 space-y-6">
      <Title title="观众账号" description="登录普通抖音账号并进入同一个直播间" />
      <Card>
        <CardHeader>
          <CardTitle>直播间</CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            value={roomUrl}
            onChange={e => setRoomUrl(e.target.value)}
            placeholder="https://live.douyin.com/899023435607"
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>账号管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="观众账号名称"
            />
            <Button
              onClick={() => {
                if (name.trim()) {
                  add(name.trim())
                  setName('')
                }
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              添加
            </Button>
          </div>
          {accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">尚未添加观众账号</p>
          )}
          {accounts.map(a => (
            <div key={a.id} className="flex items-center justify-between border rounded-md p-3">
              <span>{a.name}</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => connect(a.id, a.name)}
                  disabled={busy === a.id || watching[a.id]}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  {busy === a.id ? '等待登录...' : watching[a.id] ? '观看中' : '登录并进入'}
                </Button>
                {commenting[a.id] ? (
                  <Button
                    size="icon"
                    variant="outline"
                    title="停止自动评论"
                    onClick={async () => {
                      await window.ipcRenderer.invoke(
                        IPC_CHANNELS.tasks.viewer.autoCommentStop,
                        a.id,
                      )
                      setCommenting(s => ({ ...s, [a.id]: false }))
                    }}
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="outline"
                    title="自动评论"
                    disabled={!watching[a.id] || !a.templates.some(message => message.trim())}
                    onClick={async () => {
                      const message = a.templates.find(item => item.trim())?.trim() || ''
                      const r = await window.ipcRenderer.invoke(
                        IPC_CHANNELS.tasks.viewer.autoCommentStart,
                        a.id,
                        {
                          accountName: a.name,
                          message,
                          interval: Math.max(1000, a.commentInterval[0] * 1000),
                        },
                      )
                      if (r.ok) setCommenting(s => ({ ...s, [a.id]: true }))
                      else toast.error(r.error || '启动失败')
                    }}
                  >
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="outline"
                  title="断开"
                  onClick={async () => {
                    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.disconnect, a.id)
                    setWatching(s => ({ ...s, [a.id]: false }))
                  }}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="destructive"
                  title="删除"
                  onClick={async () => {
                    await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.logout, a.id, a.name)
                    remove(a.id)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>自动评论</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.map(a => (
            <div key={a.id} className="border rounded p-3 space-y-2">
              <div className="font-medium">{a.name} 的评论模板</div>
              <MessageEditor
                messages={(a.templates || []).map((content, i) => ({
                  id: `${a.id}-${i}`,
                  content,
                  pinTop: false,
                }))}
                unlimitedLength={false}
                onChange={(ms: AutoMessage[]) =>
                  updateComment(
                    a.id,
                    ms.map(m => m.content),
                    a.commentInterval || [5, 15],
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateComment(a.id, [...(a.templates || []), ''], a.commentInterval || [5, 15])
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                添加模板
              </Button>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  value={(a.commentInterval || [5, 15])[0]}
                  onChange={e =>
                    updateComment(a.id, a.templates || [], [
                      Number(e.target.value) || 1,
                      (a.commentInterval || [5, 15])[1],
                    ])
                  }
                  className="w-24"
                />
                <span>-</span>
                <Input
                  type="number"
                  value={(a.commentInterval || [5, 15])[1]}
                  onChange={e =>
                    updateComment(a.id, a.templates || [], [
                      (a.commentInterval || [5, 15])[0],
                      Number(e.target.value) || 1,
                    ])
                  }
                  className="w-24"
                />
                <span>评论随机间隔（秒）</span>
              </div>
            </div>
          ))}
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              value={xDelay}
              onChange={e => setXDelay(Number(e.target.value))}
              className="w-24"
            />
            <span>账号间隔（秒）</span>
            <Button
              onClick={async () => {
                if (rotating) {
                  await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.autoCommentStopAll)
                  setRotating(false)
                  return
                }
                const r = await window.ipcRenderer.invoke(
                  IPC_CHANNELS.tasks.viewer.autoCommentStartAll,
                  {
                    accounts: accounts.map(a => ({
                      id: a.id,
                      name: a.name,
                      messages: a.templates || [],
                      commentInterval: a.commentInterval || [5, 15],
                    })),
                    accountInterval: xDelay * 1000,
                    count: [5, 10],
                  },
                )
                if (r.ok) setRotating(true)
                else toast.error(r.error || '启动失败')
              }}
            >
              {rotating ? '停止轮换' : '开始轮换'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
