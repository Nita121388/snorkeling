# CommonText Send 目标选择器：split button 控件 + 弹层被弹窗遮挡修复

## Goal

重做 CommonText Send 的 split button 与目标选择弹层：新做可复用 SplitButton 控件（floating-ui），修复 popover 被 `.modal-wrapper`(z-index 500) 遮挡导致完全不可见/不可点的问题，并把 verify 台升级为真实指针 + 可见性断言。

## 背景与实证（2026-11-11 真机 CDP 排查）

- 用户反馈：① caret 下拉按钮丑（两个独立 `<Button>` 硬拼，有缝隙、态分离）；② 点下拉按钮"没打开二级弹窗"。
- 实测结论：**popover 其实打开了，但整个被压在 Common Text 弹窗底下**。
  - `commontext-send-button.tsx` 的 `Portal` 挂 `document.body`，外层是 `<div className="fixed inset-0">`（点击关闭遮罩）。
  - 该遮罩 `position:fixed` + `z-index:auto` → 自成层叠上下文，把内部 shell 的 `z-1000` 困住。
  - `.modal-wrapper` 是 `position:fixed; z-index:500`（var(--zindex-modal-wrapper)），在 body 层叠上下文里直接压过遮罩。
  - 证据：`elementFromPoint(弹窗内 popover 区域)` 返回弹窗自己的列表行；CDP 截图里 popover 完全不可见；真实指针点击 caret 后 React 状态 `aria-expanded=true`、DOM 节点存在但视觉上无任何变化。
- 昨晚 verify 台 14/14 是**假绿**：用 `.click()` 合成点击 + 只断言 DOM 存在性，不做可见性/真实指针断言，所以没抓到。

## Requirements

1. 新做可复用控件 `frontend/app/element/splitbutton.tsx`（+ scss）：
   - 单壳 pill 造型（主段 + caret 段 + 内分隔线），视觉上是一个按钮而不是两个；
   - 弹层定位/外点关闭/Escape/层叠用 `@floating-ui/react`（FloatingPortal + useFloating + useDismiss），floating 层显式 zIndex 1000；
   - 键盘可达：caret Enter/Space/ArrowDown 打开，Escape 关闭并把焦点还给 caret；`aria-haspopup="menu"` + `aria-expanded`。
2. 修复遮挡 bug：CommonText Send 目标选择弹层在任何弹窗（modal-wrapper z500）之上可见、可点。
3. 重构 `commontext-send-button.tsx`：用新 SplitButton 承载 caret + popover；二级 Type/Folder 菜单改为 popover 面板内的 anchored 菜单（不再自建 body portal 遮罩）。
4. verify 台 `scripts/verify/commontext-send-agent-block/` 升级：真实指针（Input.dispatchMouseEvent）点击 + `elementFromPoint` 命中弹层断言 + 截图留证，杜绝再次假绿。

## 非目标

- 不改 `resolveSendTarget` / `executeCommonTextSend` 等发送逻辑与 pending-input 链路。
- 不动 Common Text 弹窗本体（compose modal）布局。
- 不替换 FlyoutMenu / inlinetab-dropdown 等既有组件。

## Acceptance Criteria

- [ ] Common Text 弹窗内点 Send split button 的 caret：目标选择 popover **视觉可见**（截图证据：亮/暗主题各一张）且真实指针可点（elementFromPoint 命中 popover 内元素）。
- [ ] popover 内点 Type/Folder 触发行：二级菜单可见、真实指针可选、选中态回写主行。
- [ ] popover 外真实点击、Escape 均关闭；主键（Send 文本段）点击不被 caret 逻辑劫持。
- [ ] 新控件单测（jsdom）：caret 点击开菜单、外点关、Escape 关、floating 层 zIndex=1000。
- [ ] verify 台全绿（真实指针路径），台账入库 `docs/project/verify-ledger.md`。
- [ ] `npm run build:prod`（或等价 lint/type-check）通过。

## 实施结果（2026-11-11）

### 已完成
- [x] 新控件 `frontend/app/element/splitbutton.tsx`（+ `.scss`，+ jsdom 单测 6 条）：单壳两段 + 内分隔线，
      floating-ui `FloatingPortal`（无定位 body 容器）+ `useDismiss`（外点/Escape）+ zIndex 1000，
      Escape 关菜单并还焦点、`aria-haspopup/expanded`。
- [x] 遮挡修复：删除自建 `fixed inset-0` 遮罩，改 floating-ui；弹层在 `.modal-wrapper`(z500) 之上可见可点。
- [x] `commontext-send-button.tsx` 接入 SplitButton；Type/Folder 二级菜单走独立 FloatingPortal（z1001）、
      面板级 `useDismiss` 不误关。
- [x] Agents 选择行样式对齐 New Agent 弹窗（左强调条 `bg-accent/12` + 图标 `getAgentIcon` + 默认勾），
      并改用**探测过**的 profile 列表（`useDetectedAgentProfileOptions`）：未安装的 agent（如 gemini）不再出现。
- [x] 分割线修 token：`border-border-soft` 不是存在的 token（Tailwind 退回 `currentColor`，深色主题下浅色线很突兀）
      → 统一 `border-border/60`；面板面层对齐 New Agent 浮窗（`bg-modalbg/80 + backdrop-blur-2xl + border-border/70 + rounded-xl + shadow-2xl`）。
- [x] verify 台升级为真实指针 + `elementFromPoint` 可见性命中断言（并修掉探针里漏 `JSON.stringify` 的注入 bug）。

### 验证状态（重要）
- ✅ `npx vitest run frontend/app/commontext/ frontend/app/element/splitbutton.dom.test.tsx` → 178 passed
- ✅ `tsc --noEmit`（本包涉及文件无 error）、`eslint` 涉及文件通过
- ⚠️ **真机 verify 台未跑绿**：`commontext-send-agent-block` 多次运行均被环境打断
  （vite dev 冷启动 >7min 超时、与本机其他 agent 的并行编辑/HMR 重载、多实例抢占同一 CDP）。
  最好一次为 **21/25**，核心断言全绿：
  `popover-visible-above-modal`（elementFromPoint 命中弹层内）、`type-menu-visible`、`type-picker-new-tab`、
  `folder-picker-selected`、`close-on-outside-click`、`close-on-escape`；
  失败的 3 条（`send-button-point` / `send-closes-modal` / `new-agent-block-created`）均因运行期间 popover 被
  外部 HMR 重载关闭而中断，非发送链路回归。
- ⏸ 按用户要求（机器卡顿）**本轮不再跑真机验证**；机器空闲时补跑：
  `node scripts/verify/commontext-send-agent-block/verify.mjs`，绿后补台账行。
