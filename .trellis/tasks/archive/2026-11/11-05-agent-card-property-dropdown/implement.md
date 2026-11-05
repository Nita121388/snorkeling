# Implement — Agent 卡片属性下拉选择 + md 预览标签去描边

> 工作方式：主 agent 直接实现（inline），不派子 agent；多 agent 并行环境下只改本清单文件。

## 0. 前置事实核对（已完成）

- `PropertyList` 使用面只有两处，且都经 `SessionNoteSection`：
  `frontend/app/view/term/agent-hover-card.tsx`（layout=agent）、`frontend/app/block/session-detail-info-card.tsx`（layout=notion）。
- md 预览浮层 = `property-value-popover.tsx` + `property-tag-editor.tsx` + `property-palette.ts`；
  唯一 1px 描边在 `property-tag-editor.scss` 的 `.ptag-option.is-selected .ptag-option-chip`。
- 悬浮卡关闭逻辑在 `frontend/app/element/info-card/info-card-hover.tsx`，规范见
  `.trellis/spec/snorkeling-docs/frontend/component-guidelines.md` §10。

## 1. 抽出共享浮层编辑器

- [x] 新建 `frontend/app/element/property-editor/`：
  - `tag-palette.ts`（迁自 `md-properties/property-palette.ts`，导出名不变）
  - `tag-editor.tsx` + `tag-editor.scss`（迁自 `property-tag-editor.*`）
  - `value-popover.tsx` + `value-popover.scss`（迁自 `property-value-popover.*`）
  - `index.ts`（barrel）
- [x] md-properties 原 4 个文件改薄 re-export（`export * from "@/app/element/property-editor/..."`），
      `property-tag-editor.test.tsx` / `md-properties-plugin.test.tsx` 不改断言。
- 验收：`npx vitest run md-properties` 全绿。

## 2. `PropertyList` 接入浮层

- [x] 行内值按钮加 `ref` 收集（`valueElRefs`），新增 `popoverKey` state。
- [x] 类型路由（新增 `isTagLikeType(def)`）：
  - `multi_select` / `person` / `relation` → `multiple=true`，值归一 `string[]`
  - `select` / `status` → `multiple=false`，值归一 `string | null`
- [x] `startEdit`：tag-like 类型改为 `setPopoverKey(key)`（不再进 InlineEditor）；
      `InlineEditor` 的 `multi_select` 逗号分支与 `select/status` 原生 select 分支删除。
- [x] 候选：`def.options` 的 id ∪ 当前值 ∪ schema 里同名 key 的 options；去重保序。
- [x] 写回：沿用 `onChange`；多选 → `items`，单选 → `items[0] ?? null`；toggle 不关闭浮层。
- [x] 浮层节点用 `PropertyValuePopover`（锚点 = 值按钮），渲染 `PropertyTagEditor`。
- 验收：`npx vitest run property-list` 全绿（含新增用例）。

## 3. 悬浮卡保活（附属浮层）

- [x] `PropertyValuePopover` 根节点加 `data-info-card-attached="true"`。
- [x] `info-card-hover.tsx`：
  - 新增 `isAttachedLayer(node)`：`node.closest?.("[data-info-card-attached]") != null`
  - `isInside()` 并入该判断（`useInfoCardDismiss` 不再把浮层内点击当"点击外侧"）
  - `onBlurCapture`：焦点进附属浮层 → 视为卡内，保留 `cardFocusRef`
- [x] 回归测试：`info-card-hover.dom.test.tsx` 新增一例（焦点移入 attached 元素不收卡）。
- 验收：`npx vitest run info-card-hover` 全绿。

## 4. md 预览去描边

- [x] `tag-editor.scss` 删除 `.ptag-option.is-selected .ptag-option-chip { box-shadow: inset 0 0 0 1px currentcolor; }`
- [x] 选中态补行尾 ✓（`fa-check`，`margin-left:auto` 右侧对齐，颜色 `--secondary-text-color`），
      只对 `is-selected` 渲染，保证多选"哪些已选"仍可扫读。

## 5. 真机自验证

- [x] 新建 area `scripts/verify/property-editor/`（复制 `_template/verify.mjs`，能力只从 `scripts/verify/lib/` 取）：
  - case A（agent 悬浮卡）：hover agent block → 点 Tags → 浮层可见 → toggle 一项 → 属性行文本变化 →
    指针停在浮层 1s 后卡片仍开。
  - case B（md 预览）：打开 fixture md → 点 tags 值 → 浮层可见 → 已选 chip 的 computed `box-shadow` 无 `1px`。
  - 退出码 0/1/2 与 `verify-runs/` 产物遵循既有契约。
- [x] `scripts/verify/README.md` area 表登记 `property-editor`。
- [x] `node scripts/verify/property-editor/verify.mjs` 全绿 → 台账 `docs/project/verify-ledger.md` 追加一行。

## 6. 收尾

- [x] `npm run` 里既有的 lint / tsc 脚本针对性跑（只针对本任务目录，避免全仓改写）。
- [x] spec 回写：`component-guidelines.md` §10 补「附属浮层（`data-info-card-attached`）视为卡内」。
- [x] 提交：只 `git add` 本任务文件；commit message `feat(agent-card): property value dropdown editor`。
- 回滚点：步骤 1 独立可提交（纯迁移，行为不变）；步骤 2–4 行为变更；步骤 5 只加验证台。

## 验证命令

```bash
npx vitest run frontend/app/view/aisessions/property frontend/app/element/info-card frontend/app/view/preview/plugins/md-properties
npx tsc --noEmit -p frontend/tsconfig.json   # 若单独 tsconfig 不成立，用 npm script
node scripts/verify/property-editor/verify.mjs
```
