# N-1124 schedtask-entry-fix 红证源码存档

这两个 `*.spec.ts(x).txt` 是**红证阶段改写的测试源码**（去掉 `.txt` 后缀即恢复）：
把「定时任务入口」的期望从"建块"改成"打开管理弹窗"，但实现侧
（`widget-actions.ts` 的 `ScheduledTaskManagerWidgetAction` 分发、`ScheduledTaskManagerModal`）尚未落地，
直接放回会让测试必红。

**实现该包时**：先恢复这两个文件，跑红（红证原文见 `../N-1124-schedtask-entry-fix.txt`），再实现。
