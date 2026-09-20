import process from 'node:process'
import { createLogger } from '#/logger'
import { MACOS_MOUSE_SCRIPT } from './macosMouse'
import { execFileText } from './shell'
import type { LiveCompanionDriver, LiveCompanionState } from './types'

const BUNDLE_ID = 'com.bytedance.webcastmate.mac'
const logger = createLogger('ScheduledLive:macOS')

interface MacOSStateResult {
  state: LiveCompanionState
  processIds: number[]
  accessibilityActivation: string[]
  windowCount: number
  elementCount: number
  targetCount: number
}

const MACOS_AX_SCRIPT = String.raw`
ObjC.import('AppKit')
ObjC.import('ApplicationServices')

const AX_SNAPSHOT_EXPIRED = 'AX_SNAPSHOT_EXPIRED'

function attribute(element, name) {
  const value = Ref()
  const result = $.AXUIElementCopyAttributeValue(element, $(name), value)
  // AX returns an opaque CFTypeRef. Bridge it before ObjC.unwrap; otherwise
  // arrays have no .length and existing windows are mistaken for an empty list.
  if (result === 0) return ObjC.castRefToObject(value[0]) || null
  if (result === -25202) throw new Error(AX_SNAPSHOT_EXPIRED)
  if (result === -25205 || result === -25212) return null
  throw new Error('读取辅助功能属性失败：' + name + ' (' + result + ')')
}

function stringAttribute(element, name) {
  const value = attribute(element, name)
  if (!value) return ''
  try { return ObjC.unwrap(value) || '' } catch (_) { return '' }
}

function children(element) {
  const value = attribute(element, 'AXChildren')
  if (!value) return []
  try { return ObjC.unwrap(value) || [] } catch (_) { return [] }
}

function enableWebAccessibility(element, pid) {
  return ['AXManualAccessibility', 'AXEnhancedUserInterface'].map(name => {
    const result = $.AXUIElementSetAttributeValue(element, $(name), $(true))
    return pid + ':' + name + '=' + result
  })
}

function allElements(root) {
  const result = []
  const queue = [root]
  while (queue.length && result.length < 5000) {
    const current = queue.shift()
    result.push(current)
    for (const child of children(current)) queue.push(child)
  }
  return result
}

function names(element) {
  return ['AXTitle', 'AXDescription', 'AXValue']
    .map(name => String(stringAttribute(element, name)).trim())
    .filter(Boolean)
}

function isStopLabel(name) {
  return /^(?:\d+:\d{2}(?::\d{2})?\s*)?关播$/.test(name)
}

function findButton(elements, wantedNames) {
  const matches = elements.filter(element => {
    return stringAttribute(element, 'AXRole') === 'AXButton' &&
      names(element).some(name => wantedNames.includes(name) ||
        (wantedNames.includes('关播') && isStopLabel(name)))
  })
  if (matches.length > 1) throw new Error('找到多个同名按钮，已停止操作：' + wantedNames.join('/'))
  return matches[0] || null
}

function press(button, wantedNames) {
  if (!button) throw new Error('无法识别按钮：' + wantedNames.join('/'))
  const target = JSON.stringify({ role: stringAttribute(button, 'AXRole'), names: names(button) })
  const result = $.AXUIElementPerformAction(button, $('AXPress'))
  if (result !== 0) throw new Error('AXPress 点击按钮失败：' + target + '，返回码：' + result)
  return JSON.stringify({ method: 'AXPress', target: JSON.parse(target), returnCode: result })
}

function run(argv) {
  const pids = String(argv[0]).split(',').map(Number).filter(Boolean)
  const action = argv[1]
  if (!pids.length) throw new Error('未找到抖音直播伴侣窗口，请先启动直播伴侣')

  if (!$.AXIsProcessTrusted()) {
    throw new Error('not authorized for accessibility (-25211)')
  }

  const apps = []
  const runningApps = []
  const accessibilityActivation = []
  for (const pid of pids) {
    const candidateApp = $.AXUIElementCreateApplication(pid)
    apps.push(candidateApp)
    accessibilityActivation.push(...enableWebAccessibility(candidateApp, pid))
    const runningApp = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid)
    if (runningApp) runningApps.push(runningApp)
  }
  for (const runningApp of runningApps) {
    runningApp.activateWithOptions($.NSApplicationActivateIgnoringOtherApps)
  }
  delay(0.35)
  let confirmButton = null
  let stopButton = null
  let startButton = null
  let hasStopLabel = false
  let hasEndedLabel = false
  let windowList = []
  let elementCount = 0
  // Electron may initially expose only the native window controls. Re-read
  // the tree while its web accessibility content is being published.
  const attempts = action === 'state' || action === 'start' ? 11 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      windowList = []
      for (const app of apps) {
        const windows = attribute(app, 'AXWindows')
        for (const window of windows ? ObjC.unwrap(windows) : []) windowList.push(window)
      }
      const elements = []
      for (const window of windowList) elements.push(...allElements(window))
      elementCount = elements.length
      // The timer and stop label may be combined on the button or exposed as text.
      hasStopLabel = elements.some(element => names(element).some(isStopLabel))
      hasEndedLabel = elements.some(element => names(element).includes('直播已结束'))
      confirmButton = findButton(elements, ['关闭直播'])
      stopButton = findButton(elements, ['关播'])
      startButton = findButton(elements, ['开始直播'])
      if (confirmButton || hasStopLabel || hasEndedLabel || startButton) break
    } catch (error) {
      if (!String(error).includes(AX_SNAPSHOT_EXPIRED)) throw error
      windowList = []
      confirmButton = null
      stopButton = null
      startButton = null
      hasStopLabel = false
      hasEndedLabel = false
      elementCount = 0
    }
    if (attempt + 1 < attempts) delay(0.5)
  }
  if (!windowList.length) throw new Error('未找到抖音直播伴侣窗口，请先恢复窗口')

  if (action === 'state') {
    const state = confirmButton ? 'confirmingStop' : hasStopLabel ? 'live' :
      hasEndedLabel ? 'ended' : startButton ? 'ready' : 'unknown'
    const targetCount = [confirmButton, hasStopLabel, hasEndedLabel, startButton].filter(Boolean).length
    return JSON.stringify({ state, processIds: pids, accessibilityActivation,
      windowCount: windowList.length, elementCount, targetCount })
  }
  if (action === 'start') {
    if (confirmButton || hasStopLabel) throw new Error('直播伴侣已在直播或关播确认中，已停止开播操作')
    if (!startButton) throw new Error('已找到直播伴侣窗口，但等待后仍无法识别“开始直播”按钮，请确认主界面已加载且辅助功能内容可用')
    press(startButton, ['开始直播'])
  }
  else if (action === 'stop') return press(stopButton, ['关播'])
  else if (action === 'confirm-stop') return press(confirmButton, ['关闭直播'])
  else throw new Error('未知操作：' + action)
  return 'ok'
}
`

async function findProcessIds() {
  const output = await execFileText('launchctl', ['print', `gui/${process.getuid?.() ?? 0}`])
  const escapedBundleId = BUNDLE_ID.replaceAll('.', '\\.')
  const rendezvousMatch = output.match(
    new RegExp(`${escapedBundleId}\\.MachPortRendezvousServer\\.(\\d+)`),
  )
  const processMatch = output.match(
    /com\.apple\.xpc\.launchd\.unmanaged\.Douyin Webcast \.([0-9]+)/,
  )
  const pids = [rendezvousMatch?.[1], processMatch?.[1]].filter((pid): pid is string =>
    Boolean(pid),
  )
  if (!pids.length) throw new Error('未找到抖音直播伴侣窗口，请先启动直播伴侣')
  return [...new Set(pids)]
}

async function run(action: string) {
  const startedAt = Date.now()
  try {
    const pids = await findProcessIds()
    if (action !== 'state')
      logger.info(`准备执行 ${action}，候选进程 PID：${pids.join(',')}，点击方式：原生鼠标`)
    const output =
      action === 'state'
        ? await execFileText(
            'osascript',
            ['-l', 'JavaScript', '-e', MACOS_AX_SCRIPT, pids.join(','), action],
            20_000,
          )
        : await execFileText(
            '/usr/bin/swift',
            ['-e', MACOS_MOUSE_SCRIPT, pids.join(','), action],
            60_000,
          )
    if (action === 'state') {
      const result = JSON.parse(output) as MacOSStateResult
      if (
        !result ||
        !['ready', 'live', 'confirmingStop', 'ended', 'unknown'].includes(result.state) ||
        !Array.isArray(result.processIds) ||
        !Array.isArray(result.accessibilityActivation) ||
        !Number.isInteger(result.windowCount) ||
        !Number.isInteger(result.elementCount) ||
        !Number.isInteger(result.targetCount)
      ) {
        throw new Error('macOS 辅助功能返回了无效的诊断结果')
      }
      logger.debug(
        `原生 AX：PID=${result.processIds.join(',')}，辅助功能启用=${result.accessibilityActivation.join(',')}，窗口 ${result.windowCount} 个，扫描 ${result.elementCount} 个元素，目标 ${result.targetCount} 个，状态=${result.state}`,
      )
      return result.state
    }
    if (action !== 'state')
      logger.info(
        `${action} 点击调用返回，耗时 ${Date.now() - startedAt}ms，结果：${output}（仅表示接口返回，界面响应由后续状态检查确认）`,
      )
    return output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (action !== 'state')
      logger.error(`${action} 点击调用失败，耗时 ${Date.now() - startedAt}ms：${message}`)
    if (
      message.includes('not authorized') ||
      message.includes('不允许辅助访问') ||
      message.includes('(-25211)') ||
      message.includes('(-25206)')
    ) {
      throw new Error('缺少辅助功能权限，请在系统设置的“隐私与安全性 > 辅助功能”中允许本工具')
    }
    throw new Error(`macOS 自动化失败：${message}`)
  }
}

export class MacOSLiveCompanionDriver implements LiveCompanionDriver {
  async readState(): Promise<LiveCompanionState> {
    const state = await run('state')
    return ['ready', 'live', 'confirmingStop', 'ended'].includes(state)
      ? (state as LiveCompanionState)
      : 'unknown'
  }

  async clickStart() {
    await run('start')
  }

  async clickStop() {
    await run('stop')
  }

  async confirmStop() {
    await run('confirm-stop')
  }
}
