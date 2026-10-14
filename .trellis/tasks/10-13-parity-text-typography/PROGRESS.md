# A3 在位编辑 —— 进度与续接点

> 最后更新：2026-10-14（A3 切片 1 已验证并提交 `cebb647f`）

## 目标（两条，同一条链）

1. **所见即所得**：编辑面 = 渲染面，只有一套样式（Wolai/思源/Milkdown 同构），保留本地文件优先。
2. **md 模块可单独抽出去**给其他页面工具用（`md-core` + `md-dom` + `md-react` + `md-schema` + playground）。

## 已完成（有实测证据）

### A3 切片 1：p / h1-6 / quote / callout
- 证据：`node scripts/parity-check.mjs --endpoint http://127.0.0.1:9333 --line N`
  → h1@1 / h2@5 / h3@10 / p@3 / callout-quote@12 / callout-note@14 **全部 0 差异**（30 项 computed style × 2 bucket）
- 往返：DOM → markdown 写盘逐字节保真（`**加粗**` / `*斜体*` 无损）
- 单测：897/62 全绿

### 三处「约定 → 构造」的根治
1. `previewRootAttrs` 改为调用 `srcLineAttrs`（真源）—— 手抄版在退化节点产出倒置 end 行。
2. `headingRootAttrs()` 抽进 md-core 真源，`CollapsibleHeading` 与 `EditableBlock` 共用。
3. overlay 专属物从在位根剥离：`data-block-kind` / 内联 `typography` 快照 / `data-placeholder`。
   快照是「第三条样式通道」，实测表现为 `whiteSpace: normal → pre-wrap`。

### 验证设施（新增）
- `frontend/app/element/inplace-root-isomorphism.test.tsx` —— **预览渲染器输出 ⟷ EditableBlock 输出同测对拍**（含负向锁）
- `scripts/cdp-focus-hold.mjs` —— 长连接 focus 模拟（解决 `visibilityState=hidden` 导致 CDP 输入不投递）
- `scripts/inspect-electron-ui.mjs focus` 子命令
- `scripts/parity-check.mjs` —— 识别 inplace 模式；inplace 用**更严**豁免表（几何属性一律不得豁免）
- `captureInplaceSeedHtml()` —— 在位专用种子（保留渲染器结构，只删 button）

## 未完成（按优先级）

| # | 切片 | 内容 | 状态 |
|---|---|---|---|
| 1 | **切片 2a** | list 在位化（最常用块型；preview 根是 `<ul>/<ol>`） | ⬜ 下一步 |
| 2 | 切片 2b | table / code 在位化（各有专用编辑器） | ⬜ |
| 3 | 切片 3 | 拆 overlay / 快照 / 镜像 CSS + 扩契约门禁扫描范围（当前只扫 690-853，865-964 的 `.wysiwyg-editor*` 在窗口外） | ⬜ |
| 4 | 切片 4 | flag `wysiwyg-inplace` 默认开 | ⬜ |
| 5 | D2 | 抽 `md-dom`（`markdown-inline-edit.tsx` 2302 行框架无关部分）→ `md-schema` → `md-react` → playground → journal 验证 | ⬜ |
| 6 | D3 | 逐块覆盖 7 子任务、交互层 | ⬜ |

## 关键事实（别重复踩）

- flag：`snorkeling:block-editor:wysiwyg-inplace`（`DEFAULT_OFF_FEATURES`），沙箱里已置 `on`。
- 沙箱：`http://127.0.0.1:9333`，vite `51752`，草稿在 `.runcfg/scratch-ws/`，当前打开 `scratch-lists.md`
  （内容 = `scratch-parity-all.md` 的副本：h1@1 / p@3 / h2@5 / list@7 / h3@10 / callout@12,14 / code@17 / table@21）。
- **跑验证前必须**先 `nohup node scripts/cdp-focus-hold.mjs --endpoint http://127.0.0.1:9333 &`，
  否则窗口抢不到前台 → CDP 输入不投递 → 点击全落空。
- 沙箱写盘类验证：前后比对 md5，测完还原（草稿备份在 `/tmp/parity-roundtrip.BACKUP.md`）。
- `calloutSeedHtml`（overlay）与 `captureInplaceSeedHtml`（在位）**故意不同**，不要合并。
- `heading` 的在位根是两层：外层 `.heading`（非 contenteditable，样式宿主）+ 内层 `span.heading-title`
  （contenteditable）；`headingSeedInnerHtml()` 负责剥掉种子里多出的一层。
