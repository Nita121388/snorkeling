# 技术设计 — Sync 面板重排

## 1. 边界

```
frontend/app/element/setting-card.tsx       新增：9 个纯展示原语（无 RPC、无 atom、无状态）
frontend/app/view/waveconfig/syncsettings.tsx  只改渲染层（+ 新增 pending / probe 字段读取）
frontend/app/view/waveconfig/syncsettings.test.ts  不动（纯函数契约不变）
scripts/verify/sync-diagnostics-copy/verify.mjs    不动（选择器全部保留）
```

**不碰**：`waveconfig.tsx` / `waveconfig-model.ts` / Go 侧 / settings 键名 / RPC 名。

## 2. 为什么原语放 `element/` 而不是 `waveconfig/`

`agentnotifysettings.tsx` / `agentaccesssettings.tsx` / `syncsettings.tsx` 三个面板将来都要换同一套排版（README P1）。放 `element/` 让第二个面板迁移时不用跨 view 目录 import；原语本身不依赖 waveconfig 的 model，只吃 props。

命名避开 `element/input.tsx`（已有 Input 组件）与 `element/toggle.tsx`，新文件单开 `setting-card.tsx`。

## 3. 原语 API（渲染即产物，无内部状态）

```tsx
SettingGroup   { title, extra?, className?, children }        // 组标题 + 组卡
SettingCard    { children, className?, wide?: boolean }        // wide → max-w-[880px]
SettingRow     { title, description?, rowKey?, disabled?, badge?, children }  // 控件 = children
               // rowKey → data-sync-row（沿用现有属性名，验证台靠它）
RadioCardGroup { name, className?, children }
RadioCard      { value, selected, onSelect, title, description, flag?, warn?, inputProps? }
               // inputProps 透传 data-sync-transport / data-sync-transport-state，保证选择器不变
RadioRowGroup  { name, children }
RadioRow       { value, selected, onSelect, title, description, badge?, attrs? }
AdvancedSection{ title, subtitle?, open, onToggle, children }
SaveBar        { hint?, dirty, saving?, onSave, onDiscard?, saveLabel? }
SignalBars     { level: 4|3|2|0|-1, label }
SettingInput   { value, onChange, mono?, width?, ... }
```

内部实现约定：

- 行高用 `min-h-[58px] py-[15px] px-1`，**不加 `divide-y`**；组与组之间 `mb-8`（32px）。
- 标题 `text-sm font-medium`，描述 `text-[12.5px] leading-[1.5] text-muted-foreground mt-[3px]`，`max-w-[520px]`。
- RadioCard 选中：`border-2 border-accent bg-actionsoft` + `padding` 抵消 1px（避免选中时卡片跳动）；未选 `border border-border bg-surface hover:border-actionsoftborder`。
- 所有 radio input 保持真实 `<input type="radio">`（`sr-only` + peer 样式不可行，因为需要 `data-sync-*` 落到行上；这里用 `<label>` 包 input，input 视觉隐藏 `opacity-0 absolute`，焦点环画在卡片上）。**验证台用 `.click()` 点行/卡**，label 包裹可命中。
- `SignalBars` 用 4 个 `span` + 内联 style 高度，颜色走 token。level 由 probe 推导：`ready && 兼容 → 4`；`ready && !兼容或 checks 有 fail → 2`；`probe==null → -1`；`!ready → 0`。

## 4. Sync 面板数据流（变化点）

现有 `SyncSettingsContent` 已有 `draft / dirty / status / syncStatus / probe / probing / baselinePending / switching / collapsed`，**状态机不改**，只：

1. 新增派生：`signalLevel`、`serverHealth = probe?.probe?.health`、`pendingCount = syncStatus?.pending ?? 0`。
2. `collapsed` 复用（键仍 `transport|backend|device|conflict|scope|status|maintenance`），但渲染改成：`transport/backend/device/status` 常显（不再有组头折叠），`conflict/scope/maintenance` 收进一个 `advanced` 折叠键。
   → localStorage 里旧键保留但不再读 `conflict/scope/maintenance`；新增 `advanced` 键。读旧记录时忽略多余键（`loadCollapsedGroups` 已是宽松解析），无需迁移。
3. delta：`push mode` 改二选一（`realtime` / `onsave`），`patch({serverPushMode})`；未知值按 `realtime` 展示但**不覆盖**用户原值，只有点击才写。

## 5. 兼容与回滚

- 回滚 = 单文件 revert（`setting-card.tsx` 新增文件可留，Sync 面板回退）。settings 键、RPC、状态机都没动，无数据迁移风险。
- 风险点：验证台选择器。缓解：原语把 `rowKey` / `inputProps` 透传到同一 DOM 位置；实现完先跑 `sync-diagnostics-copy` 台子（headless Chrome + 真 Electron）。

## 6. 判据（可机器执行）

| # | 命令 | 期望 |
|---|---|---|
| J1 | `npx vitest run frontend/app/view/waveconfig/syncsettings.test.ts frontend/app/element/setting-card.test.tsx` | 全 passed |
| J2 | `npx tsc --noEmit`（只看 `waveconfig/` `element/setting-card` 是否新增 error） | 新增 error = 0 |
| J3 | `grep -c '\"divide-y\"' syncsettings.tsx` | 0 |
| J4 | `grep -c 'type=\"radio\"' syncsettings.tsx` | 0（radio 都在原语里） |
| J5 | `grep -c '<button' syncsettings.tsx` 里 Save 按钮数 | 1（SaveBar 的） |
| J6 | `node scripts/verify/sync-diagnostics-copy/verify.mjs` | ≥20/20 ✅ |
| J7 | 截图 1440/900/390 | 无溢出（`scrollWidth <= clientWidth + 1`） |
