# Windows UIA Recoverable Scan Implementation Plan

**Goal:** UIA 扫描超限时继续等待业务状态，直到整体等待超时。

**Architecture:** 原生层输出稳定错误码，Windows 驱动转换为类型化错误，业务轮询只恢复这一类错误。按钮操作和其他系统错误保持失败语义。

**Tech Stack:** Electron、TypeScript、C#、Windows UI Automation

## Global Constraints

- 不新增或修改测试。
- 不运行测试、类型检查、静态检查或构建。
- 不创建 Git 提交、分支或 worktree。

### Task 1: 标记扫描超限

**Files:**
- Modify: `electron/main/services/live-companion/windowsNative.cs`

- [ ] 为元素/时间上限异常添加稳定错误码，供 TypeScript 层识别。

### Task 2: 转换为专用错误类型

**Files:**
- Modify: `electron/main/services/live-companion/windows.ts`

- [ ] 导出扫描超限错误类型和类型守卫。
- [ ] 在 Windows 驱动错误边界识别原生错误码并转换，其他错误保持现有包装方式。

### Task 3: 等待阶段恢复扫描超限

**Files:**
- Modify: `electron/main/services/ScheduledLiveService.ts`

- [ ] 在 `waitForState()` 中捕获扫描超限错误并记录警告。
- [ ] 继续遵守原有整体截止时间和取消信号。
- [ ] 保持直接状态读取和按钮操作的失败语义。

### Task 4: 审阅

- [ ] 检查错误标识只匹配预期异常。
- [ ] 检查所有等待阶段均可恢复，所有点击阶段均不可恢复。
- [ ] 检查工作区差异，不执行验证命令。
