export type LiveCompanionState = 'ready' | 'live' | 'confirmingStop' | 'ended' | 'unknown'

export interface LiveCompanionDriver {
  readState(): Promise<LiveCompanionState>
  clickStart(): Promise<void>
  clickStop(): Promise<void>
  confirmStop(): Promise<void>
}
