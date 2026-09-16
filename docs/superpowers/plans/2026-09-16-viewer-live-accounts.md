# Viewer Live Accounts Implementation Plan

> **For agentic workers:** Execute inline in the current session; automated test files are intentionally omitted per user request.

**Goal:** Add immutable主播直播账号 records with automatic name/live-status detection and manual refresh.

**Architecture:** Persist主播 records in a dedicated Zustand store. Add typed IPC channels handled by the viewer session manager using a lightweight Playwright page to inspect the supplied Douyin URL. Render a focused list in ViewerAccounts while retaining existing观众账号 and commenting behavior.

**Tech Stack:** React, Zustand persist, Electron IPC, Playwright, shadcn/ui, lucide-react.

## Global Constraints

- Records can be added and deleted, but never edited.
- User requested no test files; run only existing type/build checks.
- Detection failures preserve records and show an unknown state.

### Task 1: Data and IPC contracts

**Files:** `src/hooks/useViewerAccounts.ts`, `shared/ipcChannels.ts`, `shared/electron-api.d.ts`

- Add `LiveAccount` fields (`id`, `sourceUrl`, `accountId`, `accountName`, `liveStatus`, `roomUrl`, `lastCheckedAt`, `error`).
- Persist `liveAccounts` with version migration and actions `addLiveAccount`, `updateLiveAccountStatus`, `removeLiveAccount`.
- Add `detectLiveAccount` and `detectLiveAccounts` channels and typed return values.

### Task 2: Main-process detection

**Files:** `electron/main/ipc/viewer.ts`, `electron/main/managers/ViewerSessionManager.ts`

- Validate Douyin URLs, open a temporary headless browser session, parse account name/ID from page metadata/DOM, infer live status from live-room markers, and always close the session.
- Return per-item errors without throwing for batch operations.

### Task 3: ViewerAccounts UI

**Files:** `src/pages/ViewerAccounts/index.tsx`

- Add a主播直播账号 card with URL input, add action, refresh action, immutable rows, status badges, timestamps, and confirmed delete.
- Keep existing viewer account controls intact and use returned detection data to update the store.

### Task 4: Verification

- Run `npm run typecheck` or the repository's available equivalent and `npm run build` if available; do not add test files.
