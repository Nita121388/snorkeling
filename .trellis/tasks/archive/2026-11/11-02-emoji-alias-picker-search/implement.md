# Implement — Emoji Picker 右键标注含义 + 别名搜索

## 0. 前置：调用面枚举（替代 GitNexus impact）

本项目 AGENTS.md 要求「改符号前跑 `impact`」。**本会话工具列表中没有 GitNexus MCP 的 `impact` /
`context` / `detect_changes`**，改用源码级调用面枚举（被改符号全部是组件 + 纯函数，`rg` 可穷举完备）。
若后续拿到 MCP，必须补跑并在下表回填。

| 符号 | 文件 | 调用点（已枚举） | 风险 |
|---|---|---|---|
| `searchEmoji` | `element/markdown-transform/emoji.ts:131` | 1 处：`buildEmojiPickerItems`；测试 `emoji.test.ts` 6 处 | **中** — 改签名须保持可选参数向后兼容 |
| `buildEmojiPickerItems` | 同文件 `:208` | 5 处：`emoji-picker.tsx:67`、`markdown.tsx:4428 / 4483 / 4649`；测试 4 处 | **中** — 加可选第 4 参 |
| `EmojiPickerItem` 类型 | 同文件 `:200` | 消费方：`emoji-picker.tsx`、`markdown.tsx`（`slashItems` 等） | 低 — 仅新增可选字段 |
| `EmojiPicker` 组件 | `block-editor/components/emoji-picker.tsx:51` | 5 个渲染点：`markdown.tsx:5791`(callout)、`:5813`(doc)、`:6012`(inline `:emoji`)、`:6033`(slash emoji)、`agent-emoji-picker.tsx:236`(persona)；props 无 breaking 变更 | **中** — 5 处共享，需全量回归 |
| `.markdown-emoji-item` 样式 | `element/markdown.scss` | 仅 picker 内使用 | 低 |
| `safeStorage()` | `emoji.ts:160` | 文件内私有；`emoji-aliases.ts` 复制同款（不导出以免扩大耦合） | 低 |

**CRITICAL 禁区（不碰）**：

- `EmojiCatalog` / `EmojiEntry` 的 `keywords` 字段内容（R8：别名绝不写回 catalog）。
- 5 个宿主的 `query` / `activeIndex` / `onPick` / `footer` 契约 —— 一律不改 props。
- `agent-persona/*` 的 scope 单选、`persona-store` / `session-persona-store` 写入链路。

## 1. 执行顺序（每步可独立 revert）

### Step 1 — 新增 `emoji-aliases.ts` + 单测（纯函数，零依赖）

- [ ] 建 `frontend/app/element/markdown-transform/emoji-aliases.ts`，导出 design §3 的 7 个函数。
- [ ] `STORAGE_KEY = "snorkeling:emoji-aliases"`，`cache` + `version` + `subscribers` 模块级状态。
- [ ] `normalizeAliases`：trim → 丢空 → 小写去重（保留首现原文）→ 截 12 条 → 单条截 24 字符。
- [ ] `getEmojiAlias` 实现皮肤回退：精确 char → `stripSkin(char)` → 基座 char。
- [ ] 写入 `try/catch`；读写失败降级为内存态。
- [ ] 建 `emoji-aliases.test.ts`：stub `window.localStorage`（照抄 `session-persona-store.test.ts` 的 mock 写法）。
- [ ] 用例覆盖：去重/裁剪、持久化、version 单调、坏 JSON、版本不符不覆写、皮肤回退、跨订阅通知。

**Gate G1**：`npm test -- emoji-aliases` 全绿；`npx tsc --noEmit` 该文件无错。

### Step 2 — `searchEmoji` 别名前置层 + `buildEmojiPickerItems` 命中回填

- [ ] `searchEmoji` 加可选第 4 参 `aliasMap = getEmojiAliasMap()`，实现 design §4.1 的 4 步（别名 A/B/C 段 → 内置段去重 → slice）。
- [ ] `EmojiPickerItem` entry 分支加 `alias?: string`。
- [ ] `buildEmojiPickerItems` 加可选第 4 参 `aliasMap?`，搜索分支回填命中别名原文。
- [ ] 空 query 分支**完全不动**（C4）。
- [ ] 扩 `emoji.test.ts`：别名精确/前缀/短语命中排序、别名 char 不在 catalog 时跳过、现有 6 条断言不回归。

**Gate G2**：`npm test -- markdown-transform` 全绿；`rg "searchEmoji\(" frontend` 确认无新增必填参数。

### Step 3 — 样式

- [ ] `markdown.scss` 追加 `.markdown-emoji-item.has-alias::after`、`.markdown-emoji-alias-hint`、
      `.markdown-emoji-alias-editor`（含 chip / 输入 / 底部按钮行）。
- [ ] 全部复用现有变量（`--accent-color` / `--secondary-text-color` / `--form-element-bg-color` /
      `--form-element-border-color`），不新增 hex。

**Gate G3**：`npm run dev:cdp` 起应用，肉眼确认 picker 在明暗两套主题下无溢出（见 Step 5 自检表）。

### Step 4 — 组件右键 + 编辑面板

- [ ] `emoji-picker.tsx`：加 §5 的 5 个内部 state + `openAliasEditor / commit / cancel`。
- [ ] 格子加 `onContextMenu`（`preventDefault` + `stopPropagation`）与 `onKeyDown`（`ContextMenu` / `Shift+F10`）。
- [ ] `view === "alias"` 时替换搜索框/分类栏/列表为编辑面板；footer 保留。
- [ ] 面板根 `onKeyDown`：`Esc` → cancel + `stopPropagation`；输入框 `Enter` → 加 chip；`Ctrl/Cmd+Enter` → commit。
- [ ] `handlePopoverMouseDown` 白名单扩 `data-allow-focus`；chip 点击删除不丢焦点。
- [ ] `items` 的 `useMemo` 依赖加 `aliasVersion`（`useSyncExternalStore`）；commit 后 `onActiveChange(0)`。
- [ ] 格子渲染：`has-alias` 类 + `title` 拼别名/note + `alias` 命中时渲染 `.markdown-emoji-alias-hint`。
- [ ] 建 `emoji-picker.dom.test.tsx`：右键不触发 `onPick`、面板打开、Esc 只关面板不关 picker、
      保存后别名出现在搜索结果、清除后圆点消失。

**Gate G4**：`npm test -- emoji-picker` 全绿；`npx tsc --noEmit` 通过。

### Step 5 — 5 个渲染点回归（必须逐项打勾）

| # | 渲染点 | 入口 | 验证 |
|---|---|---|---|
| 1 | inline `:emoji` 补全 | markdown 编辑器输入 `:` | 右键可编辑；↑↓ 仍归 textarea |
| 2 | slash emoji | `/emoji` | 右键可编辑；Enter 选中不受影响 |
| 3 | callout emoji | callout 图标 | 右键可编辑；backdrop 点击仍关闭 |
| 4 | 文档 emoji 头 | 文档标题 emoji | 右键可编辑；搜索别名命中 |
| 5 | agent persona picker | Tab/会话行 emoji → 右键菜单 | 右键可编辑；scope 单选 + "仅显示 Emoji" 仍工作 |

- [ ] 快捷键 `Shift+F10` / `ContextMenu` 在第 1、2 两类浮层中各测一次。
- [ ] 多窗口：窗口 A 写入别名 → 窗口 B 输入该别名可搜到（验证 storage 事件）。
- [ ] 反向确认：banner `EmojiBadge` 与 `element/emojipalette.tsx` 行为未变（不属于 EmojiPicker）。
- [ ] 重启应用后别名仍在。

**Gate G5**：自检表全勾 + 浏览器控制台无异常（`node scripts/inspect-electron-ui.mjs screenshot` 留证）。

### Step 6 — 质量检查与提交

- [ ] 全量受影响测试：`npm test -- emoji`。
- [ ] `npx tsc --noEmit`（或仓库既有 typecheck task）全量通过。
- [ ] 改动的既有文件跑 `npm run` 既有 lint（若仓库配置了 lint-staged，就按 pre-commit 走）。
- [ ] 提交前 `git diff` 自查：只动了 design.md 列出的 4 个源文件 + 2 个测试文件。
- [ ] 单 commit：`feat(emoji-picker): 右键标注 emoji 含义并支持别名搜索`。

**回滚点**：Step 1–2 与 Step 3–4 分开提交更稳；若合并提交，回滚方式 = 停用 `openAliasEditor` 入口
（别名层成死代码，搜索行为回到内置档位）。

## 2. 排期与依赖

- Step 1 → Step 2 有严格顺序（Step 2 依赖 Step 1 的 API）。
- Step 3 与 Step 2 可并行（仅样式）。
- Step 4 依赖 Step 2 + 3。
- 全程无后端依赖、无配置键、无迁移脚本。

## 3. 风险登记

| 风险 | 触发条件 | 处置 |
|---|---|---|
| 右键 `mousedown` 被 `preventDefault` 吞掉 | Electron 平台差异 | 用格子级 `onContextMenu` + `⋯` 悬浮按钮兜底（design §5.2-2） |
| 保存后 `activeIndex` 越界 | 搜索结果集变化 | commit 后 `onActiveChange(0)`（宿主已有 `Math.min` 夹取，双保险） |
| Esc 双处理器打架 | 宿主 `window` keydown + 面板 keydown | 面板 `onKeyDown` `stopPropagation`（design §5.1） |
| catalog 被污染 | 误在 `EmojiEntry.keywords` push 别名 | 代码评审硬性检查 + 单测断言 `catalog.entries[].keywords` 不变 |
| localStorage 满 / 隐私模式 | 大量 note | 降级内存态，不抛错，不阻塞保存交互 |
