# Windows UIA Diagnostics Implementation Plan

> **For agentic workers:** Implement this plan inline in the current working directory.

**Goal:** When Windows live-companion state detection returns `unknown`, write a bounded snapshot
of named UI Automation elements to the application log file without changing recognition or click
behavior.

**Architecture:** The native C# scanner collects diagnostic strings while it already traverses UIA
elements and returns them in its JSON result. The TypeScript driver validates the optional payload
and writes it with `logger.debug`, which is file-only under the existing logger configuration.

**Tech Stack:** Electron, TypeScript, Windows PowerShell 5.1, C# UI Automation COM.

## Global Constraints

- Do not add or modify tests.
- Do not run tests, type checks, static checks, or builds unless explicitly requested.
- Do not create commits, branches, or worktrees.
- Do not alter state recognition, filtering, or click behavior.
- Limit diagnostic output to 200 named elements.

---

### Task 1: Collect native UIA diagnostics

**Files:**
- Modify: `electron/main/services/live-companion/windowsNative.cs`

- [x] Add an optional diagnostic output field to the native result.
- [x] During the existing traversal, capture HWND, name, PID, offscreen, enabled, invoke support,
      and runtime ID for at most 200 named elements.
- [x] Make diagnostic property reads best-effort so they cannot interrupt recognition.
- [x] Return the collected entries only when the final state is `unknown`.

### Task 2: Write diagnostics to the file log

**Files:**
- Modify: `electron/main/services/live-companion/windows.ts`

- [x] Add the optional diagnostic field to `NativeResult` and validate its shape when present.
- [x] When `readState` receives `unknown`, emit the snapshot through `logger.debug`.
- [x] Keep the existing UI warning short and unchanged.

### Task 3: Review only

- [x] Inspect the diff for accidental recognition or click behavior changes.
- [x] Report that no automated verification was run under repository instructions.
