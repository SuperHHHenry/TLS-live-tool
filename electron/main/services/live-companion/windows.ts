import { execFileText } from './shell'
import type { LiveCompanionDriver, LiveCompanionState } from './types'

const WINDOWS_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WindowActivation {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)
$window = $null
foreach ($candidate in $windows) {
  $name = $candidate.Current.Name
  if ($name -like '*直播伴侣*' -and $name -notlike '*TR直播中控工具*') {
    $window = $candidate
    break
  }
}

if ($null -eq $window) { throw '未找到抖音直播伴侣窗口，请先启动直播伴侣' }

$handle = [IntPtr]$window.Current.NativeWindowHandle
[WindowActivation]::ShowWindowAsync($handle, 9) | Out-Null
[WindowActivation]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 350

$buttons = $window.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
)

function Find-Button([string[]]$Names) {
  $matches = @()
  foreach ($button in $buttons) {
    $name = $button.Current.Name.Trim()
    if ($Names -contains $name) { $matches += $button }
  }
  if ($matches.Count -gt 1) { throw "找到多个同名按钮，已停止操作：$($Names -join '/')" }
  if ($matches.Count -eq 1) { return $matches[0] }
  return $null
}

function Invoke-Button([string[]]$Names) {
  $button = Find-Button $Names
  if ($null -eq $button) { throw "无法识别按钮：$($Names -join '/')" }
  $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
}

switch ($Action) {
  'state' {
    if ($null -ne (Find-Button @('关闭直播'))) { 'confirmingStop'; exit 0 }
    if ($null -ne (Find-Button @('关播'))) { 'live'; exit 0 }
    $ended = $window.FindFirst(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        '直播已结束'
      )
    )
    if ($null -ne $ended) { 'ended'; exit 0 }
    if ($null -ne (Find-Button @('开始直播'))) { 'ready'; exit 0 }
    'unknown'
  }
  'start' { Invoke-Button @('开始直播'); 'ok' }
  'stop' { Invoke-Button @('关播'); 'ok' }
  'confirm-stop' { Invoke-Button @('关闭直播'); 'ok' }
  default { throw "未知操作：$Action" }
}
`

async function run(action: string) {
  try {
    const script = `$Action = '${action}'\n${WINDOWS_SCRIPT}`
    return await execFileText(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      20_000,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('Access is denied') || message.includes('拒绝访问')) {
      throw new Error('无法控制直播伴侣。若直播伴侣以管理员身份运行，请也以管理员身份运行本工具')
    }
    throw new Error(`Windows 自动化失败：${message}`)
  }
}

export class WindowsLiveCompanionDriver implements LiveCompanionDriver {
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
