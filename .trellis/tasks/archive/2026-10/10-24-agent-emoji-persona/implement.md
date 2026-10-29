# Implement: Agent 人格化（emoji 头像）

> 顺序即提交顺序。每一步都可独立回滚；S1–S3 是地基，S4 起才开始接显示面。

## S0 准备（不改代码）

- [ ] `git status` 干净；确认工作分支 `snorkeling`
- [ ] `grep -rn "getAgentLogoByProvider" frontend/` 记录当前 6 个调用点作为迁移清单
- [ ] `grep -rn "ClaudeLogo\|OpenAILogo\|GeminiLogo\|OpencodeLogo\|PiLogo" frontend/` 确认 4 处重复映射

**验证**：两条 grep 输出与 design.md §1 的表格一致。

---

## S1 地基：emoji 归一化 + registry（纯函数，无 UI）

文件：`frontend/app/view/term/agent-logo.tsx`

- [ ] 新增 `AgentEmojiMetaKey = "agent:emoji"`
- [ ] 新增 `AgentIconSpec` / `AgentIconOpts` 类型
- [ ] 新增 `normalizeAgentEmoji(raw)`（`Intl.Segmenter` 单 grapheme 严格校验）
- [ ] 新增 `getAgentIcon(provider, opts)`（优先级 meta → personas → logo）
- [ ] `getAgentLogoByProvider` 保留不动（兼容）

文件：`frontend/app/view/term/agent-logo.test.ts`（新建）

- [ ] `normalizeAgentEmoji` 正反例（含 `"🦊🦊"` / `"🦊\u200d"` / `"ab"` / `null` / `42`）
- [ ] 优先级链：meta 覆盖 persona，persona 覆盖 logo，全空回 `null`-logo 行为
- [ ] provider 未知 + block emoji → `{ kind: "emoji" }`

**验证**
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; npm test -- agent-logo"
```
**回滚点**：删除新文件 + revert `agent-logo.tsx`。

---

## S2 地基：persona store（L1，localStorage）

文件：`frontend/app/agent-persona/persona-store.ts`（新建）

- [ ] key `snorkeling:agent-personas`；`PersonaMap = Record<string, string>`
- [ ] `getAgentPersonaSnapshot()` / `subscribeAgentPersonas(cb)` / `setAgentPersona(provider, emoji|null)` / `clearAgentPersona`
- [ ] `storage` 事件同步（过滤 `event.key`）
- [ ] 坏 JSON / 非对象 → 回退 `{}`；空对象时不写 localStorage（不产生垃圾 key）
- [ ] `__resetForTests()`（与 `agent-status-done-ack-store.ts` 同套路）

文件：`frontend/app/agent-persona/persona-store.test.ts`（新建）

- [ ] 读写往返 / 清除 / 空对象不落盘 / storage 事件 / 坏 JSON

文件：`frontend/app/agent-persona/use-agent-personas.ts`（新建）

- [ ] `useAgentPersonas()`：`useSyncExternalStore(subscribeAgentPersonas, getAgentPersonaSnapshot)`
- [ ] 导出 `agentPersonaAtom`（jotai，供 `term-model` 这类非组件上下文用）

文件：`frontend/app/agent-persona/picker-host.ts` + `agent-emoji-picker-host.tsx`

- [ ] `openAgentEmojiPicker(blockId, provider, rect)` / `closeAgentEmojiPicker()`，`useSyncExternalStore` 快照
- [ ] `<AgentEmojiPickerHost />`：portal 挂载点，`null` 时不渲染任何东西

**验证**：`npm test -- agent-persona`

---

## S3 写入 UI：picker

文件：`frontend/app/view/term/agent-emoji-picker.tsx`（新建）

- [ ] `loadEmojiCatalog()` 异步加载 + loading skeleton（12 格）
- [ ] 复用 `element/block-editor/components/emoji-picker.tsx` 的 `EmojiPicker`（`mode="document"`）
- [ ] scope 单选：`block`（默认）/ `provider`；文案 `仅此会话` / `所有 <Provider> 会话`
- [ ] 选中 → block: `RpcApi.SetMetaCommand(..., meta: { [AgentEmojiMetaKey]: emoji })`
- [ ] 选中 → provider: `setAgentPersona(provider, emoji)`
- [ ] `allowRemove` → 按 scope `SetMetaCommand(..., null)` / `clearAgentPersona(provider)`
- [ ] `Esc` / 点外部 / 再次点图标 关闭
- [ ] 锚点翻转（靠近屏幕底部时向上弹）

- [ ] 在 `frontend/app/block/block.tsx`（app 根附近）挂 `<AgentEmojiPickerHost />` 一次

**验证**：`npm test -- agent-emoji-picker`

**回滚点**：S3 独立可回滚，不影响 S1/S2 已通过的能力。

---

## S4 接显示面 A–E（block 级）

- [ ] `view/term/term-model.ts` `viewIcon`：`getAgentIcon(provider, { meta: blockMeta, personas })`
  - emoji 分支 → `<span className="agent-emoji-icon">{emoji}</span>`
  - 两个分支都加 `click: (e) => openAgentEmojiPicker(blockId, provider, e.currentTarget.getBoundingClientRect())`
  - `title: "点击设置 emoji 人格"`
- [ ] `block/block.tsx:262` inline tab：`useAgentPersonas()` + `getAgentIcon`；右键菜单加「设置 emoji 人格」（`isAgentTerminalMeta` 门控）
- [ ] `tab/tab-info-card.tsx:72`：换取值函数 + 订阅
- [ ] `view/term/agent-hover-card.tsx:93`：换取值函数 + 订阅（logo 可点击 → picker）
- [ ] `session-overview/session-overview.tsx:1746`：换取值函数 + 订阅

**验证**
```powershell
npm test -- tab-info-card agent-hover-card session-overview
```
手动：点 A 图标 → 选 🦊 → 观察 A/B/C/D/E 是否同帧变；再 remove → 全部回 Logo。

---

## S5 接显示面 F–I（provider 级）

- [ ] `view/aisessions/sources.tsx`：`CHAT_SOURCES` **由模块级常量改为组件内 `useMemo([personas])`**；
      `getAgentIcon(id, { personas })`，emoji 时渲染 `agent-emoji-icon`
- [ ] `view/aisessions/session-row.tsx:444`：有人格时 `<span className="agent-emoji-icon agent-emoji-icon--row">`
      顶替色点（`session.source` 文本保留）；无人格保持 `bg-source-*` 色点
- [ ] `workspace/widgets.tsx:574`：删除 `AgentProfileIcons`，改 registry；`AgentProfileColors` 在 emoji 时跳过
- [ ] `modals/agenthooksettingsmodal.tsx:43`：删除 `AgentProviderIcon` 本地 switch，改 registry

**验证**
```powershell
npm test -- sources session-row widgets agenthook
```
手动：picker 选「所有 Claude 会话」→ aisessions chip / 会话行 / 右栏 widget / hook 设置四处同时变。

**回滚点**：S5 只读 persona，删掉改动即恢复原 Logo 显示。

---

## S6 样式

- [ ] `frontend/app/view/term/term.scss` 追加 `.agent-emoji-icon` 与 `--row` 变体（design.md §5）
- [ ] Windows 字体链包含 `Segoe UI Emoji`

**验证（像素级，AC5）**
```powershell
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs screenshot
```
对比「无人格」与「有人格」两张图中：inline tab 宽度、session-row 行高、aim 截图差 ≤ 1px。

---

## S7 质量门

- [ ] `npm test`（全量）
- [ ] `npx tsc --noEmit`（或项目既有 type-check 任务）
- [ ] `npx eslint frontend/app/agent-persona frontend/app/view/term/agent-logo.tsx frontend/app/view/term/agent-emoji-picker.tsx`
- [ ] `grep -rn "getAgentLogoByProvider" frontend/` → 只剩 `agent-logo.tsx` 定义 + 旧测试（AC7）
- [ ] `grep -rn "ClaudeLogo\|OpenAILogo\|GeminiLogo\|OpencodeLogo\|PiLogo" frontend/`
      → 只剩 `view/aisessions/controls.tsx`（定义）与 `agent-logo.tsx`（registry）
- [ ] CDP 实测 9 个面（design.md §4 表格逐行打勾）
- [ ] `docs`：更新 `design/plans/agent-emoji-persona.md` 的「实现事实」小结

---

## S8 提交

- [ ] `git add` 仅本任务文件（不夹带 `.trellis/` 之外的无关改动）
- [ ] commit message：
      `feat(agent): emoji persona for agent icons (provider + block scope)`
- [ ] archive task（`task.py archive`）

---

## 依赖顺序速查

```
S1 ──┬── S3 ── S4
S2 ──┘        └── S5 ── S6 ── S7 ── S8
```

S4 与 S5 无相互依赖，可并行（但同一 cwd 只允许一个写者，建议串行）。

## 已知需二次确认的点

- `EmojiPicker` 的 `mode="document"` 是否强依赖编辑器上下文（若耦合过重 → 退路：`Popover` + 自绘 grid，见 design.md §6 最后一行）
- `SetMetaCommand` 传 `null` 在 `blockAtom` 上的实际表现（先写一个最小 e2e 验证，再铺到 5 个面）

---

## S9 实际落地记录（2026-10-29）

### 源码丢失与还原

10-28 的实现只存在于 `0.14.6-...109` 安装包（`app.asar` + sourcemap），从未提交到 git，
工作区被重置后源码丢失。已从 sourcemap 完整还原 19 个文件 + emoji 样式，
并单独抽出 `frontend/app/agent-persona/agent-persona.scss`（构建产物里能取到确切规则）。

注意：同一构建里还夹带了**别的任务**的未提交改动（subagent 折叠时长、工具描述英文化、
filter-panel 调整、asset svg 等），本次只取 emoji 相关 hunk，不夹带。

### 作用域语义纠正（原设计的缺陷）

原设计把「仅此会话」存在 **block meta**（`agent:emoji`）。block 是窗口里的实例，
所以：切 tab / 关掉重开 / resume 之后失效，aisessions 历史列表（扫盘产物、无 blockId）也读不到。
用户明确指出「仅此会话 = 这个会话出现的所有地方」。

改为 **三级模型**：

| 层 | 存储 | 解析顺序 |
|---|---|---|
| 会话级（仅此会话） | localStorage `snorkeling:agent-session-emojis`，key = sessionId | 1 |
| block meta `agent:emoji` | 兼容旧数据 | 2 |
| provider 级（所有 X 会话） | localStorage `snorkeling:agent-personas` | 3 |
| 品牌 Logo | 代码内置 | 4 |

- 新增 `agent-persona/session-persona-store.ts`（外部 store + storage 事件同步）
  与 `use-session-personas.ts`（`useSyncExternalStore` + jotai 镜像 `sessionEmojiAtom`）。
- `getAgentIcon(provider, { meta, personas, sessionEmojis, sessionId })`：
  sessionId 未显式传入时从 `meta["agent:sessionid"]` 推导。
- 所有有 sessionId 的面（block 头 / inline tab / tab 卡 / hover 卡 / Session Overview /
  aisessions 行 / aisessions 详情头）都传入 sessionId，因此一个会话在任何位置都是同一张脸。

### 本次额外修复（用户反馈）

- **搜索框聚焦不上**：`EmojiPicker` 原来对整个弹窗 `onMouseDown={preventDefault}`，
  输入框永远拿不到焦点；加上打开入口的点击会冒泡到 block 焦点逻辑（xterm 抢焦点）。
  修法：mousedown 只对非表单元素 preventDefault；picker 内部用 ref + rAF + 80ms 兜底聚焦；
  各打开入口 `preventDefault + stopPropagation`。
- **picker 自适应、无横向滚动**：宽度按视口夹取（`min(320, vw-24)`，left 也夹住）、
  网格 `repeat(auto-fill, minmax(34px,1fr))`、分类栏从横滚改 `flex-wrap`、
  高度用锚点上下剩余空间；外层 `display:flex; max-height` 让列表自然收缩。
- **emoji 字形放大但控件尺寸不变**：`.agent-emoji-icon` 盒子仍 13px（`--row` 12px），
  只放大 font-size（15.5 / 14px）+ `overflow: visible`；picker 项 18→22px、网格 28→34px。
  这样 inline tab 宽度与虚拟行高不会因有人格而抖动。
- **Tab「更多」下拉行没有图标槽**：`TabMoreMeta` 增 `agentProvider / agentSessionId / viewIcon`，
  行首新增定宽图标槽（会话 emoji > provider emoji > 视图图标），与 hover Agent Card 一致。
- **aisessions 行可点击设 emoji**：来源标签变成按钮，`stopPropagation` 后开 picker
  （`blockId: null` 的 provider/session 双 scope 模式）。

### 验证

- `npx vitest run frontend/app/view/term/agent-logo.test.ts frontend/app/agent-persona/session-persona-store.test.ts` → 13 passed
- `npx vitest run frontend/app/tab frontend/app/block frontend/app/session-overview` → 146 passed
- `npx tsc --noEmit`：本次改动范围无新增错误；`session-overview.tsx(1231) onDeleteBlock` 与
  `session-overview-model.ts(187)` 两个错误在 HEAD 上同样存在（已用 `git stash` 对比确认）。
- `frontend/app/view/aisessions/open-sessions.test.ts` 的 4 个失败属于另一个未跟踪任务
  （`open-sessions.ts` 未纳入本次改动），与本次无关。
