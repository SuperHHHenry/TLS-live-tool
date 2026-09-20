import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createLogger } from '#/logger'
import { execFileText } from './shell'
import type { LiveCompanionDriver, LiveCompanionState } from './types'
import nativeSource from './windowsNative.cs?raw'

const logger = createLogger('ScheduledLive:Windows')
type Action = 'state' | 'start' | 'stop' | 'confirm-stop'

interface NativeResult {
  State: LiveCompanionState
  ProcessId: number
  ElementCount: number
  AttemptCount: number
  Method: 'nativeUIA'
  TargetName: string | null
  Invoked: boolean
  Detail: string
  Diagnostic: string | null
}

const POWERSHELL_SCRIPT = String.raw`
param(
  [ValidateSet('state', 'start', 'stop', 'confirm-stop')]
  [string]$Action
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$helperElevated = 'unknown'
$stage = 'check-helper-elevation'
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $principal = [System.Security.Principal.WindowsPrincipal]::new($identity)
    $helperElevated = $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  }
  finally { $identity.Dispose() }
  $stage = 'compile-native-driver'
  Add-Type -Path (Join-Path $PSScriptRoot 'WindowsNative.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll'
  $stage = 'run-native-driver'
  $result = [LiveCompanionNative.Driver]::Run($Action)
  $result | ConvertTo-Json -Compress
}
catch {
  # Keep the exception chain and stack on one line for the app's log viewer.
  $detail = $_.Exception.ToString() -replace '[\r\n]+', ' | '
  [Console]::Error.WriteLine("Action=$Action; HelperElevated=$helperElevated; Stage=$stage; $detail")
  exit 1
}
`

function powershellPath() {
  // A 32-bit Electron process sees System32 redirected to SysWOW64.
  const folder =
    process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432 ? 'Sysnative' : 'System32'
  return path.win32.join(
    process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
    folder,
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
}

function parseResult(output: string, action: Action): NativeResult {
  const result = JSON.parse(output.replace(/^\uFEFF/, '')) as NativeResult
  if (
    !result ||
    !['ready', 'live', 'confirmingStop', 'ended', 'unknown'].includes(result.State) ||
    result.Method !== 'nativeUIA' ||
    !Number.isInteger(result.ProcessId) ||
    result.ProcessId <= 0 ||
    !Number.isInteger(result.ElementCount) ||
    result.ElementCount <= 0 ||
    !Number.isInteger(result.AttemptCount) ||
    result.AttemptCount <= 0 ||
    typeof result.Detail !== 'string' ||
    (result.Diagnostic !== null && typeof result.Diagnostic !== 'string') ||
    typeof result.Invoked !== 'boolean'
  ) {
    throw new Error('原生 UIA 返回了无效的诊断结果')
  }
  if (action === 'state' && result.Invoked) {
    throw new Error('原生 UIA 状态读取意外报告了点击动作')
  }
  if (action !== 'state' && (!result.Invoked || typeof result.TargetName !== 'string')) {
    throw new Error('原生 UIA 未确认 Invoke 调用已返回')
  }
  return result
}

async function run(action: Action): Promise<NativeResult> {
  const startedAt = Date.now()
  let directory: string | undefined
  try {
    // Keep the source in the JS bundle, then materialize it outside app.asar.
    // Passing the source with -EncodedCommand would exceed Windows' command limit.
    directory = await mkdtemp(path.join(tmpdir(), 'tls-live-uia-'))
    const scriptPath = path.join(directory, 'run.ps1')
    const writes = await Promise.allSettled([
      writeFile(path.join(directory, 'WindowsNative.cs'), `\uFEFF${nativeSource}`, 'utf8'),
      writeFile(scriptPath, POWERSHELL_SCRIPT, 'utf8'),
    ])
    for (const write of writes) {
      if (write.status === 'rejected') throw write.reason
    }
    if (action !== 'state') logger.info(`准备执行 ${action}，方式：原生 UIA Invoke`)
    const output = await execFileText(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Action',
        action,
      ],
      20_000,
    )
    const result = parseResult(output, action)
    const summary = `PID=${result.ProcessId}，扫描 ${result.ElementCount} 个元素，尝试 ${result.AttemptCount} 次，状态=${result.State}`
    if (action === 'state') {
      logger.debug(`原生 UIA：${summary}；${result.Detail}`)
      if (result.State === 'unknown') {
        if (result.Diagnostic) logger.debug(result.Diagnostic)
        logger.warn(
          `已找到直播伴侣，但原生 UIA 未识别到可开播、直播中或结束状态。${summary}；${result.Detail}`,
        )
      }
    } else {
      logger.info(
        `${action} Invoke 已返回，目标=${result.TargetName}，耗时 ${Date.now() - startedAt}ms；${summary}（界面响应由后续状态检查确认）`,
      )
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`${action} 原生 UIA 失败，耗时 ${Date.now() - startedAt}ms：${message}`)
    if (/Access is denied|拒绝访问|0x80070005/i.test(message)) {
      throw new Error(`Windows 访问被拒绝，不能仅据此判断未以管理员身份运行。诊断信息：${message}`)
    }
    throw new Error(`Windows 原生 UIA 自动化失败：${message}`)
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch(error => {
        logger.warn(`清理原生 UIA 临时文件失败：${String(error)}`)
      })
    }
  }
}

export class WindowsLiveCompanionDriver implements LiveCompanionDriver {
  async readState(): Promise<LiveCompanionState> {
    return (await run('state')).State
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
