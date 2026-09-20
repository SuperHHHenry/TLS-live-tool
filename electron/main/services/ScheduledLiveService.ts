import { IPC_CHANNELS } from 'shared/ipcChannels'
import { createLogger } from '#/logger'
import windowManager from '#/windowManager'
import {
  createLiveCompanionDriver,
  isLiveCompanionScanLimitError,
  type LiveCompanionDriver,
  type LiveCompanionState,
} from './live-companion'

const POLL_INTERVAL_MS = 1_000
const START_TIMEOUT_MS = 3 * 60_000
const CONFIRM_TIMEOUT_MS = 20_000
const STOP_TIMEOUT_MS = 30_000

const ACTIVE_STATUSES: ScheduledLiveStatus[] = [
  'starting',
  'waitingForLive',
  'countingDown',
  'stopping',
  'verifyingStopped',
]

function initialSnapshot(): ScheduledLiveSnapshot {
  return {
    status: 'idle',
    durationMs: null,
    startedAt: null,
    endsAt: null,
    error: null,
  }
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

export class ScheduledLiveService {
  private snapshot = initialSnapshot()
  private controller: AbortController | null = null
  private readonly logger = createLogger('ScheduledLive')

  getSnapshot(): ScheduledLiveSnapshot {
    return { ...this.snapshot }
  }

  start(hours: number, minutes: number): ScheduledLiveSnapshot {
    if (ACTIVE_STATUSES.includes(this.snapshot.status)) {
      throw new Error('已有定时开关播任务正在运行')
    }
    if (!Number.isInteger(hours) || hours < 0) throw new Error('小时必须是非负整数')
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      throw new Error('分钟必须是 0 到 59 的整数')
    }
    const durationMs = (hours * 60 + minutes) * 60_000
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new Error('直播时长必须大于 0')
    }

    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    this.update({
      status: 'starting',
      durationMs,
      startedAt: null,
      endsAt: null,
      error: null,
    })

    let driver: LiveCompanionDriver
    try {
      driver = createLiveCompanionDriver()
    } catch (error) {
      this.fail(error)
      return this.getSnapshot()
    }

    void this.run(driver, durationMs, controller).catch(error => {
      if (!controller.signal.aborted && this.controller === controller) this.fail(error)
    })
    return this.getSnapshot()
  }

  cancel(): ScheduledLiveSnapshot {
    if (!ACTIVE_STATUSES.includes(this.snapshot.status)) return this.getSnapshot()
    this.controller?.abort(new Error('任务已取消'))
    this.controller = null
    this.update({ status: 'cancelled', endsAt: null, error: null })
    return this.getSnapshot()
  }

  private async run(driver: LiveCompanionDriver, durationMs: number, controller: AbortController) {
    const { signal } = controller
    this.logger.info('正在识别直播伴侣开播状态')
    const state = await driver.readState()
    this.logger.info(`直播伴侣当前识别状态：${state}`)
    if (state === 'live' || state === 'confirmingStop') {
      throw new Error('直播伴侣当前已在直播或关播确认中，请先手动处理后再启动任务')
    }
    if (state !== 'ready') {
      throw new Error('无法确认直播伴侣处于可开播状态，请检查窗口和辅助功能权限')
    }

    this.logger.info('已识别开始直播按钮，正在发送点击操作')
    await driver.clickStart()
    this.logger.info('点击接口已返回，正在等待直播伴侣切换到直播状态（最长 3 分钟）')
    this.ensureCurrent(controller)
    this.update({ status: 'waitingForLive' })
    await this.waitForState(driver, 'live', START_TIMEOUT_MS, signal)
    this.ensureCurrent(controller)

    const startedAt = Date.now()
    const endsAt = startedAt + durationMs
    this.update({ status: 'countingDown', startedAt, endsAt })
    this.logger.info(
      `已确认开播，开始倒计时 ${durationMs / 1000} 秒，预计关播时间：${new Date(endsAt).toLocaleString()}`,
    )
    await abortableDelay(durationMs, signal)
    this.ensureCurrent(controller)

    this.update({ status: 'stopping' })
    this.logger.info('倒计时结束，正在调用 clickStop() 点击计时区域的“关播”按钮')
    await driver.clickStop()
    this.logger.info(
      '关播点击接口已返回（尚未确认界面响应），正在等待“关闭直播”确认按钮（最长 20 秒）',
    )
    await this.waitForState(driver, 'confirmingStop', CONFIRM_TIMEOUT_MS, signal)
    this.ensureCurrent(controller)

    this.logger.info('已识别关播确认弹窗，正在点击“关闭直播”')
    await driver.confirmStop()
    this.logger.info('关闭直播点击接口已返回，正在验证直播已结束（最长 30 秒）')
    this.update({ status: 'verifyingStopped' })
    await this.waitForState(driver, 'ended', STOP_TIMEOUT_MS, signal)
    this.ensureCurrent(controller)

    this.controller = null
    this.update({ status: 'completed', endsAt: Date.now(), error: null })
    this.logger.info('已确认直播结束，定时开关播任务完成')
  }

  private async waitForState(
    driver: LiveCompanionDriver,
    expected: LiveCompanionState,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    const deadline = Date.now() + timeoutMs
    let previousState: LiveCompanionState | undefined
    while (Date.now() < deadline) {
      let state: LiveCompanionState
      try {
        state = await driver.readState()
      } catch (error) {
        if (!isLiveCompanionScanLimitError(error)) throw error
        this.logger.warn('本轮原生 UIA 扫描超限，将在整体等待期限内继续识别直播伴侣状态')
        await abortableDelay(POLL_INTERVAL_MS, signal)
        continue
      }
      if (state !== previousState) {
        this.logger.info(
          `直播伴侣状态：${state}，等待目标状态：${expected === 'ended' ? 'ended（直播已结束）或 ready（开播主界面）' : expected}`,
        )
        previousState = state
      }
      if (state === expected || (expected === 'ended' && state === 'ready')) return
      await abortableDelay(POLL_INTERVAL_MS, signal)
    }
    const messages: Record<LiveCompanionState, string> = {
      ready: '关播后未能确认直播已结束，请立即检查直播伴侣',
      ended: '关播后未识别到“直播已结束”页面或开播主界面，请立即检查直播伴侣',
      live: '点击开始直播后未能确认开播成功',
      confirmingStop: '点击关播后未找到“关闭直播”确认按钮，请立即手动检查',
      unknown: '无法识别直播伴侣状态',
    }
    throw new Error(messages[expected])
  }

  private ensureCurrent(controller: AbortController) {
    if (controller.signal.aborted || this.controller !== controller) {
      throw controller.signal.reason ?? new Error('任务已取消')
    }
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(message)
    this.controller = null
    this.update({ status: 'failed', endsAt: null, error: message })
  }

  private update(patch: Partial<ScheduledLiveSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    windowManager.send(IPC_CHANNELS.tasks.scheduledLive.statusChanged, this.getSnapshot())
  }
}

export const scheduledLiveService = new ScheduledLiveService()
