# Windows UIA 可恢复扫描设计

## 目标

定时开关播等待界面状态变化时，单轮 Windows UIA 扫描达到元素或时间上限不应立即终止整个任务；不可恢复错误及按钮操作阶段的扫描失败仍立即终止。

## 设计

- 原生驱动为扫描超限提供稳定的错误标识，不依赖中文文案判断。
- TypeScript Windows 驱动将该标识转换为专用错误类型。
- `ScheduledLiveService.waitForState()` 仅捕获该专用错误，记录警告并在整体截止时间内继续轮询。
- `readState()` 以外的 `clickStart()`、`clickStop()` 和 `confirmStop()` 不容错，避免在没有准确定位按钮时继续操作。
- 进程退出、窗口缺失、权限拒绝、COM 调用失败等错误继续立即终止。

## 范围

修改 `windowsNative.cs`、`windows.ts` 与 `ScheduledLiveService.ts`。不修改 UI、IPC、持久化语义，不增加依赖。

## 验证约束

遵循仓库要求，不新增或运行测试，不运行类型检查、静态检查或构建，仅审阅改动和调用链。
