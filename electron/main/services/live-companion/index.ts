import { MacOSLiveCompanionDriver } from './macos'
import type { LiveCompanionDriver } from './types'
import { WindowsLiveCompanionDriver } from './windows'

export type { LiveCompanionDriver, LiveCompanionState } from './types'

export function createLiveCompanionDriver(): LiveCompanionDriver {
  if (process.platform === 'win32') return new WindowsLiveCompanionDriver()
  if (process.platform === 'darwin') return new MacOSLiveCompanionDriver()
  throw new Error('定时开关播目前只支持 Windows 和 macOS')
}
