# Design — SplitButton 控件 + CommonText Send 弹层层叠修复

## 1. 层叠上下文根因与修法

```
body (stacking context)
├─ .flex.flex-col.w-full.h-full  (React root, static, z:auto → 非层叠上下文)
│   └─ .modal-wrapper  position:fixed; z-index:500   ← 弹窗
└─ <div class="fixed inset-0">  (现 Portal 遮罩, z:auto)
    └─ popover shell  z-index:1000                     ← 被 z:auto 父层困死，压在 500 之下
```

- `position:fixed` + `z-index:auto` 自成层叠上下文（Chrome 对 fixed 一律建层），内部 z-1000 无法逃逸。
- 修法：**不再自建 `fixed inset-0` 遮罩**。改用 floating-ui 的 `FloatingPortal`：
  它向 `document.body` 追加的是**无定位样式**的普通 div（非层叠上下文），floating 子元素
  `zIndex:1000` 直接参与 body 层叠上下文 → 稳定压过 `.modal-wrapper`(500)。
  外点关闭交给 `useDismiss`（document pointerdown + reference/floating 包含性判断），
  不再需要全屏遮罩（遮罩正是困死 z-index 的元凶）。

## 2. 新控件 `frontend/app/element/splitbutton.tsx` + `splitbutton.scss`

### API

```tsx
type SplitButtonProps = {
    icon?: React.ReactNode;            // 主段图标
    label: React.ReactNode;             // 主段文字
    onPrimaryClick: () => void;
    primaryTitle?: string;              // 主段 tooltip
    primaryDisabled?: boolean;
    caretTitle?: string;               // caret tooltip
    caretAriaLabel?: string;
    open: boolean;                      // 受控开关
    onOpenChange: (open: boolean) => void;
    menuWidth?: number;                 // 弹层宽度（默认 380）
    menuClassName?: string;             // 弹层附加 class（内容定制）
    menuLabel?: string;                 // aria-label
    placement?: Placement;              // 默认 "bottom-end"
    children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
    className?: string;                 // 容器附加 class
};
```

### 结构与行为

```
<div class="wave-split-button" ref={setReference} data-split-button>
  <button class="wave-split-button__main"  onClick={onPrimaryClick}>…icon + label</button>
  <span  class="wave-split-button__divider" />
  <button class="wave-split-button__caret"  aria-haspopup="menu" aria-expanded={open}
          onClick={toggle} onKeyDown={Enter/Space/ArrowDown→open}>
    <i class="fa-solid fa-chevron-down" />
  </button>
  {open && (
    <FloatingPortal>
      <div ref={setFloating} style={{...floatingStyles, zIndex: "var(--zindex-popover, 1000)", width}}
           class="wave-split-button__menu" role="menu" aria-label={menuLabel}
           data-split-button-menu>
        {typeof children === "function" ? children({close}) : children}
      </div>
    </FloatingPortal>
  )}
</div>
```

- `useFloating({ placement, strategy:"fixed", open, onOpenChange, middleware:[offset(6), flip(), shift({padding:8})] })`
- `useDismiss(context, { escapeKey:true, outsidePress:true })` + `useInteractions`；floating 层拿 `getFloatingProps()`。
- 手动 caret 开关（不用 `useClick`，否则主段点击也会开菜单）。
- 关闭后焦点还回 caret（useDismiss 自带 focus 返还）。
- 主段 disabled 时仅主段半透明禁点，caret 保持可用（仍可打开改配置）。

### 视觉（splitbutton.scss，全部语义 token）

- 容器：`inline-flex; height:32px; border-radius:6px; background:var(--button-grey-bg);`
  `align-items:stretch;`；hover 容器背景 `var(--button-grey-hover-bg)`。
- 段：`background:transparent; border:0; padding:0 12px; color:var(--main-text-color);`
  `font-size:13px; display:flex; align-items:center;`——两个段在同一壳里，无对不齐/缝隙问题。
- 分隔线：`width:1px; align-self:stretch; margin:7px 0;`
  `background:color-mix(in srgb, var(--main-text-color) 16%, transparent);`
  hover 容器时略加深（22%）。
- caret 段 hover/open：`background:color-mix(in srgb, var(--accent-color) 12%, transparent)`；
  open 时 chevron 旋转 180°（transition transform .15s）。
- focus-visible：单段 `outline:1px solid var(--accent-color); outline-offset:-1px;`
- disabled：`opacity:.5; pointer-events:none`（仅主段）。

## 3. `commontext-send-button.tsx` 重构

- `CommontextSendButton` 用新 `<SplitButton>`：主段 = quickSend + `Send` + paper-plane 图标 + hint title；
  caret 段打开目标选择弹层；`open/onOpenChange` 用组件内 state（同现状）。
- 删除 `Portal` + `popoverShellClass` + 手工 anchorRect 定位 + 全屏遮罩。
- popover 面板内容整体作为 `children({close})` 塞入（保留 380px 宽、各分区、data 属性：
  `data-commontext-send-popover` 移到 floating 层容器上，verify 台选择器不变）。
- 二级 Type/Folder 菜单（`PickerMenu`）改为**面板内 anchored 菜单**：
  触发行外套 `relative` 容器，菜单 `absolute left-0 right-0 top-[calc(100%+4px)] z-20`，
  挂 `data-commontext-send-picker`。不再 portal、不再全屏遮罩；点菜单外（面板内任意处）关闭交给
  一个面板级 `onPointerDownCapture` 判断。浮出方向只向下；面板无 overflow 裁剪，
  菜单可越出面板底边（floating 层本身就是 body 定位，不会裁剪）。
- 菜单关闭时机收敛：选中项 → 关菜单；Escape → 关菜单（面板开时优先关菜单）。

## 4. verify 台升级（防假绿）

`scripts/verify/commontext-send-agent-block/verify.mjs`：

- 新增 `realClick(client, x, y)`：`Input.dispatchMouseEvent` mouseMoved→mousePressed→mouseReleased。
- 断言链改为真实指针：
  1. 打开弹窗后 `elementFromPoint(caret)` 必须 `closest('[data-split-button]')` 命中 caret 段；
  2. 真实点击 caret → `[data-commontext-send-popover]` 存在 **且** `elementFromPoint(popover 中心)`
     落在 popover 内（`popover.contains(hit)`）——这就是昨晚假绿漏掉的可视性断言；
  3. 真实点击 Type 触发行 → `[data-commontext-send-picker]` 存在且 elementFromPoint 命中；
  4. 真实点选「新建 Tab」/Folder 项 → 主行选中态变化；
  5. 面板外真实点击 → popover 关闭；Escape → 关闭。
- 截图：02-popover（含二级菜单展开）在 light/dark 各留一张。
- 注入/建块链路断言保留原 7-8 步不动。

## 5. 风险与回滚

- 风险 A：floating-ui 在 jsdom 下测量为 0 → 菜单位置错：strategy fixed + flip/shift 已兜底；
  单测只断言存在性/zIndex，不测坐标。
- 风险 B：二级菜单 absolute 越出面板底边被未来某处 overflow 裁剪：面板容器不加 overflow；
  verify 台截图断言覆盖。
- 风险 C：useDismiss outsidePress 与 modal 内其他 mousedown 监听冲突：useDismiss 用 pointerdown +
  包含性判断，与 app.tsx 的 macOS first-click 逻辑（仅 focus 后 50ms 内）无交集。
- 回滚：改动集中在 3 个新/改文件 + verify 脚本，单 commit revert 即可。

## 6. 验证命令

```powershell
node scripts/run-task.mjs test --filter splitbutton        # 新控件单测（或 vitest 直跑）
node scripts/verify/commontext-send-agent-block/verify.mjs # 真机全链路（真实指针）
```
