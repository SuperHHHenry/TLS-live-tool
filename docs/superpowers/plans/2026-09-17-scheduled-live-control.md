# 抖音直播伴侣定时开关播 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Electron 应用中增加 Windows 与 macOS 通用的抖音直播伴侣定时开播、确认开播、倒计时和自动确认关播功能。

**Architecture:** Electron 主进程持有唯一任务和计时状态，通过平台驱动调用 Windows UI Automation 或 macOS Accessibility 操作直播伴侣。渲染进程通过类型化 IPC 启动、取消和订阅任务状态，只负责配置与展示。

**Tech Stack:** Electron、TypeScript、React、Zustand、Windows PowerShell UI Automation、macOS AppleScript Accessibility

## Global Constraints

- 用户输入“小时 + 分钟”，总时长必须大于零。
- 只有确认进入直播状态后才开始倒计时。
- 关播需要依次点击“关播”和确认框中的“关闭直播”。
- 自动操作前允许恢复并置顶抖音直播伴侣窗口。
- 应用退出即取消任务，不恢复倒计时。
- 取消任务不主动结束已经开始的直播。
- 不创建或修改测试代码，不运行测试命令；由用户手动测试。

---

### Task 1: 定义任务状态与 IPC 合约

**Files:**
- Modify: `shared/ipcChannels.ts`
- Modify: `shared/electron-api.d.ts`
- Modify: `shared/types.d.ts`

**Interfaces:**
- Produces: `ScheduledLiveStatus`、`ScheduledLiveSnapshot`、启动/取消/状态/事件 IPC。

- [x] 在共享类型中定义任务阶段、快照和启动参数。
- [x] 添加 `scheduledLive.start`、`scheduledLive.cancel`、`scheduledLive.status` 和 `scheduledLive.statusChanged` 频道。
- [x] 为四个频道补齐严格的参数和返回类型。

### Task 2: 实现跨平台直播伴侣驱动

**Files:**
- Create: `electron/main/services/live-companion/types.ts`
- Create: `electron/main/services/live-companion/shell.ts`
- Create: `electron/main/services/live-companion/windows.ts`
- Create: `electron/main/services/live-companion/macos.ts`
- Create: `electron/main/services/live-companion/index.ts`

**Interfaces:**
- Produces: `LiveCompanionDriver`，提供 `readState()`、`clickStart()`、`clickStop()`、`confirmStop()`。

- [x] 创建可设置超时、无 shell 注入的 `execFile` 封装。
- [x] 使用 PowerShell UI Automation 查找并激活 Windows 直播伴侣窗口，按可访问名称读取和点击控件。
- [x] 使用 AppleScript System Events 查找并激活 macOS 直播伴侣进程，按可访问名称读取和点击控件。
- [x] 建立平台驱动工厂，对不支持的平台返回明确错误。
- [x] 在按钮无法唯一识别、应用未运行或权限不足时返回可展示错误，禁止未知位置点击。

### Task 3: 实现主进程任务状态机

**Files:**
- Create: `electron/main/services/ScheduledLiveService.ts`
- Create: `electron/main/ipc/scheduledLive.ts`
- Modify: `electron/main/ipc/index.ts`

**Interfaces:**
- Consumes: `LiveCompanionDriver` 和共享任务类型。
- Produces: 单例任务服务与 IPC handler，状态变化通过 `windowManager.send` 推送。

- [x] 实现单任务状态机和快照广播。
- [x] 启动时点击开播，并轮询到 `live` 后记录 `startedAt` 与 `endsAt`。
- [x] 到期时依次点击关播、等待确认框、点击关闭直播，并验证回到 `ready`。
- [x] 为各阶段设置有限超时与重试间隔，失败时停止后续点击。
- [x] 实现取消语义：中止等待和倒计时，但不操作直播伴侣。
- [x] 注册启动、取消和读取状态的 IPC handler。

### Task 4: 实现渲染进程状态 hook 与操作界面

**Files:**
- Create: `src/hooks/useScheduledLive.ts`
- Create: `src/pages/LiveControl/components/ScheduledLiveCard.tsx`
- Modify: `src/pages/LiveControl/index.tsx`

**Interfaces:**
- Consumes: `scheduledLive` IPC 合约。
- Produces: 时长输入、启动/取消操作、阶段与剩余时间展示。

- [x] 创建 hook，首次读取主进程状态并订阅状态变化事件。
- [x] 创建小时和分钟输入，校验小时非负、分钟为 `0-59` 且总时长大于零。
- [x] 创建启动按钮、运行状态、倒计时和取消按钮。
- [x] 对权限不足、应用未运行、按钮不可识别和关播失败展示明确错误。
- [x] 把卡片加入现有直播控制台页面，并保持现有页面结构和样式。

### Task 5: 人工交付检查清单

**Files:**
- No code changes.

- [x] 检查 Git diff，确保未覆盖用户已有的 `Sidebar.tsx` 修改。
- [x] 向用户列出 macOS 辅助功能授权、Windows 权限要求及完整手测流程。
- [x] 明确说明未按用户要求运行测试或静态检查。
