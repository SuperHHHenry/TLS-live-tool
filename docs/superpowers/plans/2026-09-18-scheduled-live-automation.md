# 自动开播联动实施计划

**目标：** 仅新增自动调用已有中控连接流程的入口。
**架构：** 原样提取 StatusCard 的连接回调到 useConnectLiveControl；全局 useScheduledLiveConnection 监听 countingDown 状态并调用同一回调。
**技术：** React、Electron IPC、TypeScript、node:test。

- [x] 提取原回调，按钮调用共享 hook；App 挂载全局监听 hook。保持回调内容不变。
- [x] 逐字比较提取代码和原版本，确认原连接及自动启动逻辑保留。
- [x] 执行 TypeScript 静态检查，结果通过。
- [x] 按用户最新要求删除本轮新增测试文件，不再编写或运行测试。
