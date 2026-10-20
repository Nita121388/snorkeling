# 夜间自主执行清单 — AISessions / Preview / 交互性能

> 状态：● 已与 `main`（`6df7d63c`）对账
> 用途：交给夜间 Agent 自主排序、实现、验证。
> 生成时间：2026-09｜对账时间：基于 main 最新提交

---

## 0. 先读这个：本仓库已有任务追踪系统

本仓库在 `.trellis/tasks/` 下已有**权威任务系统**（Trellis）。父任务：

```
.trellis/tasks/10-19-aisessions-ux-perf-overhaul/   （status: in_progress）
```

子任务（PRD 已完成，按波次编排，见该目录 `design.md` / `implement.md`）：

| Trellis 任务 | 标题 | 状态 |
|---|---|---|
| `10-19-aisessions-full-load` | 全量加载会话详情不卡顿 | in_progress |
| `10-19-aisessions-refresh-icon` | 刷新控件纯图标化 + 修重叠 | in_progress |
| `10-19-preview-txt-html-modes` | txt 内部预览 + html 三模式 | in_progress |
| `10-19-commontext-paste-image` | CommonText 粘贴图片 | in_progress |
| `10-19-aisessions-annotate` | 消息标注（文字/命令/工具） | planning |
| `10-19-aisessions-subagent-fold` | 子代理折叠进父时间线 | planning |
| `10-19-aisessions-block-separation` | 列表/详情分离为独立 Block | planning |

**规则**：凡与本文件重叠的任务，**以 Trellis PRD 为准**（交互/默认值已在 PRD 里拍板）。本文件只保留 **Trellis 未覆盖的缺口**，以及**对已实现部分的核对结论**。

---

## 1. 对账结果（用户原始 8 条 → 现状）

| # | 用户原始诉求 | 归属 | 现状（已核实） |
|---|---|---|---|
| 1 | Load more 能否 Load all / 影响性能吗 | full-load | **部分完成**。后端 `Detail` 已支持 `loadAll` 分帧，前端打开详情即自动续帧（`0f09a441`，`agent.tsx:225` / `loadDetailFullFrames`）。**但** `session-detail.tsx` 仍是 30 条/页 + `Load more` 切片渲染，**没有虚拟列表、没有懒渲染、没有 Load all 按钮**。 |
| 2 | 报错的脚本/工具执行 能否删除 / 撤回 | annotate | **已被搁置**。`10-19-aisessions-annotate/prd.md` 明确写「不做删除 / 软删（用户已决定搁置）」。annotate 改为做「标注」。→ 见 §4 裁决 D1。 |
| 3 | CommonText 支持粘贴图片 | commontext-paste-image | ✅ **已完成**（`85d1fd72`）：`commontext-paste-image.ts` + compose modal 接线 + 测试。 |
| 4 | 自动刷新按钮与关闭按钮重叠 / auto 刷新价值 | refresh-icon | **未完成**。`refresh-status-icon.tsx:108` 仍在渲染 `Auto` 徽标。 |
| 5 | AI 会话接口超时（Detail / Note / Tag） | full-load（设计里顺带修） | **设计已定调，代码未落地**。`design.md` §性能根因 已给出方向；细项未实现。 |
| 6 | 列表与详情分离（block / tab / Ctrl+点击） | block-separation | **未开始**（planning）。 |
| 7 | txt 无法内部预览？ | preview-txt-html-modes | **部分**。`preview-text-modes.ts` 已定义 `PlainTextExtensions = {txt,text,log}`；是否真正生效需实测（见 §3 G3）。 |
| 8 | html 三种打开模式 + 交互区分 | preview-txt-html-modes | ✅ **已完成**（`e54447d6`）。入口：header menubutton / cycle button / 目录右键菜单。**默认模式 = `preview`（内部渲染）**，按扩展名记忆。 |
| + | 子代理折叠 | subagent-fold | 未开始（planning），**不在用户原始清单，但 Trellis 已立**。 |
| + | WidgetsBar 悬浮 agent 弹窗慢一拍 | 无 | **未被任何 Trellis 任务覆盖** → §3 G1。 |
| + | Tab 组 + 号二级 agent 弹窗慢一拍 | 无 | **未被覆盖** → §3 G2。 |

---

## 2. 给执行 Agent 的通用纪律

1. 先读 `AGENTS.md`、`CLAUDE.md`、`.kilocode/rules/rules.md`。
2. 改符号前跑 GitNexus `impact({target, direction:"upstream"})`；HIGH/CRITICAL 先报告。
3. 提交前跑 `detect_changes()`。
4. **不要重开已完成的活**（§1 里 ✅ 的项）。要动先读对应 commit。
5. 每个任务完成必须写：改了哪些文件、验证命令与结果、剩余风险、是否需要 UI 手测确认。
6. 拿不准的产品决策 → 不猜，写进 §4 待裁决，跳过该项继续做别的。
7. 工具链：`npm run setup` → `node scripts/run-task.mjs <task>`；Go：`powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/..."`。
8. UI 验证走 CDP：`node scripts/inspect-electron-ui.mjs state|elements|style|click|screenshot`（应用需 `--remote-debugging-port=9222`）。
9. 禁止两个 lane 改同一文件；同域任务串行。

---

## 3. 剩余可执行任务（Trellis 未覆盖 / 需补完）

### G1 · [P1] WidgetsBar 悬浮 Agent widget 弹窗"慢一拍"

**现状（已核实）**
- `frontend/app/workspace/widgets.tsx:112` `WidgetHoverOpenDelayMs = 500`，`handleWidgetHover` 用 `setTimeout(500)` 开弹窗。
- 弹窗首次打开时 `AgentTargetPopup` 内 cc-switch vendors 懒加载（`widgets.tsx:1932`）与 `agentProfileOptions` 计算，首次额外卡。

**方案**
1. `WidgetHoverOpenDelayMs` 从 500 降到 **120–180ms**（hover-intent 业界常用 100–200ms）。
2. 预加载：`cc-switch vendors` / `agentProfileOptions` 在 WidgetsBar 挂载后 idle 预热，而不是打开弹窗时才算。
3. 确认 open 时无同步重计算（`moveDefaultTargetFirst` 等走 `useMemo`，依赖稳定）。
4. 保留"离开即取消"逻辑。

**验收**
- 悬浮 150ms 内出现弹窗；快速划过多项不误开。
- 首次与第二次打开延迟差 < 50ms。

---

### G2 · [P1] Tab 组右上角 "+" 悬浮 Agent 项，二级弹窗"慢一拍"

**现状（已核实）**
- `frontend/app/block/inlinetab-addmenu.tsx:20` `ItemHoverOpenDelayMs = 500`（同款问题）。
- 二级弹窗走 `requestLaunchPopup`（`launch-popup-bus.ts`）→ `widgets.tsx` `subscribeLaunchPopup` → `openAgentTargetsAt`，多一层事件总线 + `useEffect` setState，比直接调用多一帧。
- `makeFrozenAnchor` 在打开时测 `getBoundingClientRect()`，打开瞬间有一次布局测量。

**方案**
1. `ItemHoverOpenDelayMs` 与 G1 一起降到同值（**抽共享常量**，避免再次不一致）。
2. 消除总线往返的一帧：`launch-popup-bus` 改为注册表模式（`requestLaunchPopup` 同步调用注册回调），或 `useSyncExternalStore`，避免 `useEffect` 延迟。
3. 预计算：`getLaunchCreatableTargets(...)` + `moveDefaultTargetFirst` 在 hover 开始时算好，timer 触发只 setState。
4. `makeFrozenAnchor` 的 rect 在 hover 开始时测一次。

**验收**
- "+" 菜单悬浮 Agent 项，二级弹窗 150ms 内出现；快速划过不误开、不残留。

---

### G3 · [P1] txt 内部预览 — 先实测再修

**现状**
- `preview-text-modes.ts:51` 已定义 `PlainTextExtensions = {txt,text,log}`、`PlainTextMimeTypes = {text/plain}`。
- `preview-open.ts` `canPreviewFileInfo` 里 `text/*` 理论上已覆盖 `.txt`。
- 但用户反馈"似乎不支持"，需先定位真实原因。

**排查步骤（先诊断，不要直接改）**
1. CDP 打开一个 `.txt`，读 `fileMimeType`：若为 `""` / `application/octet-stream` → mimetype 探测问题。
2. 看 `openPreviewEntry` 是否走了 `getApi().openNativePath`（说明 `canPreviewFileInfo` 返回 false）。
3. 检查 `pkg/` 侧 stat/mime 来源。

**修复方向**
- mimetype 空/`octet-stream` 时，对已知文本扩展名白名单（`.txt .log .ini .conf .env .gitignore`）兜底 `canPreviewFileInfo = true`。
- 补 `preview-open.test.ts` 用例（`.txt` / `.log` / `.env`）。

**验收**
- 双击 `.txt` → 在 Snorkeling 内部文本视图打开，不走系统应用。

> 注意：本任务与 Trellis `10-19-preview-txt-html-modes` 同域，**执行前先看该任务是否已覆盖**，避免重复。

---

### G4 · [P0] 接口超时细项（Detail / Note / Tag）— 补 full-load 设计里未落地部分

**现状（已核实）**
- HTTP 硬超时：`pkg/web/web.go` `HttpTimeoutDuration = 21s`，`/wave/` 包在 `http.TimeoutHandler` → 超 21s 直接 `Timeout`。
- Detail 慢根因链：`resolveSession` 未命中走 `ScanSummaries` 全量扫描（`manager.go:955`）；`loadMessages` 解析整份 JSONL；`IncludeTools:true` **再解析一遍**取 toolCalls（同文件读两次）；前端 `refresh=true` 强制绕 SQLite 缓存。
- Note/Tag 慢根因：`managerForIdentifier` 每次 `NewManager`，且 `Note` 内部仍 `resolveSession`。

**方案（按性价比）**
1. **Note/Tag 走轻路径（收益最大）**：新增 `Manager.SetNoteByKey(key)` 直接用 `key` 定位 meta/sqlite 行，**跳过 `resolveSession`**（key 已含 source+id）。
2. 一次读盘：messages 与 toolCalls 共用一次文件读取/解析。
3. 前端"点选列表项"时 `loadDetail(..., refresh=false)`；`refresh=true` 只留给显式刷新。逐点核对 `aisessions.tsx` / `session-detail.tsx` 的 `loadDetail(..., true)`。
4. 超时可配置：`HttpTimeoutDuration` 支持 `settings.json` 覆盖（默认仍 21s，允许调到 60s）。
5. 前端写 Note/Tag 乐观更新 + 确认已有 debounce（`session-note-autosave.ts`），失败回滚。
6. `ScanSummaries` 后台预热一次，避免首次点会话触发全量扫描。

**必须避免**
- 不删 `TimeoutHandler`（会挂死连接）；不加无限重试掩盖超时。

**验收**
- 冷启动首次打开 ~10–20MB 会话，Detail 5s 内返回（改前可复现 21s Timeout）。
- Note 保存 < 300ms 返回。
- 采集改前/改后耗时（Go 已有 `debugf("Manager.Load success ... duration=")`）。

---

### G5 · [P2] full-load 剩余渲染优化（若 full-load 任务尚未做完）

> full-load 已在做协议层（分帧加载）。若夜间该任务已覆盖以下项则跳过；否则补：

- 虚拟列表：`@tanstack/react-virtual`（参考 `frontend/app/treeview/treeview.tsx` 的 `useVirtualizer`）。
- 懒渲染重内容：超长 assistant 默认折叠、thinking 默认收起、`WaveStreamdown` 仅展开时挂载。
- 渐进式 setState：每帧一次渲染，不攒齐再渲染。
- "跳到最早/最新"入口。

**性能判断（回答用户"Load all 会不会影响性能"）**
- 数据已在内存，成本在渲染 `MessageCard × N`。1000 条会话一次全渲染会明显掉帧。
- 结论：**全量取回 + 虚拟列表** 是正解；不要把"无虚拟化的大列表"直接铺开。

---

## 4. 待用户裁决

| ID | 问题 | 影响 | 建议默认 |
|---|---|---|---|
| D1 | 「报错的脚本/工具执行删除/撤回」：Trellis `annotate` PRD 已写「不做删除/软删，用户已决定搁置」。是否**维持搁置**（只做标注），还是要恢复删除/撤回需求？（若恢复，需明确是 Scheduled Tasks 运行历史，还是会话内 tool call 的 UI 隐藏） | annotate / 新任务 | 维持搁置，只做标注；Scheduled Tasks 历史删除另立小任务 |
| D2 | G1/G2 的 hover 延迟降到 **150ms** 是否可接受？（当前 500ms 是刻意防误触） | G1 / G2 | 150ms + 离开即取消 |
| D3 | G4 的 `HttpTimeoutDuration` 是否允许提到 60s？ | G4 | 默认 21s，可配置到 60s |
| D4 | full-load 的「Load all」是**打开即自动全量**（当前实现），还是保留一个显式按钮？（PRD 要求有 Load all 入口，当前实现是自动续帧） | full-load | 保留自动全量 + 提供手动"刷新全部"兜底 |

---

## 5. 夜间执行顺序建议

1. **P0**：G4（先做 1、2 两条细项，独立性强、收益最大）。
2. **P1 并行**：G1、G2（不同文件，可并行）；G3（preview 域，若与 preview 任务冲突则串行）。
3. **P1**：Trellis 里 in_progress 的 `full-load` / `refresh-icon` / `preview-txt-html-modes` 收尾（先读 PRD 与已有 commit，只补差）。
4. **P2**：G5（full-load 渲染优化，以 Trellis 为准）。
5. **等裁决**：D1 相关；Trellis `block-separation`（Wave 3，改动最大）。
6. 每批完成跑：`npm run build:dev` + 相关 `vitest` + `go test ./pkg/aisessions ./pkg/service/aisessionsservice ./pkg/scheduler`。

---

## 附：本文件与 Trellis 的分工

- **Trellis = 权威任务系统**：交互/默认值/验收标准以 PRD 为准。
- **本文件 = 对账 + 缺口清单**：只列 Trellis 未覆盖的（G1–G5）与需裁决项（D1–D4）。
- 若本文件与 Trellis PRD 冲突，**以 PRD 为准**，并在 §4 记录冲突。