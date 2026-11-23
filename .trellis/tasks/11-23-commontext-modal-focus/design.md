# Design: 弹窗焦点两层收口

## 1. modalOpen 的来源统一（registry）

现状有两个写入者语义：`ModalsRenderer`（栈长度）与 `tab-target-modal`（自己挂载/卸载写 true/false）。
直接给 `Modal` 也写同一个 atom 会出现互相覆盖（栈关一个就写 false，把直接渲染的弹窗抹掉）。

新增 `frontend/app/modals/modal-open-registry.ts`（无 store 依赖的纯模块 + 一个 React hook）：

```ts
type Sink = (open: boolean) => void;
const sources = new Set<string>();
let sink: Sink | null = null;

export function setModalOpenSource(key: string, open: boolean): void   // open=false → delete
export function bindModalOpenSink(fn: Sink | null): void               // 绑定即回放当前状态
export function modalOpenAny(): boolean
export function modalOpenSourceKeys(): string[]                        // 测试用
export function resetModalOpenRegistryForTest(): void
export function useModalOpenSource(open: boolean, keyHint?: string): void // hook：挂载期 claim，卸载 release
```

约定：

- key 名义上唯一（`Modal` 用 `useId()` 派生；`ModalsRenderer` 用 `"modals-stack"`；
  `tab-target-modal` 用 `"tab-target-modal"`）。
- `bindModalOpenSink` 只在 `app.tsx` 调一次：`globalStore.set(atoms.modalOpen, open)`。
  绑定前已有 source 时立即回放，避免首个弹窗打开却没人写 atom。
- 卸载/异常路径必须 release：hook 用 `useEffect` cleanup；`sources` 为 `Set`，重复 release 幂等。

为什么要 sink 而不是让 registry 直接 import `atoms`：`modal.tsx` 被 41 个模块引用，
直接 import `@/app/store/global` 会把整张 store 图拉进每个弹窗消费者（含 jsdom 测试），
收益为零；sink 由 app 层注入，注册侧保持零依赖。

## 2. 外壳不吃指针（modal.scss）

```scss
.modal-wrapper { pointer-events: none; }
.modal-backdrop { pointer-events: auto; }
.modal { pointer-events: auto; }
```

- 现状：wrapper 全屏吃点击，backdrop 从 `top:36px` 开始 → 顶部 36px（tab 栏）被 wrapper 吞掉，
  点它既不切 Tab，也把弹窗内焦点 blur 到 `body`。
- 改后：backdrop 仍接管 y≥36 的"点外部关闭"；顶部 36px 按设计让位给 tab 栏；
  弹窗本体（`.modal`）与所有 portal 子层（z-index > modal）行为不变。

## 3. 弹窗内失焦回焦（CommonText 弹窗）

挂在弹窗内容根节点上的捕获阶段 blur：

```ts
onFocusCapture={(e) => { const t = e.target as HTMLElement;
  if (isEditable(t)) lastEditableRef.current = t; }}
onBlurCapture={(e) => {
  if (e.relatedTarget != null) return;            // 焦点去了弹窗内其它控件：不干预
  const last = lastEditableRef.current;
  if (last == null) return;
  requestAnimationFrame(() => {
    if (!stateRef.current.open) return;
    if (document.activeElement === document.body) last.focus();
  });
}}
```

- 只在"焦点掉到 body"（点死区 / 非可聚焦区域）时回收，不抢用户主动点控件、不抢浮层输入框。
- 关闭弹窗时 `stateRef.current.open` 已为 false，不会把焦点钉在已卸载节点上。

## 4. 详情编辑的合成期守卫

`detailId` 联动 effect（`commontext-compose-modal.tsx` 约 929 行）会在 `cur.id !== state.detailId` 时
重置 `detailTitle/detailText`。合成中重置 = 合成被打断 + 光标丢。改法：

- `detailComposingRef`：textarea `onCompositionStart` 置 true；`onCompositionEnd` 用 rAF 置 false
  （与 composer 的 `handleCompositionEnd` 同口径：先给浏览器一帧把合成结果落地）。
- effect 里若 `detailComposingRef.current === true`：不 setState，把"待校正"记到 `pendingDetailResetRef`；
  rAF 里若仍需要则执行一次。

## 5. emain：窗口回焦补 focus

抽一个方法 `refocusActiveTabWebContents()`：

```ts
const view = this.activeTabView;
if (this.isDestroyed() || view == null) return;
view.webContents.focus();
for (const ms of [10, 30]) setTimeout(() => {
  if (!this.isDestroyed() && this.activeTabView === view && !view.webContents.isFocused()) view.webContents.focus();
}, ms);
```

用到两处：`setActiveTab`（替换现有内联三拍）与 `this.on("focus")`（新增，`getGlobalIsRelaunching()` 时跳过）。
判定逻辑抽成纯函数 `shouldRefocusActiveView({isDestroyed, relaunching, activeIsFocused})` 便于单测。

## 兼容与回滚

| 改动 | 回滚动作 |
| --- | --- |
| registry 接入 `Modal` | 删 `useModalOpenSource` 调用 |
| `.modal-wrapper` pointer-events | 恢复 `auto` |
| 回焦 | 删 onBlurCapture |
| emain 回焦 | 删 `on("focus")` 里的调用 |

## 判据（机器可读）

- `npx vitest run frontend/app/modals/modal-open-registry.test.ts frontend/app/modals/modal.dom.test.tsx`
- `npx vitest run frontend/app/commontext/commontext-compose-modal.dom.test.tsx`
- `npx vitest run emain/emain-window.test.ts`
- 真机：`tmp/ct-diag6.mjs`（本任务新增探针）输出三行断言：`modalOpen=true`、`hit=新建Tab 按钮`、`active=详情 textarea`。
