import { LogIn, LogOut, MessageCircle, Plus, RefreshCw, Square, Trash2 } from 'lucide-react'
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
  const {
    accounts,
    add,
    remove,
    updateComment,
    liveAccounts,
    addLiveAccount,
    updateLiveAccount,
    removeLiveAccount,
  } = useViewerAccounts()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [watching, setWatching] = useState<Record<string, boolean>>({})
  const [commenting, setCommenting] = useState<Record<string, boolean>>({})
  const [rotating, setRotating] = useState(false)
  const [xDelay, setXDelay] = useState(30)
  const [liveUrl, setLiveUrl] = useState('')
  const [addingLive, setAddingLive] = useState(false)
  const [refreshingLive, setRefreshingLive] = useState(false)
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
  const detectLive = async (url: string) => {
    const result = await window.ipcRenderer.invoke(IPC_CHANNELS.tasks.viewer.detectLiveAccount, url)
    return { ...result, lastCheckedAt: new Date().toISOString() }
  }
  const normalizeUrl = (value: string) => {
    try {
      const url = new URL(value)
      url.hash = ''
      url.search = ''
      return url.toString().replace(/\/$/, '')
    } catch {
      return value.trim().replace(/\/$/, '')
    }
  }
  const addLive = async () => {
    const sourceUrl = liveUrl.trim()
    if (!sourceUrl || addingLive) return
    if (liveAccounts.some(account => normalizeUrl(account.sourceUrl) === normalizeUrl(sourceUrl))) {
      toast.error('该直播账号已添加')
      return
    }
    setAddingLive(true)
    try {
      const result = await detectLive(sourceUrl)
      if (!result.ok) {
        toast.error(result.error || '无法读取直播账号，请检查链接')
        return
      }
      if (
        result.accountId &&
        liveAccounts.some(account => account.accountId === result.accountId)
      ) {
        toast.error('该直播账号已添加')
        return
      }
      addLiveAccount({
        id: crypto.randomUUID(),
        sourceUrl,
        accountId: result.accountId,
        accountName: result.accountName,
        liveStatus: result.liveStatus,
        roomUrl: result.roomUrl,
        lastCheckedAt: result.lastCheckedAt,
        error: result.error,
      })
      setLiveUrl('')
    } finally {
      setAddingLive(false)
    }
  }
  const refreshLiveAccounts = async () => {
    if (refreshingLive || !liveAccounts.length) return
    setRefreshingLive(true)
    try {
      const results = await Promise.all(liveAccounts.map(a => detectLive(a.sourceUrl)))
      results.forEach((result, i) => {
        updateLiveAccount(liveAccounts[i].id, result)
      })
      toast.success('刷新成功')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setRefreshingLive(false)
    }
  }
  const connect = async (id: string, accountName: string) => {
    setBusy(id)
    try {
      let roomUrl: string | null = null
      for (const liveAccount of liveAccounts) {
        updateLiveAccount(liveAccount.id, { liveStatus: 'checking' })
        const detected = await detectLive(liveAccount.sourceUrl)
        updateLiveAccount(liveAccount.id, detected)
        if (detected.liveStatus === 'live' && detected.roomUrl) {
          roomUrl = detected.roomUrl
          break
        }
      }
      if (!roomUrl) {
        toast.error('当前没有检测到可进入的直播间')
        return
      }
      const result = await window.ipcRenderer.invoke(
        IPC_CHANNELS.tasks.viewer.login,
        id,
        accountName,
        roomUrl,
      )
      if (result.ok) {
        setWatching(s => ({ ...s, [id]: true }))
        toast.success('已登录并进入直播间')
      } else {
        toast.error(result.error || '登录或进入直播间失败')
      }
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="container py-8 space-y-6">
      <Title title="观众账号" description="登录普通抖音账号并进入同一个直播间" />
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>主播直播账号</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              添加多个主播链接，自动读取账号名称和开播状态
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshLiveAccounts}
            disabled={refreshingLive || !liveAccounts.length}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshingLive ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={liveUrl}
              onChange={e => setLiveUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void addLive()
              }}
              disabled={addingLive}
              placeholder="粘贴主播主页或直播间链接"
            />
            <Button disabled={!liveUrl.trim() || addingLive} onClick={() => void addLive()}>
              {addingLive ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {addingLive ? '读取中' : '添加'}
            </Button>
          </div>
          {!liveAccounts.length && (
            <p className="text-sm text-muted-foreground">尚未添加主播账号</p>
          )}
          {liveAccounts.map(a => (
            <div
              key={a.id}
              className="flex items-center justify-between border rounded-md p-3 gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{a.accountName}</div>
                <div className="text-xs text-muted-foreground truncate">{a.sourceUrl}</div>
                <div className="text-xs mt-1">
                  <span
                    className={
                      a.liveStatus === 'live'
                        ? 'text-green-600'
                        : a.liveStatus === 'offline'
                          ? 'text-muted-foreground'
                          : 'text-amber-600'
                    }
                  >
                    {a.liveStatus === 'live'
                      ? '直播中'
                      : a.liveStatus === 'offline'
                        ? '未开播'
                        : a.liveStatus === 'checking'
                          ? '检测中...'
                          : '暂无法判断'}
                  </span>
                  {a.lastCheckedAt && (
                    <span className="text-muted-foreground ml-2">
                      {new Date(a.lastCheckedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="icon"
                variant="destructive"
                title="删除"
                onClick={() => {
                  if (window.confirm(`确定删除主播账号“${a.accountName}”吗？`))
                    removeLiveAccount(a.id)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
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
                    a.commentInterval || [120, 130],
                  )
                }
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateComment(a.id, [...(a.templates || []), ''], a.commentInterval || [120, 130])
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                添加模板
              </Button>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  value={(a.commentInterval || [120, 130])[0]}
                  onChange={e =>
                    updateComment(a.id, a.templates || [], [
                      Number(e.target.value) || 1,
                      (a.commentInterval || [120, 130])[1],
                    ])
                  }
                  className="w-24"
                />
                <span>-</span>
                <Input
                  type="number"
                  value={(a.commentInterval || [120, 130])[1]}
                  onChange={e =>
                    updateComment(a.id, a.templates || [], [
                      (a.commentInterval || [120, 130])[0],
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
                      commentInterval: a.commentInterval || [120, 130],
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
