> **Confirmed: 2026-11-23 @nita**

# 定时任务管理面弹窗化（CommonText 同款 chrome，入口改工具栏按钮，不再建块）

## Goal

现在管理定时任务必须开 `scheduledtasks` Block 视图。改成 CommonText 式弹窗：工具栏按钮/命令打开，
列表 + 新建 + 编辑 + 删除 + 立即运行 + 启停全在弹窗里完成，不新建块、不页面跳转。

## Requirements

### 做什么

1. **新弹窗** `frontend/app/modals/scheduledtask-manager-modal.tsx`：
   - chrome 与 CommonText compose 一致（同一 `Modal` 组件、标题/关闭按钮/快捷键/Esc）；
   - 内容：任务列表（名称 / hero emoji（有则显示）/ 调度描述 / 启停开关 / 上次状态）+ 新建 + 编辑（复用 `scheduledtaskeditormodal`
     或其表单部分）+ 删除（带确认）+ 立即运行。
2. **开关机制**：登记 `modalregistry.tsx` 已有机制；打开/关闭时 `atoms.modalOpen` 正确置位/复位，来源登记进
   `modal-open-registry`（与 CommonText 同款口径）。
3. **入口**：AISessions / Overview 工具栏按钮 + 命令（wsh/menu 已有入口按现状扩展）；不再需要建 `scheduledtasks` 块才能管理。
4. **即时性**：增删改后弹窗内列表数即时 ±1（局部 state 更新，不刷新整块、不整块重挂）。
5. **兼容**：既有 `scheduledtasks` Block 视图保留可用（老布局不失效），但不再是唯一入口。
6. **i18n**：zh/en 两套 key 全齐（`npm run i18n:check` 0 miss）。
7. **单测** `frontend/app/modals/scheduledtask-modal.test.tsx`：
   - 打开后 `atoms.modalOpen === true`，关闭后复位；
   - 增 / 删 / 改后列表数变化 ±1；
   - Esc 关闭；未保存编辑不落盘。

### 不做什么

- 不改 ScheduledTask RPC 与调度引擎（backend 已在 `N-1123-hero-sched-core`）。
- 不删 `scheduledtasks` Block 视图（兼容保留）。
- 不重做 `scheduledtaskeditormodal` 的表单字段（hero 字段由 `N-1123-hero-sched-ui` 先落，本包只搬用）。
- 不引入新的 UI 依赖库。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/view/scheduledtasks` → 全绿（`passed`）
- [ ] `npx vitest run frontend/app/modals` → 全绿（`passed`）
- [ ] `npx vitest run frontend/app/modals/scheduledtask-modal.test.tsx` → 全绿
- [ ] `npm run i18n:check` → `I18N_OK`（0 miss）
- [ ] 红证：先写测试对现状必红，红输出存 `loop/red/N-1123-schedtask-modal.txt`，再实现转绿
- [ ] 越界文件 0 处（仅 touch 白名单内）

## Notes

- 前置：`N-1123-hero-sched-ui` 先合并（避免编辑弹窗同文件两次 merge）。
- 判据「命令 → 期望输出」；不提交、不记台账、不动看板（主 agent 收口）。
