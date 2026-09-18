using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;

namespace LiveCompanionNative
{
    // Leading vtable slots from UIAutomationClient.h. Never call Unused methods.
    [ComImport, Guid("30CBE57D-D9D0-452A-AB13-7AC5AC4825EE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomation
    {
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
    interface IUIAutomationElement
    {
        void UnusedSetFocus();
        [return: MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_I4)]
        int[] GetRuntimeId();
        void UnusedFindFirst();
        void UnusedFindAll();
        void UnusedFindFirstBuildCache();
        void UnusedFindAllBuildCache();
        void UnusedBuildUpdatedCache();
        [return: MarshalAs(UnmanagedType.Struct)]
        object GetCurrentPropertyValue(int propertyId);
        void UnusedGetCurrentPropertyValueEx();
        void UnusedGetCachedPropertyValue();
        void UnusedGetCachedPropertyValueEx();
        void UnusedGetCurrentPatternAs();
        void UnusedGetCachedPatternAs();
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object GetCurrentPattern(int patternId);
    }

    [ComImport, Guid("4042C624-389C-4AFC-A630-9DF854A541FC"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomationTreeWalker
    {
        IUIAutomationElement GetParentElement(IUIAutomationElement element);
        IUIAutomationElement GetFirstChildElement(IUIAutomationElement element);
        IUIAutomationElement GetLastChildElement(IUIAutomationElement element);
        IUIAutomationElement GetNextSiblingElement(IUIAutomationElement element);
    }

    [ComImport, Guid("FB377FBE-8EA6-46D5-9C73-6499642D3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IUIAutomationInvokePattern
    {
        void Invoke();
    }

    public sealed class Result
    {
        public string State;
        public int ProcessId;
        public int ElementCount;
        public int AttemptCount;
        public string TargetName;
        public string Method;
        public bool Invoked;
        public string Detail;
    }

    sealed class Candidate
    {
        public IUIAutomationElement Element;
        public string Name;
        public bool Enabled;
        public bool CanInvoke;
    }

    sealed class Snapshot
    {
        public readonly List<Candidate> Candidates = new List<Candidate>();
        public int ElementCount;
    }

    public static class Driver
    {
        // PowerShell invokes synchronously; keep diagnostic context local to this thread.
        [ThreadStatic] static string diagnosticStage;
        [ThreadStatic] static int diagnosticPid;
        const string ProcessName = "直播伴侣";
        const string StartLabel = "开始直播";
        const string StopLabel = "关播";
        const string ConfirmLabel = "关闭直播";
        const string EndedLabel = "直播已结束";
        const int NameProperty = 30005;
        const int ProcessIdProperty = 30002;
        const int EnabledProperty = 30010;
        const int OffscreenProperty = 30022;
        const int InvokeAvailableProperty = 30031;
        const int InvokePatternId = 10000;
        static readonly Regex StopName = new Regex(@"^(?:\d+:\d{2}(?::\d{2})?\s*)?关播$");

        delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);
        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")]
        static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")]
        static extern bool ShowWindowAsync(IntPtr hwnd, int command);

        static string Name(IUIAutomationElement element)
        {
            diagnosticStage = "uia.read-name";
            object value = element.GetCurrentPropertyValue(NameProperty);
            if (!(value is string)) throw new InvalidOperationException("无法读取 UIA 元素名称");
            return ((string)value).Trim();
        }

        static bool Flag(IUIAutomationElement element, int property)
        {
            diagnosticStage = "uia.read-property-" + property;
            object value = element.GetCurrentPropertyValue(property);
            if (!(value is bool)) throw new InvalidOperationException("无法读取 UIA 属性：" + property);
            return (bool)value;
        }

        static bool Matches(string name, string label)
        {
            return name == label || (label == StopLabel && StopName.IsMatch(name));
        }

        static bool Relevant(string name)
        {
            return name == StartLabel || name == ConfirmLabel || name == EndedLabel || StopName.IsMatch(name);
        }

        static Process FindProcess()
        {
            var matches = new List<Process>();
            diagnosticStage = "process.enumerate";
            foreach (Process process in Process.GetProcessesByName(ProcessName))
            {
                try
                {
                    diagnosticPid = process.Id;
                    diagnosticStage = "process.check-exited";
                    bool exited = process.HasExited;
                    diagnosticStage = "process.read-main-window";
                    if (!exited && process.MainWindowHandle != IntPtr.Zero)
                    {
                        matches.Add(process);
                        continue;
                    }
                }
                catch (InvalidOperationException) { }
                process.Dispose();
            }
            if (matches.Count == 1) return matches[0];
            foreach (Process process in matches) process.Dispose();
            if (matches.Count == 0) throw new InvalidOperationException("未找到直播伴侣主进程窗口，请先打开直播伴侣主界面");
            throw new InvalidOperationException("找到多个直播伴侣主进程，已停止操作，请只保留一个实例");
        }

        static Snapshot Scan(IUIAutomation automation, IUIAutomationTreeWalker walker, int pid, Stopwatch clock)
        {
            diagnosticStage = "window.enumerate";
            var windows = new List<IntPtr>();
            EnumWindows(delegate(IntPtr hwnd, IntPtr unused)
            {
                uint owner;
                GetWindowThreadProcessId(hwnd, out owner);
                if (owner == (uint)pid && IsWindowVisible(hwnd)) windows.Add(hwnd);
                return true;
            }, IntPtr.Zero);
            if (windows.Count == 0) throw new InvalidOperationException("直播伴侣没有可见窗口，请先恢复主界面");

            var result = new Snapshot();
            var seen = new HashSet<string>();
            foreach (IntPtr hwnd in windows)
            {
                diagnosticStage = "uia.element-from-window";
                IUIAutomationElement root = automation.ElementFromHandle(hwnd);
                if (root == null) throw new InvalidOperationException("无法获取直播伴侣窗口的原生 UIA 根元素");
                var stack = new Stack<IUIAutomationElement>();
                stack.Push(root);
                while (stack.Count > 0)
                {
                    if (result.ElementCount >= 5000 || clock.Elapsed.TotalSeconds > 12)
                        throw new InvalidOperationException("原生 UIA 扫描未完成（元素或时间上限），已停止操作");
                    IUIAutomationElement element = stack.Pop();
                    // Queue siblings even when this element was already visited through
                    // another top-level HWND; otherwise later siblings could be omitted.
                    if (!Object.ReferenceEquals(element, root))
                    {
                        diagnosticStage = "uia.next-sibling";
                        var sibling = walker.GetNextSiblingElement(element);
                        if (sibling != null) stack.Push(sibling);
                    }
                    diagnosticStage = "uia.runtime-id";
                    int[] runtimeId = element.GetRuntimeId();
                    if (runtimeId == null || runtimeId.Length == 0)
                        throw new InvalidOperationException("无法获取 UIA 元素标识，无法安全去重");
                    if (!seen.Add(String.Join(",", runtimeId))) continue;
                    result.ElementCount++;
                    string name = Name(element);
                    if (Relevant(name) && !Flag(element, OffscreenProperty) && ElementProcessId(element) == pid)
                    {
                        result.Candidates.Add(new Candidate {
                            Element = element,
                            Name = name,
                            Enabled = Flag(element, EnabledProperty),
                            CanInvoke = Flag(element, InvokeAvailableProperty)
                        });
                    }
                    diagnosticStage = "uia.first-child";
                    var child = walker.GetFirstChildElement(element);
                    if (child != null) stack.Push(child);
                }
            }
            return result;
        }

        static bool Has(Snapshot snapshot, string label)
        {
            return snapshot.Candidates.Exists(candidate => Matches(candidate.Name, label));
        }

        static string State(Snapshot snapshot)
        {
            // Same precedence as macOS. A visible stop label is evidence of live
            // state even if that particular text node cannot itself be invoked.
            if (Has(snapshot, ConfirmLabel)) return "confirmingStop";
            if (Has(snapshot, StopLabel)) return "live";
            if (Has(snapshot, EndedLabel)) return "ended";
            if (snapshot.Candidates.Exists(candidate => candidate.Name == StartLabel &&
                candidate.Enabled && candidate.CanInvoke)) return "ready";
            return "unknown";
        }

        static Candidate Select(Snapshot snapshot, string label)
        {
            var candidates = snapshot.Candidates.FindAll(candidate => Matches(candidate.Name, label) && candidate.CanInvoke);
            if (candidates.Count > 1)
                throw new InvalidOperationException("找到多个可调用的“" + label + "”元素，已停止操作");
            if (candidates.Count == 0)
                throw new InvalidOperationException("未找到支持 Invoke 的“" + label + "”元素");
            if (!candidates[0].Enabled)
                throw new InvalidOperationException("“" + label + "”元素不可用，已停止操作");
            return candidates[0];
        }

        public static Result Run(string action)
        {
            diagnosticStage = "validate-action";
            diagnosticPid = 0;
            try { return RunCore(action); }
            catch (Exception error)
            {
                throw new InvalidOperationException("NativeStage=" + diagnosticStage +
                    "; TargetPID=" + diagnosticPid + "; " + error.Message, error);
            }
        }

        static int ElementProcessId(IUIAutomationElement element)
        {
            diagnosticStage = "uia.read-process-id";
            return Convert.ToInt32(element.GetCurrentPropertyValue(ProcessIdProperty));
        }

        static Result RunCore(string action)
        {
            if (action != "state" && action != "start" && action != "stop" && action != "confirm-stop")
                throw new ArgumentException("未知操作：" + action);
            using (Process process = FindProcess())
            {
                diagnosticPid = process.Id;
                diagnosticStage = "window.restore";
                if (IsIconic(process.MainWindowHandle))
                {
                    ShowWindowAsync(process.MainWindowHandle, 9);
                    Thread.Sleep(350);
                }
                diagnosticStage = "uia.create-client";
                var automation = (IUIAutomation)Activator.CreateInstance(Type.GetTypeFromCLSID(
                    new Guid("FF48DBA4-60EF-4201-AA87-54103EEF594E"), true));
                diagnosticStage = "uia.get-raw-walker";
                var walker = automation.GetRawViewWalker();
                var clock = Stopwatch.StartNew();
                Snapshot snapshot = null;
                string state = "unknown";
                int attempts = 0;
                // Read-only retries allow Chromium's accessibility tree to appear.
                // Once Invoke is attempted it is never automatically repeated.
                for (int i = 0; i < 6; i++)
                {
                    attempts++;
                    diagnosticStage = "process.check-exited-before-scan";
                    if (process.HasExited) throw new InvalidOperationException("直播伴侣已退出");
                    snapshot = Scan(automation, walker, process.Id, clock);
                    state = State(snapshot);
                    if (state != "unknown") break;
                    if (i < 5) Thread.Sleep(300);
                }

                var result = new Result {
                    State = state, ProcessId = process.Id, ElementCount = snapshot.ElementCount,
                    AttemptCount = attempts, Method = "nativeUIA", Invoked = false,
                    Detail = "原生 UIA 已扫描；可见目标元素数：" + snapshot.Candidates.Count
                };
                if (action == "state") return result;

                string expected = action == "start" ? "ready" : action == "stop" ? "live" : "confirmingStop";
                if (state != expected)
                    throw new InvalidOperationException("操作前状态不匹配：" + action + " 需要 " + expected + "，实际为 " + state);
                string label = action == "start" ? StartLabel : action == "stop" ? StopLabel : ConfirmLabel;
                Candidate target = Select(snapshot, label);
                // Re-read volatile target properties immediately before invoking.
                diagnosticStage = "process.check-exited-before-invoke";
                if (process.HasExited || !Matches(Name(target.Element), label) ||
                    ElementProcessId(target.Element) != process.Id ||
                    Flag(target.Element, OffscreenProperty) || !Flag(target.Element, EnabledProperty) ||
                    !Flag(target.Element, InvokeAvailableProperty))
                    throw new InvalidOperationException("目标元素状态已变化，已停止操作：" + label);
                diagnosticStage = "uia.get-invoke-pattern";
                var pattern = target.Element.GetCurrentPattern(InvokePatternId) as IUIAutomationInvokePattern;
                if (pattern == null) throw new InvalidOperationException("无法获取原生 Invoke 接口：" + label);
                diagnosticStage = "uia.invoke";
                pattern.Invoke();
                result.Invoked = true;
                result.TargetName = target.Name;
                result.Detail = "Invoke 已返回；是否完成开关播由后续状态检查确认";
                return result;
            }
        }
    }
}
