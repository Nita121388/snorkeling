# Quote to Input 事件总线与 composer 插入

## Goal

让「把选中的会话内容引用到输入框」成为一次点击：💡 菜单的 `Quote to Input` 把 Copy Context 文本插入当前会话 composer 的光标处，用户接着提问即可。

依赖子任务 `10-24-aisessions-copy-context-builder` 的 `formatSessionContext`（保证与 Copy Context 逐字节一致）。

## 前置事实（已核查）

- composer 组件 `ChatComposerInner`（`frontend/app/view/aisessions/chat-composer.tsx:126`）的输入文本是**内部 state**：`const [input, setInput] = useState("")`（`:140`），`textarea` ref 为 `inputRef`（`:172`）。外部无 setter，无 ref 透传。
- composer 的实例化点两处，均在 `session-detail.tsx`：
  - 已有会话：`sessionId={summary.id}`（`:1479`），`key={composer-${summary.id}}`
  - 新会话：`sessionId=""`（`:1503`），`key={composer-new-${newChatEpoch}}`
- 跨组件事件范例：`frontend/app/view/aisessions/session-note-events.ts` —— 模块级 `Set<listener>` + `dispatchAISessionNoteUpdated()` + `isAISessionNoteUpdatedEvent()`。
- 💡 菜单的 `extraMenuItems` 槽（`selection-copy-overlay.tsx:126`）只有在宿主渲染 `SelectionCopyOverlay` 时才可用。全局 `ClipboardFloatActions` 只传 `copyMenuItems`，**不传 `extraMenuItems`**（`clipboard-float-actions.tsx:286`）。这是本任务的主要可行性风险，见 D3。
- 右键菜单分支（`app.tsx:121-140`）同样不传任何注入槽，只 push `makeCopyContextMenuItem`。

## 设计

### D1 事件总线

新文件 `frontend/app/view/aisessions/chat-composer-events.ts`：

```ts
export type ComposerInsertion = {
    text: string;
    /** 插入位置：正文之后追加换行 + 空行，避免与已有草稿粘连 */
    requestId: number;
};

type Listener = (insertion: ComposerInsertion) => void;

const listenersByKey = new Map<string, Set<Listener>>();

export function subscribeComposerInsertion(sessionKey: string, listener: Listener): () => void;
export function quoteIntoComposer(sessionKey: string, text: string): void;
```

- `sessionKey` 约定：`sessionId || NewSessionKey`（`NewSessionKey` 来自 `./types`，值为 `"__new__"`），与 composer 的实际身份一致，避免新会话与已有会话串台。
- `quoteIntoComposer` 在无监听者时静默丢弃（不抛错、不弹窗）。
- `requestId` 用模块级自增，供 composer 做去重（同一 key 短时间重复触发不应重复插入——实际上不会重复订阅，仅作调试锚点）。

### D2 composer 订阅与插入

`ChatComposerInner` 内新增：

```tsx
const sessionKey = sessionId || NewSessionKey;
useEffect(() => subscribeComposerInsertion(sessionKey, (insertion) => {
    setInput((prev) => insertAtCaret(prev, insertion.text));
    // 焦点 + 光标落末尾放到下一帧，等 setInput 渲染完
    requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el == null) return;
        el.focus();
        const end = el.value.length;
        el.setSelectionRange(end, end);
    });
}), [sessionKey]);
```

插入语义（纯函数，放 `chat-composer-insert.ts` 便于单测）：

```ts
export function insertQuotedText(prev: string, quote: string): string;
```

规则：

1. `prev` 为空 → 直接返回 `quote`
2. `prev` 非空且不以换行结尾 → `prev + "\n\n" + quote`
3. `prev` 以单个换行结尾 → `prev + "\n" + quote`
4. `prev` 以两个及以上换行结尾 → `prev + quote`
5. `quote` 自身首尾 trim，末尾统一补一个换行

**光标位置**：插入后统一落到末尾（而非「光标处」）。原因：composer 的 `textarea` 在插入前通常没有焦点（用户刚在详情面板里拖选完），`selectionStart` 无意义。落末尾是最不意外的行为，且用户要继续打字时就在引用块后面。

> 与父任务 R3.2 的措辞「光标处」有偏差，按此实现，并在父任务集成验收时确认口径。若用户要求严格光标处，则改为记录 `el.selectionStart` 并在插入后恢复 —— 但仅在 composer 已有焦点时才有意义。

### D3 💡 菜单入口的可行性

两条路径，按优先级尝试：

**方案 A（首选）**：`ClipboardFloatActions` 增加一个可选的 `extraMenuItems` 计算通道 —— 但它是全局组件，不懂具体会话。需要一个「当前光标所在会话」的解析：给 Session Detail 的根容器加 `data-aisession-key="<sessionId|__new__>"`，`clipboard-float-actions.tsx` 在构造菜单时用 `selection.anchorNode.closest("[data-aisession-key]")` 解析出 key，命中就追加 `Quote to Input` 项。

- 优点：零新浮层，右键菜单也能顺带支持
- 代价：改全局组件，需要保证非会话区域完全不出现该项

**方案 B（兜底）**：Session Detail 自己渲染一个 `SelectionCopyOverlay`（局部，`position="absolute"`），监听本面板内的选区，通过 `extraMenuItems` 传 `Quote to Input`。与全局那个会同时出现两个 💡 —— 需要在本面板内抑制全局那个（给容器加一个标志，让 `clipboard-float-actions.tsx` 跳过该区域）。

- 优点：作用域清晰
- 代价：两个浮层的抑制逻辑容易出边界 bug

**决策**：先做方案 A。若 A 因抑制/解析问题不可行，退到 B。**实施时在本文件记录实际选择与原因。**

### D4 入口可见性

`Quote to Input` 只在同时满足时出现：

1. 选区命中 `[data-aisession-key]`
2. 该 key 对应的 composer 已订阅（`listenersByKey.get(key)?.size > 0`）

条件 2 通过 `chat-composer-events.ts` 导出 `hasComposerListener(sessionKey): boolean` 判断。这样终端、preview、Wave AI 面板都不会出现该项。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/app/view/aisessions/chat-composer-events.ts` | 新增：订阅 / 派发 / `hasComposerListener` |
| `frontend/app/view/aisessions/chat-composer-events.test.ts` | 新增：订阅、取消、多 key 隔离、无监听丢弃 |
| `frontend/app/view/aisessions/chat-composer-insert.ts` | 新增：`insertQuotedText` 纯函数 |
| `frontend/app/view/aisessions/chat-composer-insert.test.ts` | 新增：D2 五条规则 |
| `frontend/app/view/aisessions/chat-composer.tsx` | 订阅 + 插入 + 聚焦 |
| `frontend/app/view/aisessions/session-detail.tsx` | 根容器加 `data-aisession-key` |
| `frontend/app/element/clipboard-float-actions.tsx` | 解析 `data-aisession-key` + 追加 `Quote to Input`（方案 A） |
| `frontend/app/app.tsx` | 右键菜单同步追加 `Quote to Input`（可选，与方案 A 同源） |

## 测试

- `chat-composer-events.test.ts`：多 key 隔离、退订、无监听静默
- `chat-composer-insert.test.ts`：D2 五条规则 + 首尾空白
- 集成：Session Detail 选中 AI 回复 → 💡 → `Quote to Input` → 输入框出现 `<context>` 引用块，光标在末尾，可直接续写并发送
- 负向：preview 里选文字 → 💡 菜单**没有** `Quote to Input`
- 一致性：同一选区分别走 `Copy Context` 与 `Quote to Input`，两处文本逐字节相等

## Acceptance

- [ ] `Quote to Input` 仅在会话详情选区出现
- [ ] 插入文本与 `Copy Context` 输出逐字节一致
- [ ] 连续两次触发不会把同一段重复插入（第二次是新的独立插入，符合预期但需人工确认观感）
- [ ] 新会话（`sessionId=""`）也能插入，且不会插到已有会话的 composer
- [ ] 插入后光标落在末尾，无需手动点击
- [ ] 不写剪贴板
- [ ] 两个新增单测文件全绿

## 实施记录

（实施时记录 D3 实际采用方案与原因）
