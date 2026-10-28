# Agent 人格化：emoji 头像与两级作用域

## Background

Agent 类 Block 目前在所有显示面都用「厂牌 Logo」表达身份：`frontend/app/view/term/agent-logo.tsx` 的
`getAgentLogoByProvider()`（codex/claude/gemini/opencode/pi → React 图标 + iconColor）。

盘点后共 **9 个显示面**，其中 4 处各自复制了一份 provider→icon 映射：

| # | 位置 | 现状 |
|---|---|---|
| A | `view/term/term-model.ts` `viewIcon` | Block 头部图标（主入口，无线索可点） |
| B | `block/block.tsx:262` | inline tab 图标 |
| C | `tab/tab-info-card.tsx:72` | Tab 信息卡 agent 行 |
| D | `view/term/agent-hover-card.tsx:93` | Hover 卡片头部 |
| E | `session-overview/session-overview.tsx:1746` | Session Overview 列表 |
| F | `view/aisessions/sources.tsx:6-10` | 来源筛选 chip（**独立映射**） |
| G | `view/aisessions/session-row.tsx:444` | 会话行 —— 当前只有 `1.5px` 色点 + `session.source` 文本，**无 Logo** |
| H | `workspace/widgets.tsx:574` | 右栏 widget 启动目标（**独立映射** + `AgentProfileColors`） |
| I | `modals/agenthooksettingsmodal.tsx:43` | agent hook 设置 provider 列表（**独立映射**） |

关键约束：aisessions 的会话是**磁盘扫描出的历史会话**（`codex` / `claude` / `pi` / `opencode` 的
session 文件），没有 `blockId`，也没有 block meta。因此**只有 provider 级人格才能覆盖过去**。

## Goals

- 点击 agent 图标可弹出 emoji picker，把该 agent 的显示头像从品牌 Logo 换成任意 emoji。
- 两级作用域：provider 级（全局，覆盖全部 9 个面，包括 aisessions 历史会话）+ block 级（仅覆盖该 block 的 A–E 面）。
- 一次收敛：把 4 份重复的 provider→icon 映射合并为单一 registry，任何显示面都从同一函数取图标。
- 全部行为可逆：清除 emoji 后精确回到品牌 Logo，旧 block / 旧 workspace 行为零变化。

## Non-Goals

- 不做自定义图片 / 颜色 / 昵称 / 头像上传，只支持单个 emoji。
- 不改 `agent:provider` 的识别逻辑，不改 `pkg/blockcontroller/shellcontroller.go` 的 meta 语义。
- 不引入 `wconfig` / Go 侧新配置项（MVP 阶段；见 design.md 的 Phase 2 升级路径）。
- 不改 aisessions 的扫描 / 存储 / 后端接口。
- 不为 emoji 单独做设置页（入口只在图标点击与右键菜单）。

## Requirements

### R1 统一 registry

- R1.1 `view/term/agent-logo.tsx` 升级为 agent-icon registry，导出
  `getAgentIcon(provider, opts)`，返回 `{ kind: "emoji", emoji }` / `{ kind: "provider", icon, iconColor? }` / `null`。
- R1.2 保留 `getAgentLogoByProvider()` 作为兼容包装（现有测试与调用点可渐进迁移）。
- R1.3 F/H/I 三处本地映射删除，改为调用 registry；H 的 `AgentProfileColors` 在有人格时跳过。
- R1.4 解析优先级固定为：`block meta "agent:emoji"` → provider persona → 品牌 Logo → `null`。

### R2 provider 级人格（L1）

- R2.1 新增 persona store（`app/agent-persona/persona-store.ts`），localStorage key
  `snorkeling:agent-personas`，值形如 `{ "claude": "🦊", "codex": "🐙" }`。
- R2.2 支持跨窗口 / 跨 surface 同步（监听 `storage` 事件），模式对齐
  `app/agent-status/agent-status-done-ack-store.ts`。
- R2.3 写入后 aisessions 的来源 chip（F）与会话行（G）、右栏 widget（H）、hook 设置（I）**无需逻辑改动**即跟随。

### R3 block 级人格（L2）

- R3.1 通过 `RpcApi.SetMetaCommand(TabRpcClient, { oref: makeORef("block", id), meta: { "agent:emoji": emoji } })`
  写 block meta；清除传 `null`（与 `BlockLockMetaKey` 同写法）。
- R3.2 仅影响该 block 的 A–E 五个面。
- R3.3 该 block 若同时存在 provider persona，block 级优先。

### R4 交互

- R4.1 点击 Block 头部 agent 图标（A）打开 picker；`title` 提示「点击设置 emoji 人格」。
- R4.2 picker 复用 `element/block-editor/components/emoji-picker.tsx` 的 `EmojiPicker`
  （搜索 + 分组 + 最近使用，数据来自 `loadEmojiCatalog()` / `getRecentEmojis()`）。
- R4.3 picker 底部提供作用域单选：`仅此会话`（默认）/ `所有 <Provider> 会话` / `恢复默认 Logo`。
- R4.4 `Ctrl/Cmd+Z`? 否。关闭方式：`Esc`、点击外部、再次点击图标。
- R4.5 inline tab（B）右键菜单增加「设置 emoji 人格」项，作为第二入口。

### R5 渲染与布局

- R5.1 emoji 使用定宽定高 `<span className="agent-emoji-icon">`：`font-size:13px; line-height:1;
  inline-flex; align-items:center; justify-content:center;`，**禁止撑宽**。
- R5.2 emoji 自带颜色，不套 `iconColor`。
- R5.3 aisessions 会话行（G）：有人格时 emoji 顶替色点，`session.source` 文本保留；无人格时保持现状。
- R5.4 非法值（多 grapheme、空白、超长）在 registry 内丢弃并回退品牌 Logo。

### R6 契约与校验

- R6.1 meta key 常量唯一来源：`AgentEmojiMetaKey = "agent:emoji"`。
- R6.2 emoji 合法判定用 `Intl.Segmenter`（`granularity: "grapheme"`）取首个 grapheme，原值必须与之全等。
- R6.3 `nil` / `""` / 非 string 一律视为未设置。

## Acceptance Criteria

- AC1 点击 Block 头部 agent 图标 → picker 打开并锚定在图标附近；选 emoji 后该 block 的
  A/B/C/D/E 五处同帧变为该 emoji。
- AC2 选择「所有 Claude 会话」后，aisessions 来源 chip（F）显示 emoji、会话行（G）用 emoji 顶替色点、
  右栏 widget（H）与 hook 设置（I）同步显示；刷新应用后仍保持。
- AC3 选择「恢复默认 Logo」后，全部 9 个面回到品牌 Logo，且 localStorage 对应 key 被清除（非空对象残留）。
- AC4 provider 未知但 agent-like 的 block 也能设置 emoji（registry 对 `null` provider Logo 仍允许 emoji 优先）。
- AC5 tab 宽度、inline tab 跑马灯触发阈值、aisessions 虚拟滚动行高在有人格时与无人格时**逐像素一致**
  （用 `design/prototypes` 或 CDP 截图对比验证）。
- AC6 `pnpm/npm test -- agent-logo` 全绿；新增测试覆盖优先级链、非法值、删除回退。
- AC7 `getAgentLogoByProvider` 的现有调用点全部迁移完成，`grep -rn "ClaudeLogo\|OpenAILogo\|GeminiLogo\|OpencodeLogo\|PiLogo" frontend/`
  只剩 `view/aisessions/controls.tsx`（定义处）与 `agent-logo.tsx`（registry）两处引用。

## Open Decisions（已按推荐值记录，可随时推翻）

| # | 决策 | 取值 | 理由 |
|---|---|---|---|
| D1 | L1 存储 | localStorage（非 wconfig） | MVP 纯前端；aisessions 也是前端渲染，同样生效；跨机器同步留 Phase 2 |
| D2 | aisessions 会话行 | emoji 顶替色点 | 避免一行两个来源标记；`session.source` 文本仍在，语义不丢 |
| D3 | picker 作用域默认值 | 「仅此会话」 | 防止误把单次实验扩散到全部历史会话 |
