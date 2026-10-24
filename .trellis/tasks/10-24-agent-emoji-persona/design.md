# Design: Agent 人格化（emoji 头像）

## 1. 架构总览

```
                    ┌──────────────────────────────────────────┐
                    │  agent-icon registry                      │
                    │  view/term/agent-logo.tsx                 │
                    │                                           │
   block meta ──────►  getAgentIcon(provider, { meta })          │
   "agent:emoji"      │   1. block meta agent:emoji              │
   (L2, 后端同步)      │   2. persona store[provider]  (L1)       │
                    │   3. 品牌 Logo                            │
                    │   4. null                                 │
                    └───────────────┬──────────────────────────┘
                                    │
        ┌───────────────┬───────────┼───────────┬──────────────┐
        │               │           │           │              │
   A term header    B inline tab  C tab card  D hover    E overview
   F sources chip   G session row  H widgets   I hook modal
                       ▲
                       │ 读
              ┌────────┴─────────┐
              │ persona store    │  localStorage "snorkeling:agent-personas"
              │ (L1, 本机,       │  + storage 事件跨窗口同步
              │  跨全部前端面)    │
              └────────┬─────────┘
                       │ 写（picker「所有 X 会话」）
              ┌────────┴─────────┐
              │ EmojiPicker 弹层  │  点 A 图标 / B 右键菜单
              └──────────────────┘
```

设计要点：**读路径唯一**（只有 registry 知道优先级），**写路径两条**（block meta / persona store），
各显示面既不知道也不关心 emoji 从哪来。

## 2. 模块边界

### 2.1 `frontend/app/view/term/agent-logo.tsx`（改造）

```ts
export const AgentEmojiMetaKey = "agent:emoji";

export type AgentIconSpec =
    | { kind: "emoji"; emoji: string }
    | { kind: "provider"; icon: React.ReactNode; iconColor?: string };

export type AgentIconOpts = {
    /** Block meta；提供后参与 L2 优先级 */
    meta?: Record<string, unknown> | null;
    /** L1 provider 人格表；不传则内部读 persona store 快照 */
    personas?: Record<string, string>;
};

export function normalizeAgentProvider(provider: string): string; // 已有，保持
export function normalizeAgentEmoji(raw: unknown): string | null;
export function getAgentIcon(provider: string, opts?: AgentIconOpts): AgentIconSpec | null;

/** @deprecated 新代码请用 getAgentIcon；保留供渐进迁移与旧测试 */
export function getAgentLogoByProvider(provider: string): { icon; iconColor? } | null;
```

`normalizeAgentEmoji` 实现：

```ts
let segmenter: Intl.Segmenter | null | undefined;
export function normalizeAgentEmoji(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (s === "") return null;
    segmenter ??= typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
    if (segmenter == null) return s.length <= 8 ? s : null; // 极老环境回退
    const it = segmenter.segment(s)[Symbol.iterator]();
    const first = it.next();
    if (first.done) return null;
    // 必须是"单个 grapheme"，且不得残留第二个可打印 grapheme
    const second = it.next();
    if (!second.done) return null;
    return first.value.segment;
}
```

注意：`"🦊\u200d"`、`"🦊🦊"`、`"ab"` 全部返回 `null`（严格单 grapheme），避免 tab 撑宽。

`getAgentIcon` 骨架：

```ts
export function getAgentIcon(provider: string, opts: AgentIconOpts = {}): AgentIconSpec | null {
    const p = normalizeAgentProvider(provider);

    // L2: block 级
    const blockEmoji = normalizeAgentEmoji(opts.meta?.[AgentEmojiMetaKey]);
    if (blockEmoji != null) return { kind: "emoji", emoji: blockEmoji };

    // L1: provider 级（显式传入优先，否则读 store 快照）
    const map = opts.personas ?? getAgentPersonaSnapshot();
    const provEmoji = normalizeAgentEmoji(map?.[p]);
    if (provEmoji != null) return { kind: "emoji", emoji: provEmoji };

    // L3: 品牌 Logo
    const logo = getAgentLogoByProvider(p);
    return logo == null ? null : { kind: "provider", icon: logo.icon, iconColor: logo.iconColor };
}
```

**注意**：`opts.personas` 未传时读全局快照是**不响应式**的。所有 React 显示面必须
`useSyncExternalStore(subscribeAgentPersonas, getAgentPersonaSnapshot)` 订阅后**显式传入**
`personas`，否则切人格不会重渲染。这一点写进 implement 清单，避免只有 A 面刷新。

### 2.2 `frontend/app/agent-persona/persona-store.ts`（新建）

对齐 `app/agent-status/agent-status-done-ack-store.ts`：

```ts
const StorageKey = "snorkeling:agent-personas";
type PersonaMap = Record<string, string>;

let snapshot: PersonaMap = readInitial();
const listeners = new Set<() => void>();
let installed = false;

export function getAgentPersonaSnapshot(): PersonaMap;
export function subscribeAgentPersonas(cb: () => void): () => void;   // 装上 storage 监听
export function setAgentPersona(provider: string, emoji: string | null): void;
export function clearAgentPersona(provider: string): void;
```

- 写入后 `snapshot = next` → 通知 listeners → 同窗口立即重渲染。
- 监听 `window.addEventListener("storage", ...)` 过滤 `event.key === StorageKey`，实现多窗口同步。
- 解析失败（非 JSON / 非对象 / 值非 string）整体回退 `{}`，不抛异常。
- 测试用 `__resetForTests()`（`new` 后重读），与 `agent-status-done-ack-store` 同一套路。

### 2.3 `frontend/app/view/term/agent-emoji-picker.tsx`（新建）

职责：**唯一**知道"如何写入"的组件。

```tsx
type Props = { blockId: string; anchorRect: DOMRect; provider: string; onClose: () => void };
```

- 用 `createPortal` 到 `document.body`；`anchorRect` 计算 `top/left` + 翻转（沿用 `EmojiPicker` 的
  `placement` 语义）。
- `catalog` 通过 `loadEmojiCatalog()` 异步获取（`EmojiPicker` 需要 `EmojiCatalog` 而非 string[]）；
  加载中显示 12 个 skeleton 格。
- 内部状态：`scope: "block" | "provider"`，默认 `"block"`（D3）。
- 选中 emoji：
  - `block` → `RpcApi.SetMetaCommand(TabRpcClient, { oref, meta: { [AgentEmojiMetaKey]: emoji } })`
  - `provider` → `setAgentPersona(provider, emoji)`（不需要 RPC）
- 「恢复默认 Logo」：
  - `block` → `SetMetaCommand({ meta: { [AgentEmojiMetaKey]: null } })`
  - `provider` → `clearAgentPersona(provider)`
- 「最近使用」自动由 `getRecentEmojis()` 提供，与 markdown / slash 命令共用 —— 无需额外接线。

### 2.4 `view/term/term-model.ts`（改造 `viewIcon`）

```ts
this.viewIcon = jotai.atom((get) => {
    // ...vdom 分支不变
    const blockMeta = get(this.blockAtom)?.meta;
    const blockId = get(this.blockId);
    const personas = get(agentPersonaAtom);           // 新 jotai atom，桥接 store
    if (isAgentTerminalMeta(blockMeta) || agentStatus != null) {
        const provider = normalizeAgentProvider(explicitProvider || commandProvider || agentStatus?.provider);
        if (provider !== "agent") {
            const spec = getAgentIcon(provider, { meta: blockMeta, personas });
            if (spec?.kind === "emoji") {
                return {
                    elemtype: "iconbutton",
                    icon: <span className="agent-emoji-icon">{spec.emoji}</span>,
                    className: "agent-brand-icon",
                    title: "点击设置 emoji 人格",
                    click: (e) => openAgentEmojiPicker(blockId, provider, e.currentTarget.getBoundingClientRect()),
                };
            }
            if (spec?.kind === "provider") { /* 现状 + click 同样可开 picker */ }
        }
    }
    return { elemtype: "iconbutton", icon: "terminal" };
});
```

- `IconButtonCommon.icon` 类型已是 `string | React.ReactNode`（`custom.d.ts:219`），无需新增 elemtype。
- `click` 由 `useLongClick` 转发（`element/iconbutton.tsx:18`），签名 `(e: React.MouseEvent) => void`。

**picker 打开方式（避免把 UI 状态塞进 atom 树）**：新建一个极小模块
`app/agent-persona/picker-host.ts`，持有 `{ blockId, provider, rect } | null` 的
`useSyncExternalStore` 快照，并在 `frontend/app/block/block.tsx`（或 app 根布局）挂一个
`<AgentEmojiPickerHost />`。理由：`viewIcon` 是 jotai atom，若直接把 picker state 放进 atom，
portal 需要挂载点；用 host 组件可以保证 portal 只挂一次，且不污染 TermViewModel。

## 3. 数据流

```
用户点击 A 图标
   → openAgentEmojiPicker(blockId, provider, rect)     [picker-host]
   → <AgentEmojiPicker> portal 渲染 EmojiPicker
   → 用户选 🦊，scope=provider
   → setAgentPersona("claude", "🦊")
   → snapshot 更新 → 通知全部 subscribeAgentPersonas 的组件
   → A/B/C/D/E/F/G/H/I 同帧重渲染（全部经 getAgentIcon）
   → localStorage 写入，其他窗口靠 storage 事件同步
```

block 级路径唯一差别：`SetMetaCommand` → RPC → `blockAtom` 更新 → A–E 重渲染（F–I 不受影响）。

## 4. 各显示面改动契约

| 面 | 读取来源 | 改动 |
|---|---|---|
| A `term-model.viewIcon` | `blockMeta` + personas | 用 `getAgentIcon`；emoji 分支渲染 span + click |
| B `block.tsx` | `blockData.meta` + personas | 同上；右键菜单项 |
| C `tab-info-card` | `block.meta` + personas | 只换取值函数 |
| D `agent-hover-card` | `blockData.meta` + personas | 只换取值函数（顺手让 logo 可点） |
| E `session-overview` | `block.meta` + personas | 只换取值函数 |
| F `aisessions/sources.tsx` | personas（无 block） | `CHAT_SOURCES.icon` 改为 `getAgentIcon(id, { personas })`；无 emoji 时回退原 Logo |
| G `aisessions/session-row.tsx` | personas | 有人格 → `<span className="agent-emoji-icon agent-emoji-icon--row">` 顶替色点 |
| H `workspace/widgets.tsx` | personas | 删 `AgentProfileIcons`；`AgentProfileColors` 在 emoji 时跳过 |
| I `agenthooksettingsmodal.tsx` | personas | 删本地 switch |

**订阅要求**：A–I 中所有 React 渲染点都必须通过
`useAgentPersonas()`（新建 hook，内部 `useSyncExternalStore(subscribeAgentPersonas, getAgentPersonaSnapshot)`）
拿到 personas 并传给 `getAgentIcon`。`sources.tsx` 的 `CHAT_SOURCES` 是模块级常量，
必须改为在组件内 `useMemo(..., [personas])` 派生，不能保留模块级常量。

## 5. 样式

新增（放 `frontend/app/view/term/term.scss`，与 `.agent-brand-icon` 相邻）：

```scss
.agent-emoji-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1em;
    height: 1em;
    font-size: 13px;
    line-height: 1;
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
    font-variant-emoji: emoji;
    flex: 0 0 auto;
}
.agent-emoji-icon--row { font-size: 12px; width: 12px; height: 12px; }
```

强制约束：
- 不允许 `width: auto`（tab 跑马灯与溢出折叠依赖固定宽度）。
- 不允许给 emoji 套 `color`（彩色 emoji 不受 `color` 影响，但会让部分单色字体变黑白）。
- win/mac/linux 字体链必须都在，避免 Windows 上回退成黑白符号。

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 只有 A 面刷新 | 其余面 stale | 统一 `useAgentPersonas()` hook；实现后逐面手动/CDP 验证 |
| emoji 撑宽 tab | 跑马灯误触发、tab 溢出折叠 | 定宽 span + 单 grapheme 校验（AC5 截图对比） |
| `sources.tsx` 模块级常量 | 改 persona 后 chip 不刷新 | 必须改成组件内 `useMemo`（写进 implement 清单） |
| `SetMetaCommand` 写 `null` 的行为差异 | 清除失败 / 残留 `"null"` 字符串 | 参考 `BlockLockMetaKey` 的 `isLocked ? null : true` 已验证用法 |
| 非 agent block 被误设 emoji | 显示异常 | `getAgentIcon` 只在 agent 面调用；B 的右键菜单项按 `isAgentTerminalMeta` 门控 |
| `EmojiPicker` 是 markdown 专用组件，props 绑定编辑器语义 | 复用成本 | 只用其 `mode="document"` 语义（自带搜索框 + allowRemove），不传 `onQueryChange` 以外的新 prop；若耦合过重，退路是在 `agent-emoji-picker.tsx` 内用 `Popover` + 简易 grid（12 列）自绘，catalog 仍复用 `loadEmojiCatalog()` |

## 7. Phase 2 升级路径（不在本期）

把 L1 从 localStorage 提到 `wconfig`：

1. `pkg/wconfig/settingsconfig.go` 增 `AgentPersonas map[string]string \`json:"agent:personas,omitempty"\``
2. `pkg/wconfig/metaconsts.go` 增 `ConfigKey_AgentPersonas`
3. `task generate` 重生成 `frontend/types/gotypes.d.ts`
4. persona-store 的读写改为 `useSettings` + `SetConfigCommand`（接口保持不变，调用方零改动）

这正是把读写封装在 store 而不是散落在组件里的价值。

## 8. 测试计划

- `view/term/agent-logo.test.ts`
  - `normalizeAgentEmoji`：`"🦊"` ✅；`""` / `"  "` / `"ab"` / `"🦊🦊"` / `"🦊\u200d"` / `null` / `42` ❌
  - `getAgentIcon` 优先级：meta > persona > logo > null
  - provider 未知 + block emoji → emoji
  - `getAgentLogoByProvider` 兼容包装返回值不变
- `app/agent-persona/persona-store.test.ts`
  - 读写往返；空对象不写（避免垃圾 key）；storage 事件触发 listener；坏 JSON 回退 `{}`
- `view/term/agent-emoji-picker.test.tsx`（RTL）
  - scope 默认 block；切换 scope 后写入目标不同；remove 清除对应层
- 回归：`view/aisessions/session-row.test.tsx`、`sources.test.tsx` 现有断言不破
