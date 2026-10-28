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
