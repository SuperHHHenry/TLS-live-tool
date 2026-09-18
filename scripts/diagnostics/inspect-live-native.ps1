# Read-only native UI Automation probe. Compatible with Windows PowerShell 5.1.
# Keep this file ASCII so Windows PowerShell does not require a UTF-8 BOM.
param([int]$TargetProcessId = 0)

$ErrorActionPreference = 'Stop'

if (-not [Environment]::Is64BitProcess -and [Environment]::Is64BitOperatingSystem) {
    $ps64 = "$env:WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    & $ps64 -NoProfile -STA -ExecutionPolicy Bypass -File $PSCommandPath -TargetProcessId $TargetProcessId
    exit $LASTEXITCODE
}

$report = Join-Path $PSScriptRoot ('native-uia-report-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.txt')
$log = New-Object 'System.Collections.Generic.List[string]'
$exitCode = 0

function Write-Report([string]$Line) {
    $log.Add($Line)
    Write-Host $Line
}

try {
    Write-Report 'NATIVE_UIA_TEST_STARTED'
    Write-Report ('IS_64_BIT=' + [Environment]::Is64BitProcess)
    Write-Report ('POWERSHELL=' + $PSVersionTable.PSVersion)
    Write-Report 'READ_ONLY: no clicks, Invoke, focus changes or application restarts.'

    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace LiveNativeProbe {
    // These interfaces declare only the leading slots needed from UIAutomationClient.h.
    // Unused slots are placeholders and MUST NOT be called.
    [ComImport, Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomation {
        void UnusedCompareElements();
        void UnusedCompareRuntimeIds();
        IUIAutomationElement GetRootElement();
        IUIAutomationElement ElementFromHandle(IntPtr hwnd);
        void UnusedElementFromPoint();
        void UnusedGetFocusedElement();
        void UnusedGetRootElementBuildCache();
        void UnusedElementFromHandleBuildCache();
        void UnusedElementFromPointBuildCache();
        void UnusedGetFocusedElementBuildCache();
        void UnusedCreateTreeWalker();
        void UnusedGetControlViewWalker();
        void UnusedGetContentViewWalker();
        IUIAutomationTreeWalker GetRawViewWalker();
    }

    [ComImport, Guid("D22108AA-8AC5-49A5-837B-37BBB3D7591E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomationElement {
        void UnusedSetFocus();
        void UnusedGetRuntimeId();
        void UnusedFindFirst();
        void UnusedFindAll();
        void UnusedFindFirstBuildCache();
        void UnusedFindAllBuildCache();
        void UnusedBuildUpdatedCache();
        [return: MarshalAs(UnmanagedType.Struct)]
        object GetCurrentPropertyValue(int propertyId);
    }

    [ComImport, Guid("4042C624-389C-4AFC-A630-9DF854A541FC"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomationTreeWalker {
        IUIAutomationElement GetParentElement(IUIAutomationElement element);
        IUIAutomationElement GetFirstChildElement(IUIAutomationElement element);
        IUIAutomationElement GetLastChildElement(IUIAutomationElement element);
        IUIAutomationElement GetNextSiblingElement(IUIAutomationElement element);
    }

    public static class Probe {
        delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);
        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

        static string Clean(object value) {
            return Convert.ToString(value).Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
        }

        static object Read(IUIAutomationElement element, int id) {
            try { return element.GetCurrentPropertyValue(id); }
            catch (Exception ex) { return "PROPERTY_ERROR:" + ex.GetType().Name; }
        }

        public static string[] Run(int pid) {
            var lines = new List<string>();
            var windows = new List<IntPtr>();
            EnumWindows(delegate(IntPtr hwnd, IntPtr state) {
                uint owner;
                GetWindowThreadProcessId(hwnd, out owner);
                if (owner == (uint)pid) windows.Add(hwnd);
                return true;
            }, IntPtr.Zero);
            lines.Add("TOP_LEVEL_WINDOWS=" + windows.Count);
            if (windows.Count == 0) {
                lines.Add("RESULT=NO_WINDOWS_FOR_TARGET_PROCESS");
                return lines.ToArray();
            }

            var automation = (IUIAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(
                new Guid("FF48DBA4-60EF-4201-AA87-54103EEF594E"), true));
            var walker = automation.GetRawViewWalker();
            var timer = Stopwatch.StartNew();
            int total = 0, candidates = 0, errors = 0;
            bool limited = false;

            foreach (IntPtr hwnd in windows) {
                var title = new StringBuilder(1024);
                GetWindowText(hwnd, title, title.Capacity);
                lines.Add("WINDOW handle=" + hwnd + " title=" + Clean(title));
                try {
                    var stack = new Stack<IUIAutomationElement>();
                    var root = automation.ElementFromHandle(hwnd);
                    if (root == null) { lines.Add("WINDOW_HAS_NO_UIA_ROOT"); continue; }
                    stack.Push(root);
                    while (stack.Count > 0) {
                        // This limits traversal, not the duration of an individual COM call.
                        if (total >= 3000 || timer.Elapsed.TotalSeconds > 45) {
                            limited = true;
                            break;
                        }
                        var element = stack.Pop();
                        total++;
                        string name = Clean(Read(element, 30005));
                        object invoke = Read(element, 30031);
                        lines.Add("ELEMENT name=[" + name + "] type=[" + Clean(Read(element, 30003)) +
                            "] pid=[" + Clean(Read(element, 30002)) + "] enabled=[" + Clean(Read(element, 30010)) +
                            "] offscreen=[" + Clean(Read(element, 30022)) + "] invoke=[" + Clean(invoke) + "]");
                        if (name.Contains("\u5f00\u59cb\u76f4\u64ad") || name.Contains("\u5173\u64ad") ||
                            name.Contains("\u5173\u95ed\u76f4\u64ad") || name.Contains("\u76f4\u64ad\u5df2\u7ed3\u675f")) {
                            candidates++;
                            lines.Add("CANDIDATE name=[" + name + "] invoke=[" + Clean(invoke) + "]");
                        }
                        try {
                            // Push the sibling before the child to walk depth-first without
                            // following siblings of the root outside this target window.
                            if (!Object.ReferenceEquals(element, root)) {
                                var sibling = walker.GetNextSiblingElement(element);
                                if (sibling != null) stack.Push(sibling);
                            }
                            var child = walker.GetFirstChildElement(element);
                            if (child != null) stack.Push(child);
                        } catch (Exception ex) {
                            errors++;
                            lines.Add("TRAVERSAL_ERROR=" + ex.GetType().Name + ": " + Clean(ex.Message));
                        }
                    }
                } catch (Exception ex) {
                    errors++;
                    lines.Add("WINDOW_ERROR=" + ex.GetType().Name + ": " + Clean(ex.Message));
                }
                if (limited) break;
            }
            lines.Add("ELEMENT_COUNT=" + total);
            lines.Add("CANDIDATE_COUNT=" + candidates);
            lines.Add("TRAVERSAL_ERROR_COUNT=" + errors);
            lines.Add("SCAN_LIMIT_REACHED=" + limited);
            lines.Add("RESULT=" + (candidates > 0 ? "TARGET_TEXT_FOUND_ACTION_NOT_TESTED" :
                (limited || errors > 0 ? "INCOMPLETE_SCAN" : "TARGET_TEXT_NOT_FOUND")));
            return lines.ToArray();
        }
    }
}
'@

    if ($TargetProcessId -gt 0) {
        $targets = @(Get-Process -Id $TargetProcessId)
    }
    else {
        $expectedName = -join ([char[]](0x76F4, 0x64AD, 0x4F34, 0x4FA3))
        $targets = @(Get-Process | Where-Object {
            $_.ProcessName -eq $expectedName -and $_.MainWindowHandle -ne 0
        })
    }

    if ($targets.Count -ne 1) {
        Write-Report ('TARGET_COUNT=' + $targets.Count)
        foreach ($target in $targets) {
            Write-Report ('CANDIDATE_PROCESS=' + $target.Id + ' ' + $target.ProcessName)
        }
        throw 'Expected exactly one live companion main process. Open the app, or pass -TargetProcessId.'
    }

    $target = $targets[0]
    Write-Report ('TARGET_PID=' + $target.Id)
    Write-Report ('TARGET_NAME=' + $target.ProcessName)
    try {
        $details = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $target.Id)
        Write-Report ('TARGET_PATH=' + $details.ExecutablePath)
        Write-Report ('ACCESSIBILITY_FLAG_PRESENT=' + ($details.CommandLine -like '*--force-renderer-accessibility*'))
    }
    catch {
        Write-Report ('PROCESS_INFO_ERROR=' + $_.Exception.Message)
    }

    Write-Report 'SCANNING: normally under one minute. Ctrl+C can interrupt an unresponsive provider.'
    foreach ($line in [LiveNativeProbe.Probe]::Run($target.Id)) {
        Write-Report $line
    }
}
catch {
    $exitCode = 1
    Write-Report ('ERROR=' + $_.Exception.ToString())
}
finally {
    Write-Report 'NATIVE_UIA_TEST_FINISHED'
    [System.IO.File]::WriteAllLines($report, $log.ToArray(), [System.Text.UTF8Encoding]::new($true))
    Write-Host ('REPORT_FILE=' + $report)
}

exit $exitCode
