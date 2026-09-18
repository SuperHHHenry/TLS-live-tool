# Windows native UIA diagnostic

`inspect-live-native.ps1` is a standalone, read-only Windows PowerShell 5.1
diagnostic. It compiles an embedded C# COM client using Windows' installed .NET
Framework, rather than using `System.Windows.Automation.AutomationElement`.
It requires no Python, Node, SDK installation, or changes to the application.

## Run on the Windows test machine

1. Copy `inspect-live-native.ps1` to `D:\code\inspect-live-native.ps1`.
2. Keep the live companion open with its start button visible and the existing
   `--force-renderer-accessibility` launch flag. For the first comparison, keep
   Inspect open as in the previous test. Do not restart a running broadcast.
3. Run:

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File D:\code\inspect-live-native.ps1
```

The script relaunches itself in 64-bit PowerShell when necessary. It locates the
main process by its exact name and a nonzero main window handle, then enumerates
that process's top-level windows and their native UIA raw-view descendants.
If multiple main processes are found, it stops instead of choosing one. An
explicit PID can be supplied with `-TargetProcessId 1904` (use the current PID).

No mouse positioning is necessary. No Invoke, default action, focus change,
application restart, or input simulation is performed. The report records the
target executable path and UI element names, but does not dump the full process
command line.

Send back the generated `native-uia-report-<timestamp>.txt` beside the script.
The final console line gives its exact path. Reports use UTF-8 with a BOM.

## Interpret the report

- `CANDIDATE ... invoke=[True]`: target-related text was read and reports Invoke
  support. This does not prove the action works, nor that it works without Inspect.
- `TARGET_TEXT_NOT_FOUND`: this native scan did not find the expected text.
- `INCOMPLETE_SCAN`: traversal errors or the scan limit prevent a full conclusion.
- `ERROR=...`: setup, compilation, process selection, or COM initialization failed.

Control type `50020` is Text and `50000` is Button. Neither is filtered out.
The scan stops between COM calls after 3,000 elements or 45 seconds. A hung
provider call can exceed that time; use Ctrl+C if necessary. Buffered scan details
may be unavailable if interrupted before the native scan returns.

## Validation limits

Authored on macOS. Checked ASCII source encoding, no-action paths, and native COM
interface slot order against the mingw-w64 `uiautomationclient.h` declarations.
Windows PowerShell compilation and real Windows COM behavior still require the
test-machine run. The production live companion driver is unchanged.
