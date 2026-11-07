# Implement — 时间/日期显示格式可配置

> 前置：决策 D1 / D2 必须先拍板（见 `prd.md`）。本清单按 **D1 = 保持现状默认** 撰写；
> 若选"新默认"，只需改 `DateTimeFormatDefaults` 一处常量 + 对应单测期望。

## 阶段 A — 契约层

1. [ ] `pkg/wconfig/settingsconfig.go`
   - `SettingsType` 加 `AppDateFormat` / `AppTimeFormat` / `AppRelativeTime` 三个 `string` 字段，
     json tag 为 `app:dateformat` / `app:timeformat` / `app:relativetime`，均带 `jsonschema` enum。
   - 位置：紧跟 `AppTheme` 之后，保持 `app:*` 分组连续。

2. [ ] 重生成类型
   - `node scripts/run-task.mjs generate`
   - 确认 `frontend/types/gotypes.d.ts` 的 `SettingsType` 出现三个新键（diff 应该只多三行）。

## 阶段 B — formatter 叶子模块

3. [ ] `frontend/util/datetime-format.ts`（新增）
   - 类型 `DateFormatStyle` / `TimeFormatStyle` / `RelativeTimeLang` / `DateTimeFormatOptions`
   - `DateTimeFormatDefaults`（按 D1）
   - `resolveDateTimeFormat(settings)` → 非法值回落默认，永不抛错
   - `normalizeTimestamp`（秒→毫秒；从 `aisessions/utils.ts` 私有实现上移，原处改 import）
   - `formatDatePart` / `formatDateTimePart` / `formatTimeOnly` / `formatRelativeTime` / `formatIsoSeconds`
   - 运行时快照 `setRuntimeDateTimeFormat` / `getRuntimeDateTimeFormat`
   - 头部注释写明"为什么放 `frontend/util` 而不放 view 目录"（对齐 `fileformat.ts` 注释风格）

4. [ ] `frontend/util/datetime-format.test.ts`（新增）
   - 5 种 dateFormat × 3 种 timeFormat 逐一钉死输出（固定时间点 + 本地时区）
   - `resolveDateTimeFormat(null)` / 非法字符串 / 部分键缺失 → 回落默认
   - 相对时间 `en` / `zh` 各档位（<10s / s / m / h / d）
   - 10 位（秒）与 13 位（毫秒）时间戳归一结果一致
   - `localized` 档只断言非空 + 含数字（ICU 漂移）
   - `beforeEach(() => setRuntimeDateTimeFormat(DateTimeFormatDefaults))`

## 阶段 C — 既有函数收口（签名不变）

5. [ ] `frontend/app/view/aisessions/utils.ts`
   - `formatDateTimeToSecond` / `formatSessionDate` / `formatSessionDateCompact` /
     `formatSessionRelativeTime` / `formatRelativeRefreshTime` 改薄包装
   - 私有 `pad2` / `normalizeTimestamp` 删除，改从 `@/util/datetime-format` import
   - **`formatRelativeRefreshTime` 的 `Refreshed ...` 前缀必须保留**
     （`utils.test.ts:157-160` 与 `session-row.test.tsx:255` 都断言了它）

6. [ ] `frontend/app/view/aisessions/property/property-model.ts`
   - `formatDateValue` / `formatDateTimeValue` 转调 formatter；`MONTHS` 数组删除
   - `property-model.test.ts:118` 的 `"Jan 5, 2026"` 断言会因默认档变化而破 → **显式更新并记录**

7. [ ] `frontend/app/view/aiaudit/aiaudit-format.ts`
   - `formatClock` / `formatTimestamp` / `dayKey` 转调 formatter
   - `dayLabel`（Today / Yesterday）逻辑保持原样，只把内部 `dayKey` 换成新实现

8. [ ] `frontend/app/shadcn/lib/utils.ts`
   - `formatDate` 转调 `formatDatePart`；若全仓无调用方则删除并留证明（rg 结果）

9. [ ] `frontend/app/view/scheduledtasks/scheduledtasks-view.tsx:194`
   - `new Date(task.lastRunAt).toLocaleString()` → `formatDateTimePart(ts, getRuntimeDateTimeFormat())`
   - 同文件 :778 `text.length.toLocaleString()`（数字千分位）**不动**

10. [ ] `frontend/app/store/datetime-format-sync.tsx`（新增订阅组件）
    - 三个 `useSettingsKeyAtom` → `useEffect` 写 `setRuntimeDateTimeFormat`
    - 挂在 App 根部（`app.tsx` 内），保证首屏渲染前完成初次同步

## 阶段 D — 共享选择组件

11. [ ] `frontend/app/element/datetime-format-picker.tsx`（新增）
    - Props `{ options, onChange, compact? }`，**受控**，自己不发 RPC
      （向导要延后写、面板要即时写）
    - 三组选择 + 右侧实时预览（`formatDateTimePart` 直算，不走快照）
    - 行布局优先复用 `agentnotifysettings.tsx` 的 `SectionRow` 形态；若值得提取则提到 element 层

12. [ ] `frontend/app/element/datetime-format-picker.test.tsx`（新增）
    - 切换选项触发 `onChange` 且 payload 正确
    - 预览文本随 `options` 变化

## 阶段 E — 设置面板

13. [ ] `frontend/app/view/waveconfig/datetimeformat.tsx`（新增）
    - `DateTimeFormatContent({ model })`：读三键 → `resolveDateTimeFormat` → `<DateTimeFormatPicker>`
    - 每次改动 `RpcApi.SetConfigCommand(TabRpcClient, { [key]: value })`（`fireAndForget`）
    - "恢复默认"：一次写入三个默认值

14. [ ] `frontend/app/view/waveconfig/waveconfig-model.ts`
    - 配置项数组加 `{ name: "Date & Time", path: "datetimeformat", hasJsonView: false, visualComponent: DateTimeFormatContent }`
    - 补 import

## 阶段 F — 首次安装向导

15. [ ] `frontend/app/onboarding/onboarding-datetime.tsx`（新增）
    - 与 `InitPage` 同款外壳（Logo + 标题 + 底部按钮），内部放 `<DateTimeFormatPicker>`（非 compact）
    - `draftOptions` 本地 state，初值 = `resolveDateTimeFormat(当前 settings)`
    - Next：有差异则 `SetConfigCommand` 后前移；Skip：不写盘直接前移

16. [ ] `frontend/app/onboarding/onboarding.tsx`
    - `PageName` 加 `"datetime"`；`InitPage.acceptTos()` 改跳 `"datetime"`
    - 新页完成后按原逻辑决定去 `"features"` 还是 `"notelemetrystar"`
    - `NewInstallOnboardingModal` 的 `switch` 加 `case "datetime"`；宽度规则归到 `w-[560px]`
    - **保留**现有 `tosagreed` 为真 → 直接 `"features"` 的 `useEffect`

17. [ ] `frontend/app/onboarding/onboarding.test.tsx`（若无则新增）
    - `tosagreed` 为假：可从 `init` 走到 `datetime` 页
    - Skip 不发 `SetConfigCommand`（mock `RpcApi`，断言调用 0 次）
    - 改动后发一次，payload 只含被改的键
    - `tosagreed` 为真：不出现 `datetime` 页

## 阶段 G — copy-context 冻结（决策 D2）

18. [ ] `frontend/app/view/aisessions/copy-context.ts`
    - D2 = 不跟随：改用 `formatIsoSeconds`（固定 ISO，不读快照）
    - `copy-context.test.ts` 补一条断言：切换 `setRuntimeDateTimeFormat` 后 copy-context 输出不变

## 校验命令

```bash
# 目标单测（快）
npx vitest run frontend/util/datetime-format.test.ts \
  frontend/app/element/datetime-format-picker.test.tsx \
  frontend/app/view/aisessions/utils.test.ts \
  frontend/app/view/aisessions/property/property-model.test.ts \
  frontend/app/view/aisessions/copy-context.test.ts \
  frontend/app/view/aisessions/session-row.test.tsx

# 类型检查（慢，>60s → async 子代理）
npx tsc --noEmit -p tsconfig.json

# lint（改动文件）
npx eslint frontend/util/datetime-format.ts frontend/app/element/datetime-format-picker.tsx \
  frontend/app/view/waveconfig/datetimeformat.tsx frontend/app/onboarding/onboarding-datetime.tsx

# Go 侧（加载本地环境后）
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./pkg/wconfig"
```

## 回归门

- `utils.test.ts` / `session-row.test.tsx` / `copy-context.test.ts` 在默认值下保持通过。
- `property-model.test.ts:118` 的 `"Jan 5, 2026"`：若因归并而破，必须显式说明并更新，不允许悄悄改断言。
- 首次安装路径手工验证：`tosagreed=false` → init → datetime → features；Skip 后 settings.json 无新键。
- 设置面板切三次档，AISessions 列表 / 详情 / 属性面板 / AI Audit 四处同步变化，不重启。
- `git diff frontend/types/gotypes.d.ts` 只多三行。
