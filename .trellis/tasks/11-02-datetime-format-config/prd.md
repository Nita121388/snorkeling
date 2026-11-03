# PRD — 时间/日期显示格式可配置（首次安装向导 + 设置面板）

## 需求来源

用户（nita）："本项目得默认时间格式我不太喜欢，要怎么改呢" → 追问后明确要求：
**① 初始安装时支持启动设置；② 设置里增加对应配置项。**

目标不是"改死一个更好的格式"，而是把时间格式变成**用户可配置**，并在**首次安装向导**里就让用户选。

## 现状（已核实）

项目**没有任何时间格式配置项**，格式硬编码散布在下列位置：

| 显示面 | 函数 | 当前输出 |
|---|---|---|
| AISessions 列表行 | `formatSessionDateCompact` `frontend/app/view/aisessions/utils.ts:453` | `03-15 09:34`；跨年 `2025-03-15 09:34` |
| 列表 tooltip / 详情消息时间 | `formatDateTimeToSecond` `utils.ts:683` | `2026-01-05 12:00:00` |
| 列表日期（无时间） | `formatSessionDate` `utils.ts:697` | `2026-01-05` |
| 相对时间（tooltip / 刷新提示） | `formatSessionRelativeTime` `utils.ts:434`、`formatRelativeRefreshTime:419` | `3h ago`、`Refreshed 2m ago` |
| 属性面板 date / created / updated | `formatDateValue` / `formatDateTimeValue` `property/property-model.ts:312,320` | `Jan 5, 2026` / `Jan 5, 2026 09:30` |
| AI Audit 表格 | `formatTimestamp` / `formatClock` / `dayKey` `aiaudit/aiaudit-format.ts:86,93,100` | `2026-01-05 12:00:00` |
| shadcn 通用 | `formatDate` `frontend/app/shadcn/lib/utils.ts:15` | `January 5, 2026` |
| 定时任务视图 | `toLocaleString()` 直调 `frontend/app/view/scheduledtasks/scheduledtasks-view.tsx:194` | 跟随系统 locale |

基础设施现状：

- 设置体系 = `settings.json` + Go 结构体 `SettingsType`（`pkg/wconfig/settingsconfig.go:177`）；
  TS 类型由 `go run cmd/generateschema/main-generateschema.go` 生成到 `frontend/types/gotypes.d.ts:2739`。
  前端读键标准通道 `useSettingsKeyAtom`（`frontend/app/store/global.ts:237`）。
- 设置面板的真实机制是 **WaveConfig "visualComponent"**（`waveconfig-model.ts:35`）：可声明一个
  **虚拟配置项**（`path: "agentnotifications"`，非真实文件）+ `hasJsonView: false`，挂 React 面板。
  已有先例：Agent Notifications / App Theme / AI Prompts。面板写盘统一 `RpcApi.SetConfigCommand`。
- **首次安装向导已存在**：`!clientData.tosagreed` → `NewInstallOnboardingModal`（`modals/modalsrenderer.tsx:34-38`）；
  页面机 `pageNameAtom` 取值 `"init" | "notelemetrystar" | "features"`（`onboarding/onboarding.tsx:34`），
  在 `NewInstallOnboardingModal` 的 `switch` 分派。

## 需求

### R1 配置契约

`settings.json` 新增三个**正交**键（不合并成单一 enum，避免组合爆炸）：

| 键 | 取值 | 语义 |
|---|---|---|
| `app:dateformat` | `yyyy-mm-dd`（默认）/ `yyyy/mm/dd` / `mm/dd/yyyy` / `dd/mm/yyyy` / `localized` | 日期部分样式 |
| `app:timeformat` | `24h-seconds`（默认）/ `24h` / `12h` | 时间部分样式 |
| `app:relativetime` | `en`（默认）/ `zh` | 相对时间文案语言（`3h ago` / `3 小时前`） |

未设置 = 用默认值；默认值必须**等于今天的显示结果**（否则老用户升级即变样）。

### R2 首次安装向导插入格式选择页

- 页面流改为 `init` → **`datetime`** → (`notelemetrystar`) → `features`。
- 该页三组选择（日期样式 / 时间制式 / 相对时间语言），右侧**实时预览**真实渲染的当前时刻样例。
- 只在用户实际改过时才写 `settings.json`；写入点在离开该页时**一次性**提交（不逐次点写盘）。
- 允许跳过；跳过 = 不写任何键。

### R3 设置面板入口

设置（WaveConfig）侧栏新增 **Date & Time** 虚拟配置项（`visualComponent`），
内容与向导页共用**同一个**选择组件，避免两套 UI 分别演化。

### R4 硬编码格式化函数收口

上表所有格式化函数改为走**单一 formatter 模块**，组件层订阅配置变化后自动重渲染。
导出名与函数签名**保持不变**（20+ 调用点与 4 个测试文件零改动）。

## 待确认决策（实施前必须拍板）

| # | 决策点 | 提案 | 备选 |
|---|---|---|---|
| D1 | 新装用户默认值 | **保持现状默认**（`yyyy-mm-dd` + `24h-seconds` + `en`），把"用户不喜欢"交给配置解决。理由：默认值改动会波及 4 个测试文件与所有老用户截图预期 | 新默认 `yyyy/mm/dd` + `24h` + `zh`（新装即新格式，老用户因未写键仍保持原样） |
| D2 | `copy-context.ts`（喂给 AI 的上下文文本）是否跟随 UI 格式 | **不跟随**，锁死 ISO 秒级。prompt 内容随用户设置漂移会破坏可复现性 | 跟随 |

## 验收标准

1. `settings.json` 不含新键时，全应用时间显示与改动前**逐字节一致**。
2. 首次安装（`tosagreed` 为假）走完向导：`init` 之后出现格式选择页，选完 `features` 页正常，`settings.json` 出现所选键。
3. 向导点 Skip → `settings.json` **不新增**任何时间格式键。
4. 设置 → Date & Time 面板可读写三组键；改完在 AISessions 列表 / 详情 / 属性面板 / AI Audit 立即生效，无需重启。
5. 三组键的每一种取值，formatter 输出符合约定（新增单测逐值钉死）。
6. `formatDateTimeToSecond` / `formatSessionDateCompact` / `formatDateValue` / `formatDateTimeValue` / `formatTimestamp` 导出与签名不变，4 个既有测试文件在默认值下全绿。
7. 决策 D2 落地后 `copy-context` 输出不受 `app:dateformat` 等键影响（新增断言）。
8. `tsc --noEmit` 无新增错误；`eslint` 对改动文件通过。

## 约束 / 非目标

- **不引入 i18n 框架**：只做格式化输出，不做文案国际化。
- **不做时区功能**：全部本地时间（维持现状），不引入 UTC 概念。
- **不改 RPC 契约**：只加 `SettingsType` 字段，不加命令、不改现有 payload。
- **不重写 settings.json 编辑器**：新面板是独立 visualComponent 项，Monaco 编辑器路径不动。
