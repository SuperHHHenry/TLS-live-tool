export interface ViewerRuntimeStatus {
  activeIds: string[]
  commentingIds: string[]
  rotating: boolean
}

export function createViewerRuntimeStatus(
  sessions: ReadonlyMap<string, unknown>,
  comments: ReadonlyMap<string, unknown>,
  rotating: boolean,
): ViewerRuntimeStatus {
  return {
    activeIds: [...sessions.keys()],
    commentingIds: [...comments.keys()],
    rotating,
  }
}
