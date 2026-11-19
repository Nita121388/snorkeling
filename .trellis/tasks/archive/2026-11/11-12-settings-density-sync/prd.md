> **来源：`design/prototypes/settings-density/`（已可点原型 + before/*.jpg 真机证据）· 2026-11-12 @nita**

# 设置界面去密化：Sync 面板重排

## Goal

`waveconfig` → Sync（`frontend/app/view/waveconfig/syncsettings.tsx`）现在是「7 个折叠组 + `divide-y` 发丝线连排 + `max-w-2xl` 单列 + 原生 radio」，读起来像表格。按 `design/prototypes/settings-density` 的提案视图重排成**组卡 + RadioCard + 渐进式 Advanced + 底部 Save 条**，并把后端已有但面板未渲染的 `Status.Pending` 补进 Status 组。

**为什么现在做**：Common Text 云同步已落地（`11-07-commontext-cloud-sync`），Sync 是用户唯一能配它的地方；面板密度直接影响「这台机器到底在同步什么」是否看得懂。

## 做什么（范围）

### R1 共享原语（只做 Sync 用得到的部分）

新增 `frontend/app/element/setting-card.tsx`：

| 原语 | 语义 |
|---|---|
| `SettingGroup` | 组标题（12px/500，组卡**外**上方）+ 组卡容器 |
| `SettingCard` | `bg-surface` + 1px `border-border` + radius 10 + `py-2.5 px-5` |
| `SettingRow` | 文字列（标题 14/500 + 描述 12.5/1.5，间距 3px）+ 控件列，`min-h-[58px]`，**组内无线** |
| `RadioCard` / `RadioCardGroup` | HeroUI radio-card 变体：选中 2px accent 边 + `bg-actionsoft` + 右上勾；不支持选中的给 `flag` / `blockedReason` |
| `RadioRow` / `RadioRowGroup` | 整行可点的 radio 行（Conflicts 策略） |
| `AdvancedSection` | 低频组折叠（默认收起，开合状态由外部持有） |
| `SaveBar` | 草稿型面板底部唯一保存位置：hint + Discard + Save |
| `SignalBars` | 4 格信号（4=强 / 2=降级 / 0=不可达 / -1=检测中呼吸），对齐 `connectionbutton` 的 signal-bars 语汇 |
| `SettingInput` | 紧凑输入框（h-8 / mono 变体） |

### R2 Sync 面板重排（提案视图）

顺序照原型：lead → **Transport**(RadioCard 2×2) → Baseline 卡（切传输时出现）→ **Backend**(随所选传输切换字段) → **Server status**(仅 server) → **This device** → **Status**(live) → **Advanced**(Conflicts/Scope/Maintenance 折叠) → **Save bar**。

具体：

- Transport：4 张 RadioCard；`blockedReason` 以警示行呈现在卡内（**卡永远可点**——现状契约，选不中=用户永远看不到该后端字段，死锁）；`recommended` 徽标。
- Backend：`push mode` 从裸输入框改成 Realtime / On save 二选一（仍写 `commontext:sync:server:pushmode`）。
- Server status：信号格 + Version / Server data / Auth / Realtime push 四行，数据全部取自现有 `CommonTextService.SyncProbe()`（`health.appVersion` / `protocolVersion` / `items` / `rev` / `capabilities` / `requiresAuth`），不可达时保留 `wsh commontext-sync doctor --json` 文案 + Check 按钮。
- Status：**新增 `Waiting to upload` 行**（`syncStatus.pending`，后端 `syncmanager.Status.Pending` 已实现，前端类型 `Status.pending` 已生成，只是没渲染）；`Unresolved conflicts` 的数值改成右列 `ok/warn` 着色。
- Advanced 折叠默认收起，**收起状态沿用现有 localStorage 键** `commontext:syncSettings:collapsed`（不新增存储）。
- Save 收口：面板内只有底部 Save 条一处（顶部「Unsaved changes」保留为提示，不再放第二个 Save 按钮）。

### R3 不做（明确出界）

- 左栏分组 + 搜索（P3）、`agentnotifysettings.tsx` / `agentaccesssettings.tsx` 迁移（P1 后半）、General 可视化（P2）、保存印章（P4）。
- 不改任何 `commontext:sync:*` 键名、RPC、Go 后端。
- 不改 `waveconfig.tsx` 外壳（Sync 的 `hasJsonView: false`，外壳本来就不渲染 Save）。

## 约束

1. **验证台不能破**：`scripts/verify/sync-diagnostics-copy`（最近 ✅ 20/20）依赖的选择器必须全保留 ——
   `[data-sync-settings]`、`[data-sync-row="status-server"|"status-last"]`、
   `[data-sync-action="probe-server"|"sync-now"]`、`[data-copy-for-agent]`、`[data-sync-conflicts]`、`[data-sync-status-time]`。
2. `syncsettings.test.ts` 的纯函数（`blockedReasonFor` / `readSyncDraft` / `draftToSettingsPatch` / 三个 payload builder / `isProtocolCompatible`）行为不变——本任务只动渲染层与新增原语，这些导出保持原签名。
3. 颜色只用主题 token（`surface` / `border` / `actionsoft*` / `accent` / `success|warning|error`），不写死色值；浅色与 monochrome 主题都要能看。
4. 面板仍需在窄容器（waveconfig 侧栏占据宽度）下可用：RadioCard 网格在 <640px 回落单列，行内控件不裁切。

## Acceptance Criteria

- [ ] AC1 `setting-card.tsx` 导出上面 9 个原语，`SyncSettingsContent` 不再自己写 `divide-y` 行容器 / 裸 `input[type=radio]`。
- [ ] AC2 Transport 渲染为 2×2 RadioCard；`data-sync-transport` / `data-sync-transport-state` 属性保留，`blockedReason` 显示在卡内，卡仍可点。
- [ ] AC3 `Waiting to upload` 行存在且数值 = `SyncStatus().status.pending`。
- [ ] AC4 Advanced 默认收起，Conflicts/Scope/Maintenance 三组在展开后可见；收起状态写回 `commontext:syncSettings:collapsed`。
- [ ] AC5 面板内只有 1 个 Save 按钮（底部 Save 条），`dirty=false` 时禁用。
- [ ] AC6 `npx vitest run frontend/app/view/waveconfig/syncsettings.test.ts` 全绿；新增原语测试全绿。
- [ ] AC7 `tsc` 对该目录 0 新增 error（存量错误不增）。
- [ ] AC8 真机台 `node scripts/verify/sync-diagnostics-copy/verify.mjs` ≥ 20/20（选择器未破），台账追加一行。
- [ ] AC9 1440 / 900 / 390 三档下节点卡不溢出（截图证据在 `verify-runs/`）。

## Notes

- 设计依据：`design/prototypes/settings-density/README.md`（几何对照表 before→after）、`style.css` 的 `--set-*` 与 `.rc` / `.acc` / `.save-bar` / `.st-signal` 规则。
- 原型里的「原型演示」段、seg 主题切换、`before` 视图不属于产品 UI，不要搬。
