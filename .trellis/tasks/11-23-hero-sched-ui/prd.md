> **Confirmed: 2026-11-23 @nita**

# Hero 定时执行前端：任务编辑弹窗 hero 选择器 + Overview 独立「定时任务」区

## Goal

后端（`N-1123-hero-sched-core`）已给 `ScheduledTaskType` 加 `hero` 字段并处理 hero home / meta 注入。
本包把能力搬到 UI：编辑弹窗能选 hero，Overview 有一个独立的「定时任务」区（不挂在 hero 卡上）。

## Requirements

### 做什么

1. **编辑弹窗 hero 选择器**（`frontend/app/modals/scheduledtaskeditormodal.tsx`）：
   - hero 下拉（roster 列表，可清空 = 不绑定 hero），显示 emoji + 名称；
   - 选中 hero 时，workdir 输入框 placeholder 提示 `<hero home>`（留空即继承），provider/model 留空即继承 hero.json；
   - 保存后读回一致（`ScheduledTaskCreate/Update` 透传 `hero`）。
2. **Overview 独立「定时任务」区**：
   - 纯函数投影模块 `frontend/app/session-overview/overview-scheduled-tasks.ts`：
     输入任务列表 → 输出渲染项（hero emoji / 任务名 / 下次运行时间 / 上次状态 / 启停开关 / disabled 标记）；
     排序：enabled 优先，其次 nextRun 升序；disabled 仍列出但置灰（数量不变）；
   - 视图接入 `overview-board.tsx`（或同目录合适位置），点击卡片 → 打开编辑弹窗；
   - 下次运行时间文案与 `GetNextRunTime` 同口径（复用现有格式化工具，禁止另写一份时间格式）。
3. **i18n**：新增文案 zh/en 全齐（`npm run i18n:check` 0 miss）。
4. **单测**：
   - `overview-scheduled-tasks.test.ts`：N 个 enabled → N 项；disabled 仍在列（数量 = 全部）；空列表空态；排序稳定；
   - 弹窗侧：hero 选中/清空后提交载荷含/不含 `hero`。
5. 已有 `frontend/app/session-overview` 既有用例不回归。

### 不做什么

- 不碰 `pkg/`（后端在 core 包；若后端字段缺失，只在 PR 说明里登记，不要自行改 Go）。
- 不重做编辑弹窗其它字段与样式体系，不引入新依赖。
- 不改 hero 卡本身、不改 persona roster 视图。
- 不做定时任务的历史记录重设计（沿用现有 `ScheduledTaskHistoryCommand` 展示）。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/session-overview` → 全绿（`passed`）
- [ ] `npx vitest run frontend/app/session-overview/overview-scheduled-tasks.test.ts` → 全绿
- [ ] `npx vitest run frontend/app/modals` → 全绿
- [ ] `npm run i18n:check` → `I18N_OK`
- [ ] 红证：先写测试对现状必红，红输出存 `loop/red/N-1123-hero-sched-ui.txt`，再实现转绿
- [ ] 越界文件 0 处（仅 touch 白名单内）

## Notes

- 前置：`N-1123-hero-sched-core` 已合并（`hero` 字段可读写）。
- 判据「命令 → 期望输出」；不提交、不记台账、不动看板（主 agent 收口）。
