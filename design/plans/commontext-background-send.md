# Common Text 后台静默发送（不跳转 Tab）— 设计

> 状态：▲ 设计活跃（未实现）
> 镜像源：`frontend/app/commontext/commontext-send-button.tsx`、`frontend/app/commontext/pending-input.ts`、`frontend/app/view/term/term.tsx`、`frontend/app/workspace/workspace.tsx`
> 对应原型：`design/prototypes/commontext/commontext-send-agent-block/`（Send 目标选择器原型，本设计是其「发送落点」分支的延伸）
> 日期：2026-11-12

---

## 0. 问题与目标

Common Text 的 Send 目前只支持「跳转发送」：目标不是聚焦块时，发送后必然切到目标 Tab（已存在 Tab 或新 Tab）。用户希望可以**后台默默处理**：Tab 不动，agent 在后台收到文本并开始工作。

目标：

1. Send 弹窗的 Type（Tab）选择保持不变，新增一个「后台发送」开关（或按住修饰键点击发送，交互待定，见 §8）。
2. 后台发送后 `activeTab` 不变、键盘焦点不变、无任何视觉跳转。
3. 文本仍走 `pending-input` 队列语义（TUI 就绪后注入 + 回车提交），且**不允许静默丢失**。

非目标：

- 不改 Send 目标解析逻辑（`commontext-send-target.ts` 的 existing/create 判定原样保留）。
- 不做「发送进度面板」等新 UI 面（只做轻量提示条，见 §4.4）。
- 不支持后台发送到 GUI 聊天块（`view=agent`），与现状一致。

## 1. 现状：为什么必然跳转

`frontend/app/commontext/commontext-send-button.tsx` 的 `executeCommonTextSend`（create 分支）：

- 已存在 Tab：`ObjectService.CreateBlockInTab(targetTabId, blockDef, opts, **true**, false)` 后又显式 `getApi().setActiveTab(targetTabId)`（L236-237）。
- 新 Tab：`CreateBlockInNewTab(...)` 后显式 `setActiveTab(result.tabid)`（L243-251）。

后端能力是现成的：`CreateBlockInTab` 第 4 参就是 `activateTargetTab bool`（`pkg/service/objectservice/objectservice.go:126`），现在硬编码 `true`。新 Tab 路径的 `CreateEmptyTab(..., activateTab=false)` 本身不激活，跳转全部来自前端这两行 `setActiveTab`。

「跳转」同时也是**让块被挂载的手段**，这是本设计要拆开的两件事：

- 块在后端创建成功，PTY 由后端拉起，与前端挂载无关。
- 但文本注入走 `termWrap.terminal.paste`，需要 TermWrap 挂载（`commontext-insert.ts:insertTextIntoTerm`）。
- 工作区只为最多 3 个 Tab 挂载内容（`PreloadTabCap = 3`，MRU + 悬浮驱动，`workspace.tsx:70-90`），未挂载 Tab 里的块没有 TermWrap，`term.tsx:564-621` 的 pending-input 轮询 effect 不会跑。

关键安全网（本设计能成立的地基）：`CreateBlockInTab` 对前端树的改动只走 `LayoutState.PendingBackendActions` 队列（`pkg/wcore/layout.go:97-115`），由前端 layoutModel 挂载时消费（`layoutModel.ts:402/412/416`）。**后台建块不会因为挂载晚到而丢失**——这是现成设计，不是本设计要新造的。

## 2. 方案选型

| 方案 | 做法 | 结论 |
|---|---|---|
| **A. 借用预挂载（推荐）** | 后台发送时把目标 Tab 钉进挂载集合（`visibility:hidden` 保活机制已存在），注入完成后取消钉住 | ✅ 注入链路一行不改；缺点见 §3 |
| B. 绕开 xterm 注入 | 直接 `RpcApi.ControllerInputCommand` 写 PTY（bracketed paste 序列 + `\r`） | ❌ 「TUI 就绪」判定要换数据源（现在依赖 `termWrap.lastUpdated`），需后端新增输出信号；改动面跨前后端 |
| C. 只做半套 | 目标 Tab 已挂载才后台发，否则照旧跳转 | ❌ 「有时跳有时不跳」的分裂体验，且用户无法预测 |

## 3. 方案 A 的风险清单（全部实测代码得出）

| # | 风险 | 根因 | 处理 |
|---|---|---|---|
| R1 | 钉住的 Tab 被用户切 Tab 挤出挂载集合 → TermWrap 卸载 → 轮询 effect cleanup → 文本卡在队列 60s 后**静默回退剪贴板** | `preloadTabIds` 是 MRU 驱动 + `slice(0, 3)`（`workspace.tsx:73-90`）；重新挂载后 baseline 重新取，若 agent TUI 已静默则永远 `wait` 到 TTL | §4.1 独立钉子集合 |
| R2 | 挤占「防闪黑」预挂载名额 → 用户常切 Tab 更易黑屏 | `PreloadTabCap = 3` 的存在目的就是防切 Tab 黑屏（`workspace.tsx:66-68` 注释） | §4.1 钉子不占 MRU 名额 |
| R3 | 挂载成本是整棵 Tab 树（含其他块、多个 xterm/WebGL context） | `TabContent` 挂载即整树渲染 | §4.5 并发上限 1 |
| R4 | 注册/挂载竞态：`term.tsx:570` 的 `peekPendingInput == null` 早退 + deps 只有 `[termWrapInst, blockId]`（L621）。若 TermWrap 先就位、`registerPendingInput`（send-button L253）后到，effect **永不重跑**，文本永久卡住且**连 TTL 都没人查**（无轮询者）。方案 A 提前触发挂载，放大此窗口 | 现存隐患，非本设计引入 | §4.2 必修 |
| R5 | 用户看不见发送结果 → 怀疑失败而重发（双发） | 跳转本身就是「已发送」的强反馈 | §4.4 提示条 |
| R6 | 60s TTL 天花板：agent 冷启动超时 → 回退剪贴板 | `DefaultPendingInputTtlMs = 60_000`（`pending-input.ts`） | 接受 + 提示条明示；不放宽 TTL |
| R7 | 注入成功 ≠ agent 接受（TUI 卡在权限弹窗等） | 同现状 | 提示条带「切过去看看」入口 |

已排除的风险：挂载隐藏 Tab **不会**抢键盘/布局焦点——`termModeRef` 初始值即 `termMode`，首挂载不触发 `giveFocus`（`term.tsx:632-639`）；`layoutModel.focusNode` 只改树状态。

## 4. 设计

### 4.1 钉子集合（修 R1/R2）

`workspace.tsx` 新增模块级状态：

- `pinnedTabIds: Set<string>`（或 jotai atom），存「因后台发送而钉住」的 Tab。
- `renderTabIds = 去重合并([activeTabId, ...preloadTabIds(cap 3), ...pinnedTabIds])`。渲染循环改用它；`PreloadTabCap` 的 slice 只作用于 MRU 列表，钉子集合**不限量参与合并**。
- MRU 挤出逻辑原样不动——钉子集合不被 slice。

约束：`pinnedTabIds` 不设数量上限，但同一时刻最多 1 个钉子（§4.5），所以实际占用 ≤ 1。

### 4.2 竞态修复（修 R4，必修）

`pending-input.ts` 的 registry 改为带版本号的通知源：

- 新增 jotai atom `pendingInputVersionAtom`（初始 0），`registerPendingInput` / `takePendingInput` 时 `globalStore.set(…, v + 1)`。
- `term.tsx:621` 的 effect deps 改为 `[termWrapInst, blockId, pendingInputVersion]`（用 `useAtomValue` 订阅）。
- 早退条件不变：`termWrapInst == null` 仍早退；`peek == null` 早退后，后续 register 会 bump 版本令 effect 重跑。挂载早于注册的情况由此闭合。

这是纯加法改动，同时修掉现存于「当前 Tab 路径」的同款隐患。

### 4.3 发送流程（改 `executeCommonTextSend`）

```
后台发送（existing Tab）:
  1. pinTab(targetTabId)                     → Tab 隐藏挂载（不切 activeTab）
  2. CreateBlockInTab(tabId, def, opts, false, false)   // activateTargetTab 改传 false
  3. registerPendingInput(blockId, text)      // 竞态已由 §4.2 闭合
  4. toast: 「已后台发送到 Tab “X” · <agent>，就绪后注入」

后台发送（new Tab）:
  1. CreateBlockInNewTab(...)（后端本就不激活新 Tab）
  2. pinTab(result.tabid)
  3-4 同上
```

显式跳转的两行 `getApi().setActiveTab(...)`（L237 / L251）在后台模式下删除（普通模式保留，行为不变）。

### 4.4 提示条（修 R5/R7）

发送后右下角（或 compose 弹窗原位）出现轻量 toast，三态：

- 排队中：「已发送到 “Tab X” · claude · 等待 TUI 就绪」+「切过去看看」按钮（点击 = `setActiveTab` + `unpin`）。
- 成功：监听现有 `snorkeling:pending-input-injected` 事件（`term.tsx` 已派发）→「已注入 ✓」，数秒后自消。
- 超时：监听 `snorkeling:pending-input-fallback` →「60s 未就绪，已复制到剪贴板」+ 保留「切过去看看」。

### 4.5 并发上限（修 R3）

同一时刻只允许 1 个后台发送在途：第二个后台发送请求若已有 in-flight 钉子，直接降级为普通跳转发送，并在 toast 说明。避免 N 个 Tab 同时挂载（N 个 xterm/WebGL context，浏览器 WebGL context 硬上限 ~16）。

### 4.6 生命周期（修 R4 之外的收尾）

`unpinTab(tabId)` 在三种路径都必须执行：

1. `pending-input-injected` 事件（注入完成）。
2. `pending-input-fallback` 事件（TTL 超时）。
3. 兜底定时器：`DefaultPendingInputTtlMs + 5s` 后强制 unpin（防事件丢失导致钉子泄漏）。

注入完成后立即 unpin 即可：文本已写入 PTY，TermWrap 卸载不影响 agent 工作；重新挂载由 `PendingBackendActions` / 重放机制覆盖。

## 5. 涉及文件

| 文件 | 改动 |
|---|---|
| `frontend/app/commontext/commontext-send-button.tsx` | 后台模式分支；`activateTargetTab=false`；删两行 `setActiveTab`；pin/unpin 编排 |
| `frontend/app/commontext/pending-input.ts` | 版本号通知源（`pendingInputVersionAtom`） |
| `frontend/app/view/term/term.tsx` | L621 deps 加版本号（一行） |
| `frontend/app/workspace/workspace.tsx` | `pinnedTabIds` 集合 + `renderTabIds` 合并 |
| 新 `frontend/app/commontext/commontext-send-toast.tsx` | 三态提示条（复用现有 toast 基建，若有则挂接） |

## 6. 成功判据（可机器判定）

| # | 判据 | 验证方式 |
|---|---|---|
| S1 | 后台发送到已存在 Tab：`activeTab` 不变，30s 内收到 `snorkeling:pending-input-injected` 事件且 blockId 匹配 | 扩展 `scripts/verify/commontext-send-agent-block` |
| S2 | 后台发送后连续切 4 个 Tab（把 MRU 全部换血），注入仍不丢（钉子不被挤出） | 同上，发送后程序化切换 Tab |
| S3 | 后台发送 → 注册晚于挂载（人为延迟 `registerPendingInput` 100ms）仍能注入（R4 闭合） | vitest：bump 版本触发 effect 重跑的单测 |
| S4 | 提示条三态（排队/成功/超时）各有一帧真机截图；「切过去看看」点击后 `activeTab` = 目标 Tab 且钉子清空 | 真机 verify |
| S5 | 普通模式（不勾后台）行为与现状完全一致：仍跳转 + 注入 | 回归断言（现有 verify 用例不改动应全绿） |
| S6 | TTL 超时路径：unpin 兜底定时器触发后 `pinnedTabIds` 为空（无钉子泄漏） | vitest（注入伪时钟） |

## 7. 剩余风险（明示不做）

- R6：agent 冷启动 > 60s 仍回退剪贴板（有 toast，不静默；不放宽 TTL——放宽会把「真的死了」也拖到更晚才暴露）。
- R7：注入成功但 agent 卡在权限弹窗，回车落在它界面上——与跳转发送同病，靠「切过去看看」兜底。
- 后台发送期间用户手动关掉目标 Tab：块随 Tab 删除，注入目标消失 → TTL 兜底 + toast 超时态。

## 8. 未决问题（实现前需拍板）

1. 交互入口：Send 弹窗 Type 行加「后台」开关 vs 主按钮长按/修饰键 vs 面板里第四项「后台静默」目标模式？倾向**目标模式三选一**（聚焦块 / 新建 / 后台新建），与现有 chip 语言一致。
2. toast 是否复用现有组件基建（需查证）。
3. 「已存在 Tab」后台发送时，块插入位置：目标 Tab 布局满/有 magnified 块时 Insert 动作的行为需要实测确认（`PendingBackendActions` 会照常入队，但应用时机依赖挂载）。
