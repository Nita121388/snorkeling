# Design — 时间/日期显示格式可配置

## 1. 分层与边界

```
pkg/wconfig/settingsconfig.go        SettingsType 加 3 个字符串字段（契约唯一来源）
        │  task generate → frontend/types/gotypes.d.ts
        ▼
frontend/util/datetime-format.ts     ★ 新叶子模块：纯函数，零 store / RPC 依赖
        │
        ├── app/view/aisessions/utils.ts                  5 个既有函数改为薄包装（签名不变）
        ├── app/view/aisessions/property/property-model.ts
        ├── app/view/aiaudit/aiaudit-format.ts
        ├── app/shadcn/lib/utils.ts
        └── app/view/scheduledtasks/scheduledtasks-view.tsx（toLocaleString 直调）
                │
                ▼
frontend/app/element/datetime-format-picker.tsx    ★ 新共享受控组件
        ├── app/onboarding/onboarding-datetime.tsx   ★ 向导页（插在 init 之后）
        └── app/view/waveconfig/datetimeformat.tsx   ★ settings visualComponent
```

**关键原则**：formatter 是**纯函数且显式接收 options**，不读全局单例 —— 这样可单测，
且向导预览能渲染"用户正在选但尚未保存"的值。配置订阅只发生在 React 组件层。

## 2. 配置契约

### Go 侧（`pkg/wconfig/settingsconfig.go`，加在 `AppTheme` 之后）

```go
AppDateFormat   string `json:"app:dateformat,omitempty"   jsonschema:"enum=yyyy-mm-dd,enum=yyyy/mm/dd,enum=mm/dd/yyyy,enum=dd/mm/yyyy,enum=localized"`
AppTimeFormat   string `json:"app:timeformat,omitempty"   jsonschema:"enum=24h-seconds,enum=24h,enum=12h"`
AppRelativeTime string `json:"app:relativetime,omitempty" jsonschema:"enum=en,enum=zh"`
```

用 `string` 而非 `*string`：三者的"未设置"与"空串"可合并为同一个 fallback（不必区分 unset / 显式空值），
与 `AppTheme` / `AppTabBar` 一致。`jsonschema` enum 让 settings.json 的 Monaco 获得补全与校验。

改完必须 `task generate` 重生成 `frontend/types/gotypes.d.ts` —— 前端类型不手写。

### TS 侧类型

```ts
export type DateFormatStyle = "yyyy-mm-dd" | "yyyy/mm/dd" | "mm/dd/yyyy" | "dd/mm/yyyy" | "localized";
export type TimeFormatStyle = "24h-seconds" | "24h" | "12h";
export type RelativeTimeLang = "en" | "zh";

export type DateTimeFormatOptions = {
    dateFormat: DateFormatStyle;
    timeFormat: TimeFormatStyle;
    relativeTime: RelativeTimeLang;
};

export const DateTimeFormatDefaults: DateTimeFormatOptions = { /* 见决策 D1 */ };

export function resolveDateTimeFormat(settings: Partial<SettingsType> | null | undefined): DateTimeFormatOptions;
```

`resolveDateTimeFormat` 是**唯一**默认值解析点：非法 / 未知字符串一律回落默认，永不抛错。

## 3. formatter API

```ts
export function formatDatePart(ms: number, opts: DateTimeFormatOptions): string;                        // "2026-01-05"
export function formatDateTimePart(ms: number, opts: DateTimeFormatOptions): string;                    // "2026-01-05 12:00:00"
export function formatTimeOnly(ms: number, opts: DateTimeFormatOptions, withSeconds?: boolean): string;  // "12:00:00" / "12:00 PM"
export function formatRelativeTime(ms: number, now: number, opts: DateTimeFormatOptions): string;        // "3h ago" / "3 小时前"
export function normalizeTimestamp(timestamp: number): number;   // 秒→毫秒归一（从 aisessions/utils.ts 上移）
export function formatIsoSeconds(ms: number): string;            // 固定 ISO，用于 copy-context 冻结（见 D2）
```

**不引入 dayjs**：现有代码全是手写 `pad2 + getFullYear`；dayjs 的 `relativeTime` 插件要额外 locale 包
才能出"3 小时前"，而本需求只有 2 种语言、5 种日期样式，手写不到 60 行且无依赖风险。

`localized` 档用 `Intl.DateTimeFormat`（原生），其余用模式化拼装 —— 保证确定性输出，
避免 `Intl` 在 ICU 版本差异下漂移。`12h` 的 AM/PM 固定英文（与项目其它英文 UI 一致）。

## 4. 既有函数迁移策略（签名不变的薄包装）

难点：既有函数**没有 options 参数**，但调用点很多。三种做法里选第三种：

| 方案 | 问题 |
|---|---|
| 给每个函数加 opts 必填参数 | 20+ 调用点全改，4 个测试文件全改 |
| formatter 内部读全局 store | 纯函数失去可测性；向导预览无法渲染"未保存的选择" |
| **薄包装 + 模块级"当前配置"快照** | ✅ 见下 |

```ts
// frontend/util/datetime-format.ts
let currentOptions: DateTimeFormatOptions = DateTimeFormatDefaults;
export function setRuntimeDateTimeFormat(opts: DateTimeFormatOptions): void { currentOptions = opts; }
export function getRuntimeDateTimeFormat(): DateTimeFormatOptions { return currentOptions; }

// frontend/app/view/aisessions/utils.ts —— 签名、语义完全不变
export function formatDateTimeToSecond(timestamp: number): string {
    if (!timestamp) return "never";
    const normalized = normalizeTimestamp(timestamp);
    if (!Number.isNaN(normalized) && !Number.isFinite(normalized)) return "invalid time";
    return formatDateTimePart(normalized, getRuntimeDateTimeFormat());
}
```

**快照的唯一写入者**是一个订阅组件（挂在 App 根部）：

```tsx
// frontend/app/store/datetime-format-sync.tsx
const dateFormat = useSettingsKeyAtom("app:dateformat");
const timeFormat = useSettingsKeyAtom("app:timeformat");
const relativeTime = useSettingsKeyAtom("app:relativetime");
useEffect(() => { setRuntimeDateTimeFormat(resolveDateTimeFormat({ ... })); }, [dateFormat, timeFormat, relativeTime]);
```

- 配置变化 → 写快照 → 组件因自身 `useSettingsKeyAtom` 订阅或父级 re-render 重渲染 → 输出新格式。
- 好处：调用点零改动；默认值下行为与今天完全一致；单测可显式 `setRuntimeDateTimeFormat` 切档。
- 风险：模块级可变状态。缓解 —— 唯一写入者、只读访问器、测试 `beforeEach` 复位到 `DateTimeFormatDefaults`。

## 5. 首次安装向导页

`onboarding/onboarding.tsx`：

```ts
type PageName = "init" | "datetime" | "notelemetrystar" | "features";
```

- `InitPage.acceptTos()` 里 `setPageName(telemetryEnabled ? "features" : "notelemetrystar")`
  改为 `setPageName("datetime")`；新页完成后再按原逻辑前移。
- 新页 `onboarding/onboarding-datetime.tsx`：标题 + 三组选项 + 右侧实时预览。
  预览**不经过**模块级快照，直接 `formatDateTimePart(Date.now(), draftOptions)` —— "选但未保存"也能预览。
- **写盘时机**：离开该页（Next / Skip）时比较 `draftOptions` 与 `resolveDateTimeFormat(settings)`，
  有差异才发一次 `SetConfigCommand({ "app:dateformat": ..., ... })`。Skip = 显式不写（即使用户点过选项）。
- `NewInstallOnboardingModal` 的 `switch` 加 `case "datetime"`；宽度沿用 `w-[560px]`（非 features 页）。
- 现有 `useEffect`（`tosagreed` 为真时直接置 `"features"`）保留 —— 已同意 TOS 的用户不会看到新页。

## 6. 设置面板（WaveConfig visualComponent）

`waveconfig-model.ts` 配置项数组加一项（紧邻 Agent Notifications）：

```ts
{
    name: "Date & Time",
    path: "datetimeformat",          // 虚拟路径，非真实文件（与 agentnotifications 同构）
    description: "Date / time display format",
    hasJsonView: false,
    visualComponent: DateTimeFormatContent,
}
```

`view/waveconfig/datetimeformat.tsx`：

- 读：`useSettingsKeyAtom` 三个键 → `resolveDateTimeFormat`。
- 写：控件改动即 `RpcApi.SetConfigCommand(TabRpcClient, { [key]: value })`（合并写，与
  `agentnotifysettings.tsx` 同构）。
- 内容复用 `element/datetime-format-picker.tsx`；面板额外多一个"恢复默认"按钮（一次写回三键默认值）。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 模块级快照导致测试串扰 | `datetime-format.test.ts` 用 `beforeEach` 复位；`setRuntimeDateTimeFormat` 只被同步组件调用 |
| `Intl` 输出随 ICU 漂移（`localized` 档） | 该档只在用户显式选择时生效；单测不断言具体字符串，只断言非空且含数字 |
| `scheduledtasks-view.tsx` 的 `toLocaleString()` 直调 | 改为 `formatDateTimePart(ts, getRuntimeDateTimeFormat())`；同文件 `text.length.toLocaleString()`（数字千分位）**保留不动** |
| 老用户升级后格式突变 | 三键未设置 → 默认 → 输出等于今天。**写入只发生在向导/设置面板的显式用户动作**，升级路径不写盘 |
| `property-model.test.ts:118` 断言 `"Jan 5, 2026"` | 该断言与 `formatDateValue` 的英文月份绑定。归并到 `app:dateformat` 后若默认是 `yyyy-mm-dd` 则必然破 —— 属**预期改动**，必须显式记录并同步更新，不允许悄悄改 |
| 向导写入失败 | `fireAndForget`，失败不阻断向导、不弹 toast（与 telemetry 一致） |
| `gotypes.d.ts` 忘记重生成 | implement.md 校验命令含 `task generate`；tsc 会因缺键报错 |

## 8. 兼容与回滚

- 纯增量：3 个可选配置键 + 1 个新叶子模块 + 1 个新组件 + 1 个虚拟配置项 + 向导多一页。
- 回滚：删配置项与向导页即可；既有函数在无配置时行为不变（薄包装仍 fallback 到默认）。
- **无数据迁移**，不向用户磁盘写任何新文件（settings.json 之外）。
