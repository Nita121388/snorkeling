# AI 会话与 Agent TUI 文本选中及上下文复制

## Goal

在 Session Detail（`view: aisessions` / `view: agent`）与 Agent TUI（`view: term` 里跑 claude / codex / pi）中，用户能自由选中文字并复制；并且通过 💡 选区快捷菜单里的 **Copy Context**，把「这段话 + 它来自哪」一次性复制成可直接粘给 agent 的上下文块，省掉手工拼来源的步骤。

## 现状（已核查的事实）

- 💡 浮层是 **app 级全局组件**：`frontend/app/app.tsx:447` 挂 `<ClipboardFloatActions />`，它监听 `document` 的 `selectionchange` / `mouseup` / `keyup`（`frontend/app/element/clipboard-float-actions.tsx:139-190`），任何 DOM 选区都会浮出 💡 按钮。**Session Detail 的选区已经能出 💡，不需要新造浮层。**
- 💡 菜单由 `makeSelectionQuickActionMenu()`（`frontend/app/element/selection-copy-overlay.tsx:119`）构造，固定项是 `Copy` / `Search In Files` / `Add Selection to Common Text` / `Find Related Common Text`，另有 `copyMenuItems` 与 `extraMenuItems` 两个注入槽。
- 已有 `Copy Context` 菜单项实现：`makeCopyContextMenuItem(contextText, onCopied)`（`selection-copy-overlay.tsx:82`）。它只在 `copyMenuItems` 里被传进去，来源是 `getCopyContextTextFromDom()`（`selection-copy-overlay.tsx:47`）—— 而该函数**只认**祖先元素上的 `data-copy-context-path` + `data-source-line`，即 markdown / preview / 表格这类**带文件路径与源码行号**的渲染面。Session Detail 与终端都没有这两个属性，所以永远拿不到 Copy Context。
- 右键菜单同样分支：`frontend/app/app.tsx:121-140`，`copyContextText` 非空才 push Copy Context。
- 终端（xterm）**不走** document selection。它有自己的选区通道：`TerminalView` 里 `termWrap.onSelectionTextChange`（`frontend/app/view/term/term.tsx:452`）→ 本地 `selectionCopyOverlay` state → 渲染 `<SelectionCopyOverlay copyMenuItems={terminalCopyMenuItems}>`（`term.tsx:850`）。当前注入项为 `Copy Logical Line` / `Copy Selection as One Line`。
- 终端在 TUI 开启鼠标上报时能否拖选，取决于 xterm 的 `shouldForceSelection`：**非 macOS 走 `e.shiftKey`，macOS 走 `option+click`**（`node_modules/@xterm/xterm/lib/xterm.js`）。所以 Windows 上 Shift+拖选本来就能选；plain drag 被 `handleTermMouseDownCapture` 交给 TUI（`term.tsx:634`，`shouldRoutePlainTermGesture` 目前只对 `darwin` 返回 true）。
- Session Detail 时间线超过 60 行走虚拟化（`timeline-virtual.ts:22` `VirtualizeThreshold`），只渲染视口 ±6 行。
- composer 的输入文本 `input` 是 `ChatComposerInner` 的内部 state（`chat-composer.tsx:140`），外部没有 setter，也没有事件通道。现有跨组件事件范例是 `frontend/app/view/aisessions/session-note-events.ts`。

## 核心判断

**不新造浮层、不新造菜单体系**。现有 💡 管线已经具备 Copy Context 能力，缺的是「Session Detail / 终端这一侧没有把自己的来源信息暴露给菜单」。因此本任务的主干是**建立一套通用的上下文标注契约 + 格式化器**，让既有管线自动长出 Copy Context，而不是各页面各写一套。

## Requirements

### R1 上下文标注契约（跨子任务的地基）

- R1.1 引入统一 DOM 标注：`data-copy-context-kind`（枚举 `aisession` / `agentterm`）+ `data-copy-context-meta`（JSON 字符串）。已有的 `data-copy-context-path` + `data-source-line` 路径**保持不变**，作为降级分支。
- R1.2 `getCopyContextTextFromDom()` 优先解析新契约，取不到再走原有 path/line 分支。**调用点不改**（`app.tsx:121`、`clipboard-float-actions.tsx:164` 继续原样调用），这样 Session Detail 的 💡 与右键菜单同时自动获得 Copy Context。
- R1.3 格式化逻辑放独立纯函数模块，不依赖 React / DOM / jotai，可直接单测。

### R2 Copy Context 输出格式（必须逐字段实现，不得自行增删）

Session Detail（定位字段在前，正文在后）：

```
<context>
session: <summary.title || summary.id>
session-id: <summary.id>
source: <summary.source>
model: <message.model>              # 缺省则整行不输出
project: <summary.projectPath>      # 缺省则整行不输出
session-file: <summary.filePath>    # 缺省则整行不输出；agent 定位会话文件的最强依据
created: <summary.createdAt>        # 缺省则整行不输出
updated: <summary.updatedAt>        # 缺省则整行不输出
parent-session: <summary.parentKey> # 仅子会话，缺省则整行不输出
message-seq: <seq | seqStart-seqEnd>
messages-referenced: <覆盖消息条数>   # 仅在覆盖到消息时输出
session-messages: <summary.messageCount>  # 缺省则整行不输出
entry-id: <message.entryId>         # 仅单条消息且存在时输出
item-key: <message.itemKey>         # 仅单条消息且存在时输出
role: <role>                        # 跨多条消息且角色混合时整行不输出
time: <YYYY-MM-DD HH:mm:ss>         # 覆盖区间的起始消息时间
time-end: <...>                     # 仅跨多条消息时输出
tool: <toolCall.name>               # 仅选区落在工具卡时输出
tool-exit: <exitCode>               # 仅非 0 时输出
</context>

<正文>
```

- R2.1 覆盖单条消息时，正文取**实际选区文本**（尊重部分选中），不做整条替换。
- R2.2 覆盖多条消息时，正文按消息顺序拼接，每条前置 `**<role>:**` 标签行，消息之间空一行；正文取**完整消息文本**，不取残缺的 DOM 片段。
- R2.3 正文超过 8000 字符时截断，并在末尾追加 `\n\n… (truncated, N chars omitted)`，`N` 为省略的字符数。
- R2.4 内部字段值做最小转义：值内换行替换为空格；`project` / `session-file` 反斜杠原样保留（仅提示用途，不改写路径语义）。
- R2.5 定位字段（`session-file` / `created` / `updated` / `parent-session` / `messages-referenced` / `session-messages` / `entry-id` / `item-key`）是「让 agent 一次定位到」的核心，不得为精简而删除。

Agent TUI：

```
<context>
block: <blockId>
agent: <agent provider | "">    # 取不到整行不输出
cwd: <meta["cmd:cwd"]>          # 缺省整行不输出
connection: <meta["term:connection"] | "local">
selected-lines: <startLine>-<endLine>
lines: <选中行数>               # selected-lines 存在时输出
</context>

```
<选中文本>
```
```

- R2.5 `selected-lines` 用**缓冲区绝对行号**（`viewportY` 不参与，须加 `baseY` 折算），单行时输出 `N-N`。
- R2.6 选中文本放入三反引号围栏；文本自身含 ``` 时升级为四反引号。
- R2.7 Session Detail 的定位字段必须来自 `SessionSummary` / `Message` 的既有字段，不得为排版去后端新增 RPC。

### R3 入口（三个，共用同一格式）

- R3.1 💡 菜单 `Copy Context` — 只写剪贴板，成功后收起浮层（沿用 `onCopied` 反馈）。
- R3.2 💡 菜单 `Quote to Input` — 同一份文本插入当前会话的 composer 输入框，**不**写剪贴板。仅在选区位于 Session Detail 且该面板有 composer 时出现；Agent TUI 不提供（终端没有 composer）。
- R3.3 `MessageCard` 的 hover 复制按钮（`session-message.tsx:378` / `:405`）保留纯文本语义不变，**另加**一个「Copy as context」按钮，走同一格式化器。
- R3.4 三个入口产出的文本必须逐字节一致（同一纯函数）。

### R4 虚拟滚动下的跨屏选择

- R4.1 拖选跨越视口时，行会被虚拟化回收。Copy Context 的 `message-seq` 锚点**必须在 `selectionchange` 期间持续记录**最近一次已知的首/尾消息 seq，不依赖 `mouseup` 时刻的 DOM 是否仍在。
- R4.2 若首尾 seq 记录成功但覆盖范围不连续（中间有未渲染行），Copy Context 仍按 model 数据输出完整消息，不报错、不输出残缺文本。
- R4.3 不改变 ≤60 行会话的既有渲染与交互路径。

### R5 Agent TUI 选中可用性

- R5.1 先验证 Windows 下 Shift+拖选在 TUI 鼠标上报开启时确实生效（xterm `shouldForceSelection` 语义）。**验证通过则不新增任何机制**。
- R5.2 验证失败时才补「选择模式」：一个临时开关，开启期间不把 plain drag 转发给 PTY，只喂给 xterm 选区；关闭后恢复。开关状态不持久化。
- R5.3 无论 R5.1 结论如何，Copy Context 都要在 TUI 的 💡 菜单里可用。

## Acceptance Criteria

- [ ] Session Detail 选中一段 AI 回复 → 💡 菜单出现 `Copy Context`，粘贴内容包含 `<context>` 块与 R2 列出的全部可用字段，字段值正确。
- [ ] Session Detail 选中跨 3 条消息（含 user 与 assistant）→ `message-seq` 为 `a-b` 形式，`role` 行不出现，正文三条按序带角色标签。
- [ ] 选中工具卡内容 → 输出含 `tool`，退出码非 0 时含 `tool-exit`。
- [ ] 正文超过 8000 字符时出现截断后缀且字符数正确。
- [ ] 在 >60 条消息的会话里拖选跨越 2 屏 → Copy Context 输出的消息范围完整，无残缺、无报错。
- [ ] `Quote to Input` 把同一份文本插入 composer 光标处，光标落在插入文本末尾，未写入剪贴板。
- [ ] Agent TUI 选中终端输出 → 💡 菜单出现 `Copy Context`，`cwd` / `connection` / `selected-lines` 正确。
- [ ] 非会话区块（preview markdown / 代码预览）的 Copy Context 行为与改动前完全一致（不回归）。
- [ ] `data-copy-context-path` + `data-source-line` 旧路径的既有单测全绿。
- [ ] 新增纯函数模块单测覆盖：单消息、多消息、缺字段、超长截断、围栏升级、绝对行号折算。

## Constraints

- 不改 `makeSelectionQuickActionMenu` 的固定项顺序（已有任务依赖该顺序）。
- 不修改 `SelectionCopyOverlay` 的既有 props 语义；新能力通过 `copyMenuItems` / `extraMenuItems` 注入。
- 不引入新依赖。
- 不改动 `Search In Files` / `Common Text` 两个既有分支的行为。
- Copy Context 不发送任何网络请求，纯本地拼装。

## Out of Scope

- 把会话内容同步到 Common Text 库。
- 图片 / 附件复制。
- 跨会话（两个不同 session 之间）的上下文合并。
- 后端改动（本任务纯前端）。

## Task Map

| 子任务 | 交付物 |
|---|---|
| `10-24-aisessions-copy-context-builder` | 纯函数格式化器 + DOM 契约 + Session Detail 接入（R1 / R2 / R3.1 / R3.3 / R4） |
| `10-24-agent-tui-selection-copy-context` | 终端侧格式化 + 💡 注入 + 拖选可用性验证（R2 终端格式 / R5） |
| `10-24-aisessions-quote-to-composer` | 事件总线 + composer 插入（R3.2） |

依赖顺序：子任务 1 先做（它定义格式化器与契约，子任务 3 复用它产出文本）。子任务 2 与 3 之间无依赖，可并行。

## Cross-child Acceptance

- [ ] 子任务 1 与子任务 2 产出的 `<context>` 块结构一致（同一模块，同一测试套件断言）。
- [ ] 子任务 3 插入的文本与子任务 1 的 Copy Context 输出逐字节一致（共用同一函数，测试断言相等）。
- [ ] 三个入口在同一个会话里对同一选区产出一致内容。

## Notes

- 父任务不直接实现；实现落在三个子任务上。
- 父任务负责最终集成验收：三个入口一致性 + 旧路径零回归。
