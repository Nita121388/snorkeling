# Design — 路径选择浮窗滚动契约统一

## 1. Change Boundary（before-dev step 7）

**Smallest behavior gap**

- 现状：New Terminal / New Agent 目标选择浮窗的路径列表没有高度约束，浮窗随 tab 内
  块数线性增高；超出视口后由 floating-ui `size` middleware 的内联 `overflowY:auto`
  兜底，滚的是**整个浮窗**（标题 / 芯片 / footer 一起滚走）。
- 目标：路径列表限高 + 自滚；浮窗本身不滚；New Files 与两者对齐。

**Where the behavior actually lives**

| 关注点 | 唯一落点 |
|---|---|
| 浮窗根节点骨架 + 内联 maxHeight/overflow | `frontend/app/workspace/widgets.tsx` 的 `useFloating`（Agent `:637-661`，Terminal `:1371-1395`） |
| 路径列表 DOM | 同文件 `AgentTargetFloatingWindow` `:1117-1200`、`TerminalTargetFloatingWindow` `:1447-1525` |
| 参照实现（正确范式） | `frontend/app/view/preview/preview-new-files.tsx:142`（根）/ `:167`（滚动容器） |
| Files 浮窗定位 | `frontend/app/view/preview/preview-new-files.tsx:44-52`（`useFloating`，当前只有 `offset(8)`） |

**Files expected to change**

| 文件 | 为什么必须改 |
|---|---|
| `frontend/app/workspace/widgets.tsx` | 两处 `useFloating` 的 `size` middleware；两处路径列表 DOM；两处根节点 class |
| `frontend/app/view/preview/preview-new-files.tsx` | 根节点上限改为视口相关；middleware 补 `flip`/`shift` |

**Explicitly NOT doing**

- 不动路径数据来源（`agent-launch.ts` 的 target 收集逻辑）
- 不动右侧 WidgetsBar 的 widget 行为编排（`handleWidgetSelect` / `handleWidgetHover`）
- 不动组「＋」菜单（`inlinetab-addmenu.tsx`）——那是任务 `10-21-files-group-addmenu-popup`
- 不加键盘导航、不加 sticky 分区标题

**Local refactor safety**

- 改动集中在 class 字符串与一段 middleware `apply`，无状态/无数据流变更。
- `AgentTargetFloatingWindow` 与 `TerminalTargetFloatingWindow` 是两个独立组件，
  改法完全对称，但**分别改**（不抽公共组件）：两者的 chrome 段结构不同
  （Agent 多出 agent-type / vendor 两段芯片），抽组件的收益低于耦合成本。

---

## 2. 关键技术点

### 2.1 参照范式（New Files 为什么是对的）

```jsx
// preview-new-files.tsx:142 —— 根节点
className="... max-h-[500px] overflow-hidden flex flex-col"
// preview-new-files.tsx:167 —— 唯一的滚动容器
className="flex-1 overflow-y-auto px-1 py-1 min-h-0"
```

三段式：`header / scrollable content / footer`，footer 不随内容滚动。
正是 `docs/design-system.md:194` 规定的 dialog 布局。

### 2.2 为什么 `flex-1 min-h-0` 在「高度由内容决定」的列向 flex 容器里不会塌成 0

`flex-1` = `flex: 1 1 0%`。百分比 basis 在**容器主轴尺寸不定**时按内容解析：

1. 容器 `height:auto` + `max-height` → 内在高度 = 各 item 假想主尺寸之和
   （列表的 basis 按内容算 → 列表内容高度）；
2. 容器高度受 `max-height` 压制 → flex 收缩阶段，列表（`flex-shrink:1`，
   `min-height:0` 因 `overflow-y:auto` 允许缩到 0）吸收全部负空间；
3. 结果：**列表变成滚动容器，容器自身不溢出**。

Chrome 段必须 `shrink-0`，否则收缩时会被一起压扁。

### 2.3 「整个弹窗滚动」的直接根因

floating-ui `size` middleware 的 `apply` 写的是**内联样式**：

```js
elements.floating.style.maxHeight = `${Math.max(availableHeight, 120)}px`;
elements.floating.style.overflowY = "auto";
```

内联样式**压过** class。但真正让整窗滚动的是**根节点不是 flex 容器**：
非 flex 容器不会把溢出量分给某个子项，列表内容多高根就多高，
`availableHeight`（≈ 视口高）封顶后根节点溢出 → 整窗滚动（连标题/芯片/footer 一起滚走）。

改成 `flex flex-col` + 列表 `flex-1 min-h-0` 后，溢出量被列表吸收：

| 场景 | 根节点 | 列表 |
|---|---|---|
| 内容 ≤ 上限 | 不溢出，**不滚** | 内容原高（≤ 320px） |
| 内容 > 上限但 chrome 放得下 | 列表被压矮 → **根不滚** | 内部滚动 |
| 视口矮到 chrome 都放不下 | 根溢出 → 整窗滚（退化兜底） | 内部滚动 |

因此 `apply` 里的内联 `overflowY = "auto"` **保留**作为最后一道退化兜底：
正常情况下它永远不生效（看起来就是「不滚」），只有极端矮视口才让根真的可滚，
保证 footer 按钮不被裁掉且仍可达。

### 2.4 Files 不能引入 `size` middleware

若给 Files 加 `size`，其 `apply` 同样会写内联 `overflowY:auto`，
把 Files 从「正确范式」打回「整个浮窗滚动」。视口上限用纯 CSS
`max-h-[min(500px,calc(100vh-32px))]` 即可，不需要 middleware。

---

## 3. 具体改动

### 3.1 `frontend/app/workspace/widgets.tsx`

#### (a) 根节点骨架（Agent `:886`，Terminal `:1436`）

```diff
- className="bg-modalbg/80 backdrop-blur-2xl border border-border/70 rounded-xl shadow-2xl z-50 min-w-[400px] max-w-[520px] overflow-visible"
+ className="bg-modalbg/80 backdrop-blur-2xl border border-border/70 rounded-xl shadow-2xl z-50 min-w-[400px] max-w-[520px] flex flex-col overflow-hidden"
```

#### (b) `size` middleware 的 `apply`（Agent `:646-654`，Terminal `:1379-1387`）

```diff
  apply({ availableHeight, elements }) {
-     // ponytail: 120px floor keeps the panel scrollable in pathological viewports;
-     // it must stay well below real content height so the clamp actually wins.
-     elements.floating.style.maxHeight = `${Math.max(availableHeight, 120)}px`;
-     elements.floating.style.overflowY = "auto";
+     // ponytail: 120px floor keeps the panel scrollable in pathological viewports;
+     // it must stay well below real content height so the clamp actually wins.
+     // 640px 是内容自然高度的硬上限；浮窗不再承担滚动：内层路径列表自己滚
+     // （overscroll-contain），标题 / 芯片 / footer 固定不动。
+     // overflowY 仍留 auto 作退化兜底：根节点是 flex 列 + 列表 flex-1/min-h-0，
+     // 正常情况下溢出量被列表吸收（根不滚）；只有视口矮到 chrome 段都放不下时，
+     // 根才会真的溢出并可滚，保证 footer 按钮仍可达。
+     elements.floating.style.maxHeight = `${Math.max(Math.min(availableHeight, 640), 120)}px`;
+     elements.floating.style.overflowY = "auto";
  }
```

#### (c) 路径列表 DOM（Agent `:1117-1200`，Terminal `:1447-1525`）

Agent 版（Terminal 版去掉 `Select a path.` 标题段）：

```diff
  {/* path list */}
- <div className="px-1 pb-1">
-     <div className="px-2 pt-2 pb-1 text-xxs text-muted">Select a path.</div>
-     {targets.length === 0 ? (
-         <div className="px-3 py-4 text-xs text-muted text-center">No paths found</div>
-     ) : (
-         targets.map((target, idx) => { ... })
-     )}
+ <div className="px-1 pb-1 flex flex-col min-h-0">
+     <div className="px-2 pt-2 pb-1 text-xxs text-muted shrink-0">Select a path.</div>
+     <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain max-h-[min(320px,40vh)]">
+         {targets.length === 0 ? (
+             <div className="px-3 py-4 text-xs text-muted text-center">No paths found</div>
+         ) : (
+             targets.map((target, idx) => { ... })
+         )}
+     </div>
  </div>
```

#### (d) chrome 段 `shrink-0`

- Agent：header（`:872`）、agent-type 芯片区（`:899`）、vendor 芯片区（`:973`）、
  Pi「启动方式」段（`:1088`）、footer（`:1198`）→ 各加 `shrink-0`。
- Terminal：header（`:1443`）、footer（`:1519`）→ 各加 `shrink-0`。

### 3.2 `frontend/app/view/preview/preview-new-files.tsx`

```diff
- className="... min-w-[400px] max-w-[480px] max-h-[500px] overflow-hidden flex flex-col"
+ className="... min-w-[400px] max-w-[480px] max-h-[min(500px,calc(100vh-32px))] overflow-hidden flex flex-col"
```

```diff
- import { useFloating, FloatingPortal, offset, useDismiss, useInteractions } from "@floating-ui/react";
+ import { useFloating, FloatingPortal, offset, useDismiss, useInteractions, flip, shift, limitShift } from "@floating-ui/react";
```

```diff
- middleware: [offset(8)],
+ middleware: [offset(8), flip(), shift({ padding: 12, limiter: limitShift() })],
```

---

## 4. 参数取值

| 参数 | 取值 | 理由 |
|---|---|---|
| Terminal/Agent 列表上限 | `min(320px, 40vh)` | 一行 ≈ 38px → 320px ≈ 8 行；`40vh` 保证矮屏不超过半屏 |
| Terminal/Agent 浮窗硬上限 | `min(availableHeight, 640px)` | Agent chrome ≈ 200px + 列表 320px ≈ 520px，640 不误伤正常内容 |
| Files 浮窗上限 | `min(500px, calc(100vh-32px))` | 保持现有 500px 观感，补视口约束（左右各留 16px） |
| overscroll | `contain` | 列表滚到底不外溢到浮窗/页面，消除「滚着滚着整个弹窗动了」 |

---

## 5. 边界情况

| 场景 | 行为 |
|---|---|
| 0 条路径 | `No paths found` 在滚动容器内，容器高度自适应，无空滚动条 |
| ≤ 8 条 | 列表不滚动，外观与改动前完全一致 |
| 远端路径（双行 `target.label`） | 行高更高、行数变少；上限逻辑不变 |
| vendor 芯片把 chrome 撑高 | chrome `shrink-0`，列表先被压缩；视口极小则列表可压到 0（与 120px 地板同级） |
| `availableHeight` 逼近 120px 地板 | chrome 段（≈200px）放不下 → 根节点真的溢出 → 内联 `overflowY:auto` 兜底，整窗可滚，footer 按钮仍可达 |
| 居中模式（`centered=true`） | `translate(-50%,-50%)` 定位不变；同一套根节点改造生效 |
| 组「＋」二级浮窗 | 复用同一组件，随 §3.1 一起修好 |

---

## 6. 兼容与回滚

- **向后兼容**：无 API / RPC / 配置键 / 数据模型改动，纯 class + middleware 调整。
- **回滚形状**：单文件 revert 即可；§3.1 与 §3.2 相互独立，可分别回滚。
- **不做 feature flag**：改动面小、可视化验证、无数据迁移。

---

## 7. 验证方式

1. **CDP 实测**（Electron 带 `--remote-debugging-port=9222`）：
   `node scripts/inspect-electron-ui.mjs state` / `elements` / `style`，
   核对列表 `clientHeight` vs `scrollHeight`、`overflowY`、根节点 `overflowY`、
   根节点 `maxHeight`。
2. 造 ≥ 15 块的 tab → New Terminal / New Agent：高度恒定 ≤ 640px，列表出滚动条，
   footer `getBoundingClientRect()` 在滚动前后不变。
3. 列表内滚到底继续滚 → 浮窗与页面不跟着动。
4. `npx vitest run frontend/app/workspace frontend/app/view/preview frontend/app/block`。
5. `npx tsc --noEmit`。
