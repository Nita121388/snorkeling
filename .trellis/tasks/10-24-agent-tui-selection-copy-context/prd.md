# Agent TUI 选中绕行与 Copy Context

## Goal

让 Agent TUI（跑 claude / codex / pi 的终端 block）在开启鼠标上报的场景下仍能可靠选中文字，并把终端侧的 Copy Context 输出接到 💡 菜单。

依赖子任务 `10-24-aisessions-copy-context-builder` 提供的 DOM 契约与 `fencedBlock`。若子任务 1 未合并，本任务先按契约常量自行占位，合并时对齐。

## 前置事实（已核查）

- xterm 的 `shouldForceSelection`（`node_modules/@xterm/xterm/lib/xterm.js`）：
  - macOS：`e.altKey && options.macOptionClickForcesSelection`
  - 其它平台：`e.shiftKey`
  - 本项目已开启 `macOptionClickForcesSelection: true`（`frontend/app/view/term/term.tsx:436`）
  - 因此 **Windows / Linux 下 Shift+拖选在 TUI 鼠标上报开启时本就生效**，`shouldForceSelection` 返回 true 时 xterm 直接 `cancel(e)` 走选区、不发给 PTY。
- `handleTermMouseDownCapture`（`term.tsx:634`）对 plain gesture 做转发决策，入口是 `shouldRoutePlainTermGesture`（`frontend/app/view/term/term-selection-gesture.ts:6`），该函数**只对 `platform === "darwin"` 返回 true**，即 Windows 上 plain drag 不进这个分支。
- 终端选区浮层链路：`termWrap.onSelectionTextChange`（`term.tsx:452`）→ `selectionCopyOverlay` state → `<SelectionCopyOverlay overlay={...} copyMenuItems={terminalCopyMenuItems}>`（`term.tsx:850`）。
- 当前 `terminalCopyMenuItems`（`term.tsx:597`）已有两项：`Copy Logical Line`（依赖 `selectionLogicalLineText`）、`Copy Selection as One Line`。
- 终端 agent 标识可从 block meta 读：`term.tsx` 已有 `normalizeAgentProvider`（`frontend/app/view/term/agent-meta.ts:7`）与 `getAgentLogoByProvider`（`agent-hover-card.tsx:95`）。
- `cmd:cwd` 在 `MetaType` 中已定义（`frontend/types/gotypes.d.ts:1795`）；`term:connection` 需确认，未确认则降级为 `"local"`。

## 关键验证（先做，决定后续工作量）

### V1：Windows + Shift+拖选可用性

手工验证矩阵：

| 场景 | 预期 |
|---|---|
| 普通 shell，无鼠标上报 | 直接拖选 |
| claude fullscreen（鼠标上报 on） | Shift+拖选 |
| claude 经典（modal）渲染器 | Shift+拖选 |
| pi / codex TUI | Shift+拖选 |

同时补单测，把 xterm 的判定逻辑固化成纯函数（`term-selection-gesture.ts` 已同款做法）：

```ts
export function shouldForceTermSelection(platform: NodeJS.Platform, shiftKey: boolean, altKey: boolean, macOptionClickForcesSelection: boolean): boolean;
```

- **V1 全部通过 → 不做选择模式开关**（父任务 R5.2 不触发）。只补单测 + 在 `TermClaudeFullscreenHint`（`term.tsx:236`）文案里追加一句 `Shift+拖选可复制`，降低发现成本。
- **V1 有失败 → 才实现选择模式**：header 加一个 toggle，开启期间 `shouldRoutePlainTermGesture` 对当前 platform 也返回 true，让 plain drag 走已有的 `startSelection` 合成 `altKey: true` mousedown 那条既有路径。状态不持久化，关闭 block 即失效。

## 设计

### D1 终端上下文 meta 装配

在 `term.tsx` 的 `TerminalView` 内新增 `useMemo`：

```ts
const termCopyContext = React.useMemo<AgentTermCopyMeta>(() => {
    const meta = blockData?.meta ?? {};
    return {
        blockId,
        agent: normalizeAgentProvider(meta["term:provider"] ?? meta["cmd:agent"] ?? ""),
        cwd: meta["cmd:cwd"] ?? "",
        connection: meta["term:connection"] ?? "local",
    };
}, [blockData?.meta, blockId]);
```

字段取不到的（如 `cwd` 为空串）在格式化时整行不输出。

### D2 选中行号折算

需要的是**缓冲区绝对行号**。xterm 的 `getSelectionPosition()` 返回的 `start` / `end` 是 `{ col, row }`，其中 `row` 是**视口相对**行号（0 = 视口顶）。绝对行号 = `buffer.active.baseY + row`。

在 `onSelectionTextChange` 回调里同时捕获：

```ts
setSelectionLineRange({
    start: buffer.baseY + pos.start.row,
    end: buffer.baseY + pos.end.row,
});
```

注意 `getSelectionPosition()` 在无选区时返回 `undefined`，需判空。

### D3 菜单项注入

`terminalCopyMenuItems` 数组追加：

```ts
{
    label: "Copy Context",
    click: () => {
        fireAndForget(async () => {
            await copyText(formatTermContext({
                ...termCopyContext,
                selectedLines: selectionLineRange,
                text: selectionText,
            }));
            hideSelectionCopyOverlay();
        });
    },
}
```

`formatTermContext` 由子任务 1 的 `copy-context.ts` 提供（父任务 R2 的终端格式），或在本任务中按父任务 R2 格式先实现后合并对齐。**输出格式必须与父任务 R2 逐字节一致。**

顺序放在既有两项之后。父任务约束不改 `makeSelectionQuickActionMenu` 固定项顺序——此处是 `copyMenuItems` 注入，不涉及固定项。

### D4 DOM 契约（供 💡 / 右键菜单兜底）

终端画布是 canvas，**没有 DOM 选区**，所以 `getCopyContextTextFromDom` 对终端永远返回 null。终端的 Copy Context 只能通过它自己的 `copyMenuItems` 注入实现，即 D3 这条路径。

因此**不给终端挂 `data-copy-context-kind`**。父任务 R2 终端格式由 D3 直接满足。

若后续希望右键菜单也支持终端，需要单独的右键 `handleContextMenu`（`term.tsx:578`）改动，列为 stretch，本任务不做。

## 文件改动清单

| 文件 | 改动 |
|---|---|
| `frontend/app/view/term/term-selection-gesture.ts` | 新增 `shouldForceTermSelection` 纯函数（若 V1 需要选择模式，同时调整 `shouldRoutePlainTermGesture` 的 platform 门） |
| `frontend/app/view/term/term-selection-gesture.test.ts` | 补 `shouldForceTermSelection` 单测（4 平台 × 修饰键矩阵） |
| `frontend/app/view/term/term.tsx` | `termCopyContext` memo、`selectionLineRange` state、`terminalCopyMenuItems` 追加项、`TermClaudeFullscreenHint` 文案 |
| `frontend/app/view/aisessions/copy-context.ts` | 若子任务 1 未就绪，临时补 `formatTermContext`（合并时对齐到子任务 1） |

## 测试

- `shouldForceTermSelection` 单测：darwin/win32/linux × (shift, alt) 组合
- 集成：在跑 claude 的 terminal block 里 Shift+拖选 → 💡 → Copy Context → 粘贴含 `<context>` 与 `selected-lines`，绝对行号正确（对比 `less` 或 `cat -n` 输出核对）
- 回归：既有 `Copy Logical Line` / `Copy Selection as One Line` 行为不变

## Acceptance

- [ ] 终端选中输出后 💡 菜单出现 `Copy Context`
- [ ] 粘贴内容含 `<context>` 块，字段顺序符合父任务 R2
- [ ] `selected-lines` 为缓冲区绝对行号（含 baseY 折算），滚动后仍正确
- [ ] `cwd` / `connection` / `agent` 缺失时对应行不输出
- [ ] 选中文本含三反引号时围栏正确升级
- [ ] 既有两项复制菜单行为不变
- [ ] V1 验证结论记录在本文件末尾（含「是否实现选择模式」）

## V1 验证记录

（实现时填写）
