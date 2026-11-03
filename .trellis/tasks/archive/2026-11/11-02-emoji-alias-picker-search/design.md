# Design — Emoji Picker 右键标注含义 + 别名搜索

## 1. 边界与职责划分

| 关注点 | 落点 | 说明 |
|---|---|---|
| 别名数据（读/写/订阅/归一化） | 新模块 `frontend/app/element/markdown-transform/emoji-aliases.ts` | 纯 TS + localStorage，可脱离 React 单测 |
| 搜索打分 | `frontend/app/element/markdown-transform/emoji.ts` 的 `searchEmoji()` | 加别名前置层，保持原档位顺序 |
| 列表构建 | 同上 `buildEmojiPickerItems()` | item 带 `alias` 命中信息供渲染 |
| 右键交互 / 编辑面板 | `frontend/app/element/block-editor/components/emoji-picker.tsx` | 组件内部状态，不改 5 个宿主的 props |
| 视觉 | `frontend/app/element/markdown.scss` 的 `markdown-emoji-*` 段 | 复用现有变量 |

**关键约束**：宿主（`markdown.tsx` 4 处 + `agent-emoji-picker.tsx` 1 处）**零改动**。
新增行为全部内聚在共享组件里，因此不存在"哪个宿主支持"的分叉。

## 2. 数据模型

存储键：`snorkeling:emoji-aliases`（v1）

```jsonc
{
  "version": 1,
  "byChar": {
    "✅": { "aliases": ["已解决", "done", "验收通过"], "note": "回归通过", "updatedAt": 1762000000000 },
    "🚧": { "aliases": ["施工中"], "note": "", "updatedAt": 1762000001000 }
  }
}
```

- `byChar` 的 key 用 **catalog 原样 `entry.char`**（含 VS16 / ZWJ 序列），保证与搜索结果 `char` 精确相等。
- `aliases`：`string[]`，写入前 `trim()`、丢弃空串、按 `toLowerCase()` 去重（保留首次出现的原始大小写）、
  截断到 ≤12 条、单条 ≤24 字符。
- `note`：`string`，`trim()` 后 ≤80 字符，可为空。
- `updatedAt`：`Date.now()`，用于将来导出/冲突判断，本期只写不读。

**皮肤变体回退（C3）**：写入只发生在用户右键的那一格（可能是 `👍🏻`）。读取/匹配时按
`char → stripSkinTone(char) → 基座 char` 两跳查找，所以给 `👍` 打了别名，`👍🏻` 也能被搜到。

**版本/容错**：读取时 `version !== 1` → 返回空 map 且**不覆写存储**（避免把未来格式冲掉）；
`JSON.parse` 失败或形状不对 → 空 map。全部包在 `try/catch`（沿用 `emoji.ts` 的 `safeStorage()`）。

**实现期发现的真实数据形态（重要）**：catalog 里的 char **可能带 VS16**，例如 `white_check_mark` 的
`entry.char` 是 `"✅️"`（U+2705 + U+FE0F），而用户/测试手里常是裸 `"✅"`（U+2705）。
因此搜索索引必须**双向归一化**：建索引时对每个 `entry.char` 登记它的所有 `emojiBaseCandidates`
（去皮肤 + 去 VS16），查表时再对存储 key 做同样候选展开。只做单向（存储 → 基座）会漏掉这一大类。

## 3. 模块 API（`emoji-aliases.ts`）

```ts
export interface EmojiAliasEntry { aliases: string[]; note: string; updatedAt: number }
export type EmojiAliasMap = Record<string, EmojiAliasEntry>; // key = emoji char

export function getEmojiAliasMap(): EmojiAliasMap;          // 内存快照（首次读 localStorage，之后读缓存）
export function getEmojiAlias(char: string): EmojiAliasEntry | null; // 含皮肤回退
export function setEmojiAliases(char: string, next: { aliases: string[]; note?: string }): void;
export function removeEmojiAliases(char: string): void;
export function getEmojiAliasVersion(): number;              // 单调递增，用于 useMemo 依赖
export function subscribeEmojiAliases(cb: () => void): () => void; // 本地写入 + 跨窗口 storage 事件
export function normalizeAliases(raw: string[]): string[];   // 去重/裁剪，导出以便单测
```

实现要点：
- 模块级 `cache: EmojiAliasMap | null` + `version: number`，写入时重建 cache 并 `version++`。
- `subscribeEmojiAliases` 内部维护 `Set<cb>`，并**只注册一次** `window.addEventListener("storage")`
  （`event.key === ALIAS_KEY` 时清 cache 并广播），参照 `session-persona-store.ts` 的写法。
- 所有写入 `try/catch`，存储满/隐私模式下**功能降级为内存别名**（本次会话可用，不落盘），不抛错。

## 4. 搜索整合

### 4.1 两段式匹配（保证"别名 > 内置"）

不靠调分数，而是**前置一段独占列表**，避免与现有 `-1/0/1/2/3` 档位算术冲突：

```ts
export function searchEmoji(
    catalog: EmojiCatalog,
    query: string,
    limit = 24,
    aliasMap: EmojiAliasMap = getEmojiAliasMap(),   // 默认读快照，现有调用点不改
): EmojiEntry[]
```

算法：
1. `q = query.trim().toLowerCase()`；空 → 原样返回 `catalog.entries.slice(0, limit)`（行为不变）。
2. **别名段**：遍历 `aliasMap`，对每个条目的 aliases（含 note？**否**，note 只用于展示）：
   - 精确相等 → 组 A；`startsWith(q)` → 组 B；`aliases.join(" ").includes(q)` → 组 C（支持 `code review` 这类短语被 `review` 命中）。
   - 按 A→B→C 拼接，用 `char` 反查 `catalog.entries`（脏数据 char 不在 catalog 时跳过）。
3. **内置段**：原打分逻辑，`if (seen.has(e.char)) continue`。
4. `return [...aliasHits, ...builtinHits].slice(0, limit)`。

### 4.2 picker item 携带命中原因

`EmojiPickerItem` 的 entry 分支加可选字段：

```ts
| { key: string; entry: EmojiEntry; recent?: boolean; alias?: string }
```

`buildEmojiPickerItems(catalog, query, recents, aliasMap?)` 在搜索分支里回填 `alias`（命中别名原文），
并复用 `matchAliasHits` 生成 hit 表（与 `searchEmoji` 同源，避免排序与提示两条逻辑分叉）。
非搜索分支不填。空 query 结构不变（C4：不加"我标注的"分组）。

> 实现期调整（相对原设计）：原计划把别名提示渲染在格子下方 10px 文本，实测 34px 网格放不下中文，
> 改为**搜索结果上方一条 `.markdown-emoji-alias-strip`**（"别名命中 + 最多 4 个 chip"），
> 格子只保留 `title` 拼串与右下角 3px 圆点。信息量等价，且不压缩网格。

### 4.3 别名变更后的刷新

`EmojiPicker` 内用 `useSyncExternalStore(subscribeEmojiAliases, getEmojiAliasVersion)`（或 `useState` + `useEffect`）
拿到 `aliasVersion`，加入 `items` 的 `useMemo` 依赖。保存后 items 重算，key 稳定（`s:${char}:${shortcode}`）不闪。

搜索态下结果集数量可能变化 → 保存后调用一次 `onActiveChange(0)`，避免宿主持有的
`activeIndex` 指向已被挤出的位置（宿主都做了 `Math.min(...)` 夹取，但归零更可预测）。

## 5. 组件状态机

`EmojiPicker` 内部新增：

```ts
type View = "list" | "alias";
const [view, setView] = useState<View>("list");
const [editingChar, setEditingChar] = useState<string | null>(null);
const [draftAliases, setDraftAliases] = useState<string[]>([]);
const [draftNote, setDraftNote] = useState("");
const [aliasInput, setAliasInput] = useState("");
```

- `openAliasEditor(char)`：`view="alias"`，draft 用 `getEmojiAlias(char)` 初始化（无则空）。
- `commit()`：`setEmojiAliases(char, {aliases: normalizeAliases([...draftAliases, ...parse(aliasInput)]), note: draftNote})`，
  空则等价 `removeEmojiAliases`；然后 `view="list"`、`onActiveChange(0)`。
- `cancel()`：丢弃 draft，`view="list"`。
- `view === "alias"` 时**不渲染**搜索框 / 分类栏 / 列表，改渲染 `.markdown-emoji-alias-editor`；
  footer 仍渲染（宿主 scope 单选等不受影响）。

### 5.1 事件与冒泡

| 事件 | 处理 |
|---|---|
| 格子 `onContextMenu` | `e.preventDefault(); e.stopPropagation(); openAliasEditor(entry.char)`；**不走 `onPick`** |
| 格子 `onKeyDown`（`ContextMenu` / `Shift+F10`） | 同上 |
| popover `onMouseDown` | 现有守卫保留；白名单选择器扩到 `input, textarea, select, label, button, .markdown-emoji-alias-chip`，并把 chip 容器加 `data-allow-focus`，否则点击删除 chip 会失焦 |
| 编辑面板根 `onKeyDown` | `Escape` → `cancel()` + `e.stopPropagation()`（关键：宿主在 `window` 上装了 Escape→`onClose`，React 事件冒泡止于此即可拦住） |
| 编辑面板 `Enter` | 别名输入框内 `Enter` = 提交当前 chip（不保存整体），`Ctrl/Cmd+Enter` = 保存 |

### 5.2 已识别陷阱（实现必看）

1. **不能双 portal**：编辑面板必须是同一 popover 内的替换视图（C5）。popover 的
   `maxHeight` 已按 `availableHeight` 收紧，双层浮层会二次触发边界逻辑。
2. **右键的 `mousedown`**：Electron 下 `mousedown` 里 `preventDefault()` 是否抑制后续 `contextmenu`
   需实测。兜底方案：监听目标格子的 `onContextMenu` 而非 document 级；即便某平台不派发，
   仍可通过 `⋯` 悬浮按钮进入（R7 的鼠标兜底）。
3. **activeIndex 双源**：`activeIndex` 由宿主持有，别名保存会改变结果集，必须显式归零（4.3）。
4. **catalog 只读**（R8）：`EmojiEntry.keywords` 绝不能 push 别名 —— 它是全局共享缓存。
5. **inline 模式**（`markdown.tsx` 的 `:emoji` 补全）：其 textarea 的 `keydown` 拥有方向键，
   编辑面板内有输入框时，需保证面板 `onKeyDown` 不把上下键透传出去（面板内 ↑↓ 不做列表导航）。

## 6. 视觉

新增类（全部挂在 `markdown-emoji-*` 命名空间下，写进 `frontend/app/element/markdown.scss`）：

- `.markdown-emoji-item.has-alias::after`：右下角 3px 圆点，`--accent-color` 80% 混合。
- `.markdown-emoji-alias-strip` + `.markdown-emoji-alias-chip`：搜索结果上方的"别名命中"条（10px muted + accent chip）。
- `.markdown-emoji-alias-editor`：`flex column`，含头部（emoji + zh 主名 + `en · :shortcode:`）、
  可删 chip 行、别名输入、note 输入、hint 行、底部动作行（`清除` danger / `取消` / `保存` primary）。
- 有 note 时 `title` 拼为 `labelEn · 别名1 · 别名2 · note`。

## 6.1 键盘契约（实现终态）

| 位置 | 键 | 行为 |
|---|---|---|
| 格子 | `ContextMenu` / `Shift+F10` | 打开编辑面板 |
| 编辑面板 | `Esc` | 关闭面板（`preventDefault` + `stopPropagation`，不触发宿主的 window 级关闭） |
| 编辑面板 | `Ctrl/Cmd+Enter` | 保存 |
| 别名输入 | `Enter` | 提交当前 chip（不保存整体） |
| 别名输入 | `Backspace`（输入为空） | 回删最后一个 chip |

## 7. 兼容 / 回滚 / 性能

- **视觉范围**：不碰 banner 的 `EmojiBadge` 与遗留 `element/emojipalette.tsx`（另一套组件，不在本任务）。
- **回滚**：删除别名层只需把 `searchEmoji` 第 4 参忽略 + 组件停用右键入口；localStorage 键独立，
  遗留数据不影响任何既有逻辑（无人读即失效）。
- **性能**：别名表规模为人手标注量（<100 条），`getEmojiAliasMap()` 为内存快照，
  搜索为 O(别名条数 + catalog 长度)，与现状同阶；inline 每次击键不读 localStorage。
  无新增 React 渲染开销（items 依赖仅多一个整数 version）。
- **数据安全**：不做自动清理；用户的 note 永不被"未使用条目"策略删除。

## 8. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| 纯函数 | `emoji-aliases.test.ts`（新） | normalizeAliases 去重/裁剪/大小写；set/remove 持久化；version 单调；坏 JSON / 版本不符降级；皮肤回退 |
| 搜索 | `emoji.test.ts`（扩） | 别名精确 > 别名前缀 > 内置；`code review` 短语命中；别名指向不存在 char 时跳过；现有断言不回归 |
| 列表 | `emoji.test.ts`（扩） | `buildEmojiPickerItems` 搜索态回填 `alias`；空 query 结构不变（C4） |
| 交互 | `emoji-picker.dom.test.tsx`（新） | 右键不触发 onPick、面板打开、Esc 只关面板、保存后 items 刷新、`has-alias` 圆点、清除后消失 |

运行：`npm test -- emoji`（vitest），DOM 用例沿用仓库现有 `*.dom.test.tsx` 的 jsdom 约定。

## 9. 交付物路由（DESIGN-GOVERNANCE）

- 本任务 `prd.md` / `design.md` / `implement.md` = 规划层，留在 `.trellis/tasks/`。
- 定稿后可镜像一份到 `design/plans/emoji-alias-picker-search.md`（带 ▲ 状态标记）。
- 实现落地后再写 `docs/project/` 事实记录（只写已实现能力）。
