# UI 主题违规审计清单

状态：审计草稿（低风险批次已完成，HIGH/CRITICAL 批次隔离中）  
审计日期：2026-07-19  
范围：`frontend/app/` 下的 `*.tsx`、`*.scss`、`*.css`

本文是 `docs/design-system.md` 中 DS-005 的逐项审计记录。扫描命中只是候选，不等于违规；只有在确认颜色属于产品 UI、无法随 `dark`、`light`、`monochrome` 主题切换后，才标记为确认违规。终端 ANSI、diff/语法、品牌色、用户选择色、中性阴影/Backdrop 和第三方内容按最小所有者原则保留。

“已确认修复”在本文中表示静态代码已经改用语义 token，并有 `git diff` 或定向 `rg` 证据；Electron 三主题视觉验收仍需单独完成。

## 1. 扫描结论

| 指标 | 既定审计快照 | 当前工作树复跑 | 说明 |
| --- | ---: | ---: | --- |
| UI 文件全集 | 202 | 202 | `164` 个 `*.tsx`、`37` 个 `*.scss`、`1` 个 `*.css` |
| 分类后候选文件 | 49 | 36 | 既定 49 项中，13 个文件的已确认 occurrence 已完成语义化；当前复跑为 `62` 个原始命中文件减 `19` 个合法例外/已分类命中 |
| `frontend/app/theme.scss` 固定色命中 | 290 | 292 个直接 hex token | 290 是既定扫描快照；当前 292 包含说明注释中的 3 个色值，且文件处于并发修改中。该文件是主题定义所有者，不计入功能 UI 违规 |

49 个候选的可追踪关系为：

```text
49 baseline candidates
- 13 files with confirmed occurrences fixed across the AI/onboarding/shared chrome batches
= 36 candidates still requiring occurrence-level review
```

不要用当前 `62` 个原始命中替换 49 个分类后候选。前者包含语义变量派生色、测试样例和合法领域色，两者口径不同。

## 2. 已确认修复

### 2.1 从 49 项基线中移除

- [x] `frontend/app/aipanel/aidroppedfiles.tsx`：`gray/zinc/red/white` 改为 surface、border、error、action text token，并补删除按钮可访问名称与 focus-visible。
- [x] `frontend/app/aipanel/aifeedbackbuttons.tsx`：固定 `zinc` hover 与 selected 色改为 hover/action-soft/success token。
- [x] `frontend/app/aipanel/aimessage.tsx`：消息文字、附件 surface、warning 与用户消息背景改为语义 token。
- [x] `frontend/app/aipanel/airatelimitstrip.tsx`：warning/error strip 改为语义状态 token；Tailwind v4 扫描器已验证可提取动态图标类。
- [x] `frontend/app/aipanel/aitooluse.tsx`：工具卡片、按钮和状态文字改为语义 token；`ToolDescLine` 的增删 `green/red` 保留为 diff 语义例外。
- [x] `frontend/app/aipanel/restorebackupmodal.tsx`：成功、失败、正文、错误详情 surface 改为 success/error/content/surface token。
- [x] `frontend/app/onboarding/fakechat.tsx`：onboarding 内嵌 AI 预览改为 panel/surface/action/content token，并补 header 控件 focus-visible。
- [x] `frontend/app/suggestion/suggestion.tsx`：建议下拉的输入、边框、匹配字、列表和空状态改为 modal/surface/content/accent token。
- [x] `frontend/app/view/aisessions/session-message.tsx`：搜索高亮、当前匹配 ring 和 badge 改为 action-soft/accent token。
- [x] `frontend/app/commontext/commontext-compose-modal.tsx`：错误状态改为 `text-error`。
- [x] `frontend/app/block/durable-session-flyover.tsx`：浮层/按钮 surface 改为 overlay/surface/hover token；durable 图标状态色保留待复核。
- [x] `frontend/app/element/clipboard-float-actions.tsx`：Paste 浮层 hover 文本改为 `text-primary`，补 focus-visible。
- [x] `frontend/app/workspace/widgets.tsx`、`frontend/app/workspace/workspace.tsx`：WidgetsBar hover 文本和 resize handle 改为 semantic token。

### 2.2 同批已完成但不计入上述 6 项差值

- [x] AI Panel：`aimode.tsx`、`aipanel.tsx`、`aipanelheader.tsx`、`aipanelinput.tsx`、`byokannouncement.tsx`、`telemetryrequired.tsx` 已将 feature-owned 固定 palette、action、hover 和 focus 状态改为语义 token。
- [x] Wave Config：`secretscontent.tsx`、`waveconfig.tsx`、`themepicker.tsx` 已清理 feature-owned `zinc/red/yellow/black`，selected 使用 action-soft，Backdrop 使用 `--modal-backdrop-color`，disabled 使用 `cursor-default`。
- [x] 基础控件：`button.scss`、`iconbutton.scss`、`input.scss`、`multilineinput.scss`、`toggle.scss` 及对应 TSX 已补 focus-visible、disabled、error/`aria-invalid` 状态。
- [x] Action/disabled 调用点：`tab/updatebanner.tsx`、`view/tsunami/tsunami.tsx`、`view/vcs/vcs.tsx`、`view/webview/webview.tsx`、`view/aisessions/controls.tsx`、`session-detail.tsx`、`session-row.tsx` 已完成目标 action token 或 `cursor-default` 替换。
- [x] 定向静态检查：`frontend/app/view/waveconfig/waveconfig-theme-states.test.ts`、`frontend/app/aipanel/aipanel-theme-states.test.ts`、`frontend/app/element/foundation-control-states.test.ts`、`frontend/app/theme-action-colors.test.ts` 已覆盖本批关键约束。

注意：`bg-warning/10`、`bg-error/10` 在浅色主题上的静态对比度仍是 token 层候选；组件已有文字、图标和边框，不属于“仅靠颜色传意”，但应在三主题视觉验收时复核。

## 3. 当前待核验候选（36 occurrence-level candidates）

以下列表来自当前工作树的机械过滤。文件存在于列表中，不代表其中每个命中都是违规。

### 3.1 AI Panel 残余（1）

- [ ] `frontend/app/aipanel/aipanel.tsx`：当前命中主要是 `rgb(from var(--block-bg-color) ...)`；预期是语义变量派生的假阳性，需确认后关闭。

### 3.2 App、Block 与共享组件（14）

- [ ] `frontend/app/app.scss`
- [ ] `frontend/app/block/block.scss`
- [ ] `frontend/app/block/blockframe.tsx`
- [ ] `frontend/app/block/connstatusoverlay.tsx`
- [x] `frontend/app/block/durable-session-flyover.tsx`
- [x] `frontend/app/commontext/commontext-compose-modal.tsx`
- [x] `frontend/app/element/clipboard-float-actions.tsx` (confirmed occurrences fixed; remaining file candidates need review)
- [ ] `frontend/app/element/emojipalette.scss`
- [ ] `frontend/app/element/progressbar.scss`
- [ ] `frontend/app/element/quicktips.tsx`
- [ ] `frontend/app/element/selection-copy-overlay.tsx`
- [ ] `frontend/app/modals/about.tsx`
- [ ] `frontend/app/modals/modal.scss`
- [ ] `frontend/app/modals/typeaheadmodal.scss`

优先检查 feature-owned `white/black/gray/zinc` surface 与 text。`rgb(from var(--...))`、box-shadow 和纯 Backdrop 命中可按出现位置关闭，不应整文件豁免。

### 3.3 Onboarding（7）

- [x] `frontend/app/onboarding/fakechat.tsx`
- [ ] `frontend/app/onboarding/onboarding.tsx`
- [ ] `frontend/app/onboarding/onboarding-durable.tsx`
- [ ] `frontend/app/onboarding/onboarding-layout.tsx`
- [ ] `frontend/app/onboarding/onboarding-layout-term.tsx`
- [ ] `frontend/app/onboarding/onboarding-upgrade-minor.tsx`
- [ ] `frontend/app/onboarding/onboarding-upgrade-v0140.tsx`

该组仍有固定 `zinc/gray/white` 聊天 surface、正文和图标色，优先级高；遮罩用 `black/*` 与 durable shield 的领域色应逐 occurrence 分类。

### 3.4 Session、Suggestion 与 Tab（6）

- [ ] `frontend/app/session-overview/session-overview.scss`
- [x] `frontend/app/suggestion/suggestion.tsx`
- [ ] `frontend/app/tab/tab.scss`
- [ ] `frontend/app/tab/tab-target-modal.tsx` (HIGH impact; separate batch)
- [ ] `frontend/app/tab/vtab.tsx`
- [ ] `frontend/app/tab/workspaceswitcher.scss`

搜索高亮、error/status 色不自动获得例外；若是产品状态，应改用 warning/error/success token。用户配置的 badge/workspace 色另见合法例外。

### 3.5 Views（13）

- [ ] `frontend/app/view/aisessions/aisessions.tsx`
- [ ] `frontend/app/view/aisessions/session-detail.tsx`
- [x] `frontend/app/view/aisessions/session-message.tsx`
- [ ] `frontend/app/view/launcher/launcher.tsx`
- [ ] `frontend/app/view/preview/directorypreview.scss`
- [ ] `frontend/app/view/preview/preview-directory.tsx`
- [ ] `frontend/app/view/preview/preview-error-overlay.tsx`
- [ ] `frontend/app/view/preview/preview-explorer.tsx`
- [ ] `frontend/app/view/processviewer/processviewer.tsx`
- [ ] `frontend/app/view/term/term-tooltip.tsx`
- [ ] `frontend/app/view/vcs/vcs.tsx`
- [ ] `frontend/app/view/webview/webview.scss`
- [ ] `frontend/app/view/webview/webview.tsx` (bookmark empty-state occurrences fixed; other file candidates remain)

`term-tooltip.tsx` 是终端周边的产品 UI，不随 xterm 一起整文件豁免。WebView 自身的第三方页面可豁免，但书签空状态、工具栏和 overlay 仍由产品主题负责。

### 3.6 Workspace（2）

- [x] `frontend/app/workspace/widgets.tsx`
- [x] `frontend/app/workspace/workspace.tsx`

重点核验 WidgetsBar 的 `hover:text-white` 与 resize handle 的固定 `zinc` hover；这两处是产品 chrome，不属于领域色。

### 3.7 高风险隔离项（2）

- [ ] `frontend/app/tab/tab-target-modal.tsx`：错误分支的 `text-red-400` 已确认应改为 `text-error`；GitNexus upstream impact 为 HIGH（8 个上游符号、2 条流程、3 个模块），单独批次处理。
- [ ] `frontend/app/modals/modal.scss`：`.modal` 的 `0.5px` 边框违反基础几何契约，应改为 `1px`；关联 `Modal`/`FlexiModal` impact 为 CRITICAL（28/11 个上游符号，3/1 条流程），需单独完成全局 modal 视觉回归后再编辑。

## 4. 合法例外与假阳性

### 4.1 主题定义

- `frontend/app/theme.scss`：既定 290 个固定色命中全部属于 dark/light/monochrome 主题变量或其领域 palette 定义。消费者必须引用角色，定义文件本身允许写具体色值。
- `frontend/tailwindsetup.css`：位于本扫描范围外，是 CSS 变量到 Tailwind token 的映射所有者；`source-claude`、`source-codex` 与 ANSI 映射属于品牌/终端例外。

### 4.2 终端、ANSI 与语法/diff

- 终端/xterm：`frontend/app/view/term/agent-logo.tsx`、`envmodal.scss`、`ijson.tsx`、`term.scss`、`term.tsx`、`termsticker.tsx`、`xterm.css`。
- 同类支持文件（不在 202 个 UI 文件全集内）：`frontend/app/monaco/monaco-env.ts`、`frontend/app/view/term/termutil.ts`、`termwrap.ts`。
- 语法/diff：`frontend/app/element/markdown.scss`、`frontend/app/view/aifilediff/aifilediff.tsx`、`frontend/app/view/preview/preview-edit.scss`、`frontend/app/view/vcscommits/vcscommits.tsx`、`frontend/app/view/vcsdiff/vcsdiff.tsx`、`frontend/app/view/vcshistory/vcshistory.tsx`。

例外只覆盖 terminal canvas、ANSI、syntax token、diff insertion/deletion 等领域内容；tooltips、headers、empty states 和外围 panel 仍使用产品语义 token。

### 4.3 品牌、用户选择色与测试样例

- 品牌/agent：`frontend/app/view/term/agent-logo.tsx`。
- 用户选择或服务端 badge 色：`frontend/app/block/blockframe-header.tsx`、`frontend/app/session-overview/session-overview.tsx`、`frontend/app/tab/tabbadges.tsx`、`frontend/app/tab/tabcontextmenu.ts`。
- 图表数据系列：`frontend/app/view/sysinfo/sysinfo.tsx`；图表外围 UI 仍使用产品 token。
- 测试样例：`frontend/app/tab/vtab.test.tsx`、`frontend/app/theme-action-colors.test.ts`、`frontend/app/view/waveconfig/waveconfig-theme-states.test.ts` 中的颜色字符串不作为运行时违规。

### 4.4 阴影、Backdrop 与透明遮罩

以下 occurrence 可以保留固定中性黑/白，但不得借此豁免同文件的 feature surface/text：

- `box-shadow` 的透明黑，例如 `frontend/app/block/block.scss`、`frontend/app/modals/modal.scss`、`frontend/app/modals/typeaheadmodal.scss`。
- 模态或沉浸层 Backdrop，例如 `frontend/app/onboarding/onboarding-layout.tsx`。
- 由语义变量派生的透明色，例如 `rgb(from var(--main-bg-color) ...)`、`rgb(from var(--block-bg-color) ...)`。

## 5. 复跑命令与证据

在仓库根目录 `E:\primary\projects\snorkeling-light-theme` 执行：

```powershell
# UI 文件全集：202
Get-ChildItem frontend\app -Recurse -File |
    Where-Object { $_.Extension -in '.tsx', '.scss', '.css' } |
    Measure-Object
```

```powershell
# 原始固定色候选；当前工作树为 62 个文件，尚未扣除合法例外。
$pattern = '#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(|(?:bg|text|border|ring|from|to|via|decoration|outline|fill|stroke|divide|placeholder|caret|accent|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:/[0-9]{1,3})?'
rg -l -P --glob '*.tsx' --glob '*.scss' --glob '*.css' --glob '!theme.scss' $pattern frontend\app |
    Sort-Object
```

```powershell
# 主题定义快照核对。当前直接 hex token 为 292；既定审计快照记录为 290。
rg -o '#[0-9A-Fa-f]{3,8}\b' frontend\app\theme.scss |
    Measure-Object
```

当前分类证据为 `62 raw - 19 documented exceptions = 36 occurrence-level candidates`（已从基线中扣除本批确认修复的 13 个文件）。由于工作树有并发修改，提交前必须重跑并更新本节；若数字变化，保留旧快照和新结果，不要修改口径来“凑”49。

## 6. 关闭条件

- [ ] 对 36 个当前候选逐 occurrence 标记：确认违规、合法例外、语义变量派生假阳性或已修复。
- [ ] 确认违规使用现有 semantic token 做最小替换，不批量替换 palette。
- [ ] dark/light/monochrome 分别通过 Electron CDP 截图与 computed style 核验。
- [ ] 键盘验证 focus-visible；disabled/error/loading 状态不改变布局。
- [ ] 定向测试、`npm run build:prod` 和 GitNexus `detect_changes()` 通过后，再关闭 DS-005。
