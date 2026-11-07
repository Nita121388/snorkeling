# Design · Files Block Header 锁存式分区

## 1. 现状结构（真实代码，已核对）

`frontend/app/block/blockframe-header.tsx` 的 `BlockFrame_Header` 渲染一棵扁平 flex 树：

```
<div className="block-frame-default-header">        ← position:relative, display:flex, gap:8px, padding 4px 5px 4px 7px
    {preIconButton}                                  ← .block-frame-preicon-button (chevron-left, Go to parent dir)
    <div className="block-frame-default-header-iconview">   ← display:flex, flex-shrink:3, min-width:17px, overflow:hidden
        {viewIconElem}                               ← .block-frame-view-icon (folder-open / iconForFile)
        {metaFrameText && <div className="block-frame-view-type">}
    </div>
    {manageConnection && <ConnectionButton>}
    <HeaderTextElems>                                ← .block-frame-textelems-wrapper: flex 1 2 auto, min-width 0
        └ renderHeaderElements(viewText)             ← copytext(文件名) + Go to Path + 列表树切换 + 打开方向 + HTML 方式 + Preview + 滚动同步
    <HeaderEndIcons>                                 ← .block-frame-end-icons: flex-shrink:0, column-gap:2px
        ├ reveal 区 (zone:"reveal")                  ← 默认 display:none；.is-hovered 时 display:flex
        │   vcs / eye / html / book / book-open / ellipsis(More) / magnify / inline-minimize / split
        └ pinned 区 (zone:"pinned")                  ← 始终 display:flex
            Refresh / Edit / Close
</div>
```

`block.scss` 关键规则（`frontend/app/block/block.scss:598-640`）：

```scss
.block-frame-end-icons {
    display: flex; flex-shrink: 0; justify-content: flex-end; column-gap: 2px;
    .wave-iconbutton.end-icon-reveal { display: none; }
    &.is-hovered .wave-iconbutton.end-icon-reveal:not(.disabled) { display: flex; }
    .wave-iconbutton.end-icon-pinned { display: flex; pointer-events: auto; }
    .wave-iconbutton { display:flex; width:24px; padding:4px 6px; align-items:center; }
}
```

**根因**：header 是 `display:flex` 且没有收缩预算协商；`end-icons` 是 `flex-shrink:0`，悬浮时一次性把全部 reveal icon 变成 `display:flex`。放不下的部分被 header 的 `overflow:hidden` **硬切**（实测 240px 下 6 个全被切）。被切的 icon 不在菜单、不在浮层 —— 功能真丢。

**第二根因**：`isHovered` 是单一布尔，`end-icons` 一悬浮就全亮，无法区分"鼠标在哪半"。且 `isHovered` 与 `claimInfoCard` / Agent·Note 悬浮卡耦合（`onPointerLeave` 里 2000ms 才清），不能拿它做分区载体。

## 2. 方案总览

三个正交改动：

1. **锁存状态机**（`hoverLatch`）：`pointerenter` 判定一次方向，会话内锁死。**独立于 `isHovered`**。
2. **布局分区**：左侧 `preIconButton + iconview + HeaderTextElems` 包进 `.left-zone`；两个 icon 组变成 `.grp-left` / `.grp-right` + `.pinned`，由 CSS 按 `data-latched` 揭示。
3. **宽度预算求解器**（`plan()` 纯函数）：给定块宽 + 方向 + 视图场景，算出 `{shown, hidden, mode}`，保证 `shown + hidden === total`。溢出进 `…` 菜单 / tier4 进浮层。

## 3. 锁存状态机

### 3.1 状态与事件（纯函数）

```ts
// frontend/app/block/header-hover-latch.ts（新文件，无 DOM / 无 React 依赖）

export type HoverZone = "left" | "right" | null;

export type HoverLatchState = {
    zone: HoverZone;
    pendingReset: boolean;   // 已 LEAVE，宽限定时器在跑
    frozen: boolean;         // 溢出菜单 / 浮层打开
};

export type HoverLatchEvent =
    | { type: "ENTER"; x: number; mid: number }
    | { type: "LEAVE" }
    | { type: "RESET" }        // 宽限定时器到期
    | { type: "FREEZE" }
    | { type: "UNFREEZE" };

export const NeutralLatch: HoverLatchState = { zone: null, pendingReset: false, frozen: false };

/** 纯函数：无副作用、无 DOM、可穷举单测。 */
export function reduceHoverLatch(st: HoverLatchState, ev: HoverLatchEvent): HoverLatchState {
    switch (ev.type) {
        case "ENTER":
            if (st.frozen) return st;
            if (st.zone) return { ...st, pendingReset: false };      // 宽限内回来 → 沿用原方向
            return { zone: ev.x < ev.mid ? "left" : "right", pendingReset: false, frozen: false };
        case "LEAVE":
            if (st.frozen || !st.zone) return st;
            return { ...st, pendingReset: true };
        case "RESET":
            if (st.frozen || !st.pendingReset) return st;
            return { ...NeutralLatch };
        case "FREEZE":
            return { ...st, frozen: true, pendingReset: false };
        case "UNFREEZE":
            return { ...NeutralLatch };
    }
}
```

**关键性质（可单测）**：`reduceHoverLatch` 对 `ENTER` 之外的任何事件都不读 `x` —— 这就是"`pointermove` 不参与分区"的类型级保证。**没有 `MOVE` 事件类型**，所以谁也无法误用。

### 3.2 React 侧接线（`blockframe-header.tsx`）

新增 hook `useHeaderHoverLatch()`：

```ts
const [latch, setLatch] = React.useState<HoverLatchState>(NeutralLatch);
const resetTimerRef = React.useRef<number | null>(null);
const latchRef = React.useRef(latch);
latchRef.current = latch;

const cancelReset = React.useCallback(() => {
    if (resetTimerRef.current != null) { window.clearTimeout(resetTimerRef.current); resetTimerRef.current = null; }
}, []);

const apply = React.useCallback((ev: HoverLatchEvent) => {
    const next = reduceHoverLatch(latchRef.current, ev);
    latchRef.current = next;
    setLatch(next);
    if (ev.type === "ENTER" || ev.type === "FREEZE" || ev.type === "UNFREEZE") cancelReset();
    if (next.pendingReset) {
        cancelReset();
        resetTimerRef.current = window.setTimeout(() => {
            resetTimerRef.current = null;
            apply({ type: "RESET" });
        }, graceMs);
    }
}, [graceMs, cancelReset]);

// 卸载清理
React.useEffect(() => () => cancelReset(), [cancelReset]);
```

接线点（**只加，不改既有 `isHovered` 逻辑**）：

| 元素 | 事件 | 动作 |
|---|---|---|
| `.block-frame-default-header` | `onPointerEnter` | `apply({type:"ENTER", x: e.clientX, mid: rect.left + rect.width/2})` —— 用 `e.currentTarget.getBoundingClientRect()` |
| 同上 | `onPointerLeave` | `apply({type:"LEAVE"})` |
| 同上 | **不加** `onPointerMove` | ← 这是核心 |
| 溢出菜单容器 | `onPointerEnter` | `apply({type:"FREEZE"})` + 菜单内部 hover 不触发 LEAVE |
| 同上 | 关闭时 | `apply({type:"UNFREEZE"})` |
| 浮层工具条 | 同菜单 | 同上 |

**FROZEN 的 `pointerleave` 处理（已实测修正）**

实测（`verify-runs/_probe/order2.*`，Playwright + Edge）—— 菜单 portal 到 body、与 header 互为兄弟时：

```
hdr:pointerenter
hdr:pointerleave related=DIV        ← 先到
menu:pointerenter related=hdr       ← 后到
```

**与直觉相反：header 的 `pointerleave` 先触发。** 所以“靠菜单 `pointerenter` 先 FREEZE” 不成立，宽限定时器已在 `LEAVE` 时启动。

**双层防护（两层都要，缺一不可）**：

1. **`pointerleave` 里直接查 `relatedTarget`（主路径）**：
   ```ts
   onPointerLeave={(e) => {
       const rt = e.relatedTarget;
       if (rt instanceof Node && (overflowMenuElRef.current?.contains(rt) || flyoutElRef.current?.contains(rt))) {
           return;   // 指针是去菜单，不是离开会话 → 不发 LEAVE
       }
       apply({ type: "LEAVE" });
   }}
   ```
   实测 `relatedTarget` 可用且指向菜单根 `DIV`，所以这层是可靠的。
2. **`FREEZE` 必须取消已启动的定时器（兜底层）**：`apply()` 对 `ENTER`/`FREEZE`/`UNFREEZE` 一律 `cancelReset()`，且 `reduceHoverLatch` 在 `FREEZE` 时把 `pendingReset` 置 `false`。即使第 1 层漏判（`relatedTarget` 为 `null` 或菜单刚挂载），定时器也会被拆掉。

**必须写进单测的边界**：`graceMs === 0` 时第 2 层失效（`LEAVE` 后定时器立即到期回 `NEUTRAL`），所以**只有第 1 层能保护 graceMs=0 的 FROZEN 场景**。
单测用例：`{graceMs: 0}` + `LEAVE` + `RESET` 后 `FREEZE` → 不能恢复 zone（已丢失）；因此在 `graceMs=0` 时必须依赖 `relatedTarget` 判据，不能只靠 FREEZE。

### 3.3 与 `isHovered` 的关系

**完全独立**，两者并行：

- `isHovered`：控制 reveal 区默认显隐（既有 2000ms 延迟）+ `claimInfoCard` + 悬浮卡 300ms 收起。**一行不改**。
- `hoverLatch`：控制"哪一侧展开"。**不参与** `claimInfoCard`。

`HeaderEndIcons` 的 reveal 显隐从 `.is-hovered` 改为 `[data-latched="right"]` 驱动；但为了不破坏 `isHovered` 的其他消费点，**保留 `.is-hovered` 规则作为 fallback**（开关 `block:headersplitreveal=false` 时仍生效）。

## 4. 布局与 CSS

### 4.1 DOM 重排

```tsx
<div className="block-frame-default-header" data-latched={latch.zone ?? ""} data-tier={plan.tier}>
    <div className="left-zone">
        {!useTermHeader && (
            <>
                {preIconButton && <IconButton decl={preIconButton} className="block-frame-preicon-button" />}
                <div className="block-frame-default-header-iconview">…</div>
            </>
        )}
        {manageConnection && <ConnectionButton … />}
        <HeaderTextElems … />
    </div>
    {startIconButtons?.length > 0 && <div className="grp grp-left">{startIconButtons.map(…)}</div>}
    <div className="grp grp-right">{revealDecls.map(…)}</div>
    <div className="pinned">{pinnedDecls.map(…)}</div>
    {overflow && <IconButton decl={moreDecl} className="ibtn-overflow" />}
</div>
```

**约束**：`.left-zone` 必须包住 `preIconButton + iconview + ConnectionButton + HeaderTextElems`，因为右锁让位时要一起收。`ConnectionButton` 有既有定位逻辑，需单独确认（见 §9 风险）。

### 4.2 CSS（`block.scss` 新增段落，不改既有规则）

```scss
// ── 锁存分区：左组 / 右组 / pinned ──────────────────────────────────
.block-frame-default-header {
    .left-zone {
        display: flex; align-items: center; gap: 8px;
        min-width: 0; flex: 1 1 auto;
        // 让位用 max-width 过渡（不用 display:none，避免 focus 丢失与 reflow 跳变）
        max-width: 100%;
        transition: max-width .15s ease, opacity .13s ease;
        overflow: hidden;
    }
    .grp { display: none; align-items: center; column-gap: 2px; flex: 0 0 auto; }
    .grp:empty { display: none !important; }
    .grp.on { display: flex; }
    .grp-right { margin-left: auto; }
    .pinned { display: flex; align-items: center; column-gap: 2px; flex: 0 0 auto; }

    // 右锁让位：chevron + 路径收起，只留类型图标
    &[data-latched="right"].yielded {
        .left-zone { flex: 0 0 auto; }
        .block-frame-preicon-button, .block-frame-text-elems-wrapper { display: none; }
        .block-frame-default-header-iconview { flex-shrink: 0; }
    }

    // tier 3/4：header 只留类型图标 + …
    &[data-tier="3"] .left-zone > :not(.block-frame-default-header-iconview) { display: none; }
    &[data-tier="4"] .left-zone > :not(.block-frame-default-header-iconview) { display: none; }
}
```

**为什么用 `max-width` 而非 `display:none`**：`display:none` 会让路径文本脱离布局导致右组瞬间左跳（视觉抖动），且键盘 focus 链会断。`max-width: 0` 过渡保留元素与 focus 能力，只是不可见。

### 4.3 宽度预算求解器（`plan()` 纯函数）

```ts
// frontend/app/block/header-icon-plan.ts（新文件）

export const HeaderIconPx = 24;
export const HeaderIconGapPx = 2;
export const HeaderPadPx = 12;      // padding 4px 5px 4px 7px → 左 7 + 右 5
export const HeaderTypeIconPx = 16;

export type HeaderIconPlan = {
    tier: 0 | 1 | 2 | 3 | 4;
    yieldLeft: boolean;
    shown: string[];        // 留在 header 的 icon key
    hidden: string[];       // 进溢出菜单 / 浮层
    mode: "idle" | "left" | "overflow" | "flyout";
};

export function tierFor(w: number, total: number): 0|1|2|3|4 { … }
export function planHeaderIcons(w: number, zone: HoverZone, scene: HeaderIconScene): HeaderIconPlan { … }
```

`HeaderIconScene` 描述某视图的 icon 分组与优先级，由 `blockframe-header.tsx` 从真实 `IconButtonDecl[]` 构造（不是硬编码）。

**不变量（单测强制）**：`plan.shown.length + plan.hidden.length === scene.total`，`w ∈ [40..900] step 2` × `zone ∈ {left, right}` 全跑。

## 5. 数据契约变更

### 5.1 `IconButtonDecl` 扩展（`frontend/types/custom.d.ts`）

```ts
type IconButtonCommon = {
    …
    zone?: "pinned" | "reveal" | "start";   // 新增 "start" = 左组
    priority?: number;                       // 越大越先被收进溢出，默认 0
    neverOverflow?: boolean;                 // 永不被削尾（… / vcs / close）
};
```

### 5.2 `ViewModel` 新增 atom

```ts
// frontend/types/custom.d.ts
startIconButtons?: jotai.Atom<IconButtonDecl[]>;   // 对称 endIconButtons
```

### 5.3 `preview-model.tsx` 迁移

把 `viewText` children 里这几个从"文本元素"改为"左组 icon"：

| 现在 | 位置 | 迁移到 |
|---|---|---|
| `Go to Path`（`folder-open`） | `viewText` 的 `preview-filename-shell` children | `startIconButtons` |
| 列表/树切换（`☰/🌳`） | `viewText` children（`isDirectoryView` 时） | `startIconButtons` |
| 打开方向 menubutton | `viewText` children | `startIconButtons`（menubutton 保持类型，只换容器） |
| HTML 打开方式 menubutton | `viewText` children | `startIconButtons` |
| Preview menubutton | `viewText` children | `startIconButtons` |
| 滚动同步 iconbutton | `viewText` children | `startIconButtons` |

**保留在 `viewText`**：`copytext`（文件名）、`exportStatus` 文本、`is-dirty` 样式 —— 这些是"路径显示"不是"icon"，且路径本身是让位对象。

**风险**：`preview-filename-shell` 的 hover-reveal（`.preview-filename-copy-button` 的 opacity 过渡）依赖父子结构。迁移 `Go to Path` 出 `preview-filename-shell` 会破坏"悬浮文件名才浮现"的效果。**决策**：`Go to Path` **留在** `preview-filename-shell`（它是"路径的附属"而非"左组常驻"），只有其余 5 个迁到 `startIconButtons`。

## 6. 设置项落地（六处同步）

`block:headersplitreveal` / `block:headeryieldleft` / `block:headernarrowtier` / `block:headerhoverlatch` / `block:headerhovergrace`

| 文件 | 改动 | 是否生成产物 |
|---|---|---|
| `pkg/wconfig/metaconsts.go` | 5 个 `ConfigKey_*` 常量 | 源 |
| `pkg/wconfig/settingsconfig.go` | 4 个 `*bool` + 1 个 `*float64` 字段（带 json tag） | 源 |
| `pkg/wconfig/defaultconfig/settings.json` | 4 个 `true` + `"block:headerhovergrace": 400` | 源 |
| `schema/settings.json` | 由 `task build:schema` 生成 | **产物** |
| `frontend/types/gotypes.d.ts` | 由 `task generate` 生成 | **产物** |
| `frontend/app/block/blockenv.ts` | `getSettingsKeyAtom` 联合类型加 5 个 key | 源（手改） |

**生成链**：`pkg/wconfig/*.go` → `task build:schema` → `dist/schema/**` → 拷贝到 `schema/`；`pkg/**/*.go` → `task generate` → `cmd/generatets` 写 `frontend/types/gotypes.d.ts`。

**所以只改三个源文件**（`metaconsts.go` / `settingsconfig.go` / `defaultconfig/settings.json`）+ 手改 `blockenv.ts`，然后跑：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; node scripts/run-task.mjs generate"
```

跑完 `git diff --stat` 确认 `schema/settings.json` 与 `frontend/types/gotypes.d.ts` 的 diff **只含这 5 个 key**，不多不少。

## 7. 影响面与风险

| 面 | 影响 | 处置 |
|---|---|---|
| `blockframe-header.tsx` | 全 block 共用 header | 主战场；新增 hook + `data-latched` + `.left-zone` 包裹 |
| `useTermHeader` 分支（term / agent） | 已有 `!pl-[2px]` 特调、`DurableSessionFlyover`、badge | **不包进 `.left-zone`**（`{!useTermHeader && …}` 分支已隔离），只让 `data-latched` 存在但不驱动布局；开关关闭时行为完全不变 |
| `aisessions` 自定义 `endIconButtons` | 无 `priority` → 默认 0 → 最后被削尾；`auto-refresh` 宽度 `auto` | 给 `auto-refresh` 与 `audit` 补 `priority: 1`（比 reveal 组先收），并确认 `width:auto` 元素在 `plan()` 里按 `26px` 估算（估算偏小会溢出） |
| `ConnectionButton` | 被包进 `.left-zone` | 它有独立定位/宽度逻辑，需真机确认让位时不错位；若冲突则让它待在 `.left-zone` 之外 |
| `isHovered` / `claimInfoCard` | 与悬浮卡耦合 | 一行不改；锁存独立 state |
| `vcs` 面板 header | 自带 `endIconButtons` | 只吃默认 `priority: 0`，行为不变 |
| `block.scss` 既有 `.is-hovered` 规则 | reveal 显隐 | 保留作为 fallback（开关关闭路径） |

## 8. 验证设计

新增 area `scripts/verify/header-hover-latch/`（复用 `lib/{cdp,launch,probes,report,pixel}.mjs`，不写第二份 CDP client）：

| 断言名 | 做法 |
|---|---|
| `header-visible-no-clip` | 逐档宽度（40…520），`getBoundingClientRect` 比对 header rect，被切数必须 0 |
| `header-reach-invariant` | 可见数 + 菜单项数 + 浮层项数 === total |
| `header-latch-no-flip` | `pointerenter` @80% → 沿全部可见 `.ibtn` 逐个 `Input.dispatchMouseEvent` → 读 `data-latched` 恒为 `right` |
| `header-grace-keep` | leave → 200ms 内从左侧 enter → `data-latched` 仍 `right` |
| `header-grace-expire` | leave → 700ms → 从左侧 enter → `data-latched` 为 `left` |
| `header-isHovered-independent` | 锁存为 `left` 时悬浮卡仍按原逻辑出现/收起 |
| `header-yield-left-frees-width` | 右锁时 `.left-zone` 宽度 < 中性时宽度 |

台账追加到 `docs/project/verify-ledger.md` 一行。

## 9. 落地顺序（与 implement.md 对齐）

1. 纯函数层（`header-hover-latch.ts` + `header-icon-plan.ts`）+ 单测 —— 无 UI 风险，先绿。
2. `IconButtonDecl` 扩展 + `startIconButtons` atom（类型层，零行为变化）。
3. `blockframe-header.tsx` 接线（`hoverLatch` hook + `data-latched` + `.left-zone`）。
4. `block.scss` 分区规则 + 让位过渡。
5. `preview-model.tsx` 迁 5 个 icon 到 `startIconButtons`。
6. 溢出菜单 / tier4 浮层。
7. 设置项六处同步。
8. verify area + 台账。

## 10. 回滚

- 运行期：`block:headersplitreveal=false` → 完全退回旧行为（`.is-hovered` 规则仍在）。
- 代码级：`header-hover-latch.ts` / `header-icon-plan.ts` 是**纯新增文件**，`blockframe-header.tsx` 的改动集中在三处（hook 调用、`.left-zone` 包裹、`data-latched`），可单 commit revert。
