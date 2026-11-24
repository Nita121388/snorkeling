> **Confirmed: 2026-11-24 @nita**

# 定时任务入口回归右侧 widget + 弹窗版式对齐 CommonText

> 拍板：方案页面 docs/answers/定时任务widget弹窗改造方案-20261124.html；标题区选①保留结构化 header、字号提到 16px。

## Goal

需求原话：点击 app 右侧的定时任务 widget，打开和 CommonText 相同的弹窗样式，而不是建 Block。
昨天（commit 8939d11f5）实现错位：入口被做成 Overview 工具栏按钮；弹窗版式与 CommonText 差距大（无尺寸窄框、14px 标题 + 实现语副标题、padding=false、无底栏）。
本包：入口回归右侧 widget（action 模式，与 `defwidget@commontext` 同构）+ 弹窗版式四处对齐 CommonText。

## Requirements

### 做什么

1. **入口**（`pkg/wconfig/defaultconfig/widgets.json` + `frontend/app/workspace/widget-actions.ts`）：
   - `defwidget@scheduledtasks` 去掉 `blockdef`，改为 `"action": "scheduledtasks:manager"`；
   - `widget-actions.ts` 新增该 action 的 case：`modalsModel.pushModal("ScheduledTaskManagerModal", {})`；
   - `pkg/wconfig/settingsconfig.go` 的 `Action` jsonschema enum 补 `scheduledtasks:manager`。
2. **移除错位入口**：删 `session-overview.tsx` 工具栏「定时任务」按钮（`data-overview-schedtask-manager`）及
   en/zh `session-overview.json` 的 `schedTasks.openManager` key。
3. **弹窗版式对齐 CommonText**（`scheduledtask-manager-modal.tsx`）：
   - 尺寸：`width: min(85vw,900px)`、`height: min(78vh,620px)`、`minWidth:500`、`minHeight:350`、
     `maxWidth:96vw`、`maxHeight:92vh`（与 commontext-compose-modal.tsx:1885 同值）；
   - 内边距：去掉 `padding={false}` / `scrollBody={false}`，className 加 `pt-6 pb-3`（16px 基准）；
   - 标题：保留结构化 header，去掉 subtitle（「不需要新建块」是实现语），标题字号 16px（选项①）；
   - 结构：删掉内容区顶部「共 N 个任务 + 新建任务」横条，计数移到底部行左侧、
     「新建任务」移到底部行右侧（保持 `data-schedtask-new` 锚点）。
4. **真机验证台**（`scripts/verify/scheduled-hero/verify.mjs`）：S4 段由工具栏按钮改为右侧 widget 点击。

### 不做什么

- 不删 `scheduledtasks` Block 视图（老布局兼容保留）。
- 不做 resize 拖拽与尺寸记忆（CommonText 的 resize hook 抽共享，二期）。
- 不改 ScheduledTask RPC 与调度引擎。
- 不动 Overview 独立「定时任务」区（OverviewScheduledTasksSection，N-1123-hero-sched-ui 交付物）。

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/workspace/widget-actions.test.ts` → 全绿（action 打开管理弹窗）
- [ ] `npx vitest run frontend/app/modals/scheduledtask-modal.test.tsx` → 全绿（含尺寸/底栏新断言）
- [ ] `node scripts/i18n/check-parity.mjs` → 0 miss
- [ ] `npx eslint frontend/app/modals frontend/app/workspace frontend/app/session-overview` → 0 error
- [ ] 红证：`loop/red/N-1124-schedtask-entry-fix.txt`（对现状必红的测试输出）
- [ ] 越界文件 0 处（仅 touch 白名单内）
- [ ] 真机：点右侧 widget 打开弹窗、不建 Block；弹窗宽命中 min(85vw,900px)

## Notes

- 触摸白名单（loop 包）：`frontend/app/modals/**`, `frontend/app/workspace/**`, `frontend/app/session-overview/**`,
  `frontend/i18n/locales/**`, `pkg/wconfig/**`, `scripts/verify/scheduled-hero/**`, `docs/project/**`, `loop/red/**`, `.trellis/**`
- 根因教训（G7 验收时记）：验收判据只写了「命令 → 期望输出」，没写「与 CommonText 的版式差值」，
  「同款 chrome」在代码层面成立、视觉层面不成立却过了门。
