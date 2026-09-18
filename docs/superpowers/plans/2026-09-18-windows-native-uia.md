# Windows native UIA implementation

User-approved scope: Windows uses the same start → live → stop → confirm-stop →
ended/ready flow and button labels as macOS. The existing ScheduledLiveService
continues to own timing and post-action state verification.

User constraint: do not write test code or run tests. Review source and run the
TypeScript type checker only; actual Windows actions remain unverified locally.

- Replace the managed UIAutomationClient query with the native COM/raw-view
  traversal already verified on the user's Windows machine.
- Put the native client in `windowsNative.cs`, bundled through Vite's raw import.
  Query only the exact live companion process, deduplicate runtime IDs, reject
  incomplete scans and ambiguous/disabled targets, and invoke once per action.
- Support Text elements, the timer-prefixed stop label, and the same state
  precedence as macOS. Restore the target main window when minimized.
- Update `windows.ts` to write a temporary C# source and PowerShell runner, launch
  system PowerShell (64-bit for WOW64), parse structured output and remove the
  temporary directory in finally. Do not pass the large source on the command line.
- Log scan results and action returns without claiming the stream changed state.
- Review COM slot order and runtime transport, check TypeScript types, and document
  Windows validation steps. Do not change the macOS driver or shared flow.

## Implementation status

Implemented `windowsNative.cs` and the Windows driver transport. The native client
uses raw-view traversal, runtime ID deduplication, visible/enabled target checks,
timer-prefixed stop labels, action-state guards and a single Invoke attempt.
The helper is loaded from the bundled raw source using temporary UTF-8 files,
then removed after each process exits. PowerShell references the installed .NET
Framework assemblies explicitly; no additional runtime needs to be installed.

No test files were written and no tests were run, per the user's instruction.
TypeScript type checking passed. C# compilation, Invoke behavior and a complete
live/stop cycle require Windows; the earlier diagnostic validated traversal only.

## Windows handoff

Sync both `windows.ts` and `windowsNative.cs` to the Windows project and restart
the development app, or rebuild the Windows package so the new raw source is
included. Inspect and the earlier diagnostic scripts are not needed at runtime.
Use the existing scheduled-live UI. Expected log sequence is ready → start Invoke
returned → live → stop Invoke returned → confirmingStop → confirm-stop Invoke
returned → ended or ready. An Invoke return alone is not stream-state success.
If the action fails, retain the Windows native UIA error including the action and
the PowerShell exception. The driver deliberately does not retry Invoke after an
uncertain result or silently fall back to coordinates.
