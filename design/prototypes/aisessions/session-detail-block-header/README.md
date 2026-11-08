> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/aisessions/session-detail.tsx, frontend/app/block/blockframe-header.tsx, frontend/app/block/block.scss
> 最后同步：2026-10-22

# 会话详情块 · Header 方案对比

## 问题

「Session Detail Block」同时渲染两层横条：WaveTerm 的块框头 `.block-frame-default-header`（`blockframe-header.tsx`，`--header-height: 30px`）和详情面板头 `flex h-[46px] shrink-0 items-center gap-2 border-b border-border px-3`（`session-detail.tsx:1163`）。两条都带下边框，纵向 chrome 合计 76px，视觉上就是两个 Header。块框头本身几乎是空的：`AiSessionsViewModel.hideViewName = true`（`aisessions.tsx:107`）让 `frame:title`（"Session Details"）不渲染，`viewText` 未定义，所以中间整片留白；会话标题、来源 chip、模型 chip 全被挤在下面那行 46px 里。

## 方案对比

| 方案 | Header 数量 | 改动面 | 风险 | 视觉结果 |
|---|---|---|---|---|
| 方案 0 · 保持现状 | 2（30px + 46px） | 无 | 无 | 两条带下边框的横条，最像"两个 Header"；块框头中间大片留白 |
| 方案 A · 合并进块框头 | 1（36px） | `aisessions.tsx` 视图模型 + `session-detail.tsx:1163` 不渲染面板头 + `block.scss` 放行 header 高度 | 中 | 只剩一条 Header；块框头被会话标题填满，块级按钮全部保留 |
| 方案 B · 隐藏块框头，面板头升级 | 1（40px） | `noHeader` + 视图内重做块级按钮 + 补回块图标 | 中高 | 一条 Header，外观完全可控；但失去拖拽手柄，块级按钮逻辑被复制一份 |
| 方案 C · 双层弱化 | 2（26px + 38px） | 纯 CSS | 低 | 仍是两条横条，只压低对比度；适合先止血 |

## 推荐

**方案 A**。它是唯一真正消除"两个 Header"的方案，同时把块框头那块无意义的留白填上会话身份。WaveTerm 原生的能力一个都不丢：块框头就是拖拽手柄（`blockframe-header.tsx` 的 `dragHandleRef`）、右键菜单、放大、并入上一个块、关闭。

方案 B 视觉上同样干净，但要在 `aisessions` 视图里重做一遍块级按钮（放大 / 并入上一个块 / ⋯ 块菜单 / 关闭），逻辑会和 `blockframe-header.tsx` 里的那份分叉，后续两边容易漂移；而且拖拽手柄没了。

方案 C 改动最小、风险最低，适合先止血；但如果最终仍然觉得"像两个 Header"，还是得走方案 A。

## 实现落点

### 方案 A · 合并进块框头

- **会话标题 / chip 进块框头**：用 `viewModel.viewText`（`frontend/types/custom.d.ts:391`，类型 `jotai.Atom<string | HeaderElem[]>`）。`HeaderElem` 支持 `text`（带 `onClick`）、`input`（`value` / `onChange` / `onKeyDown` / `onBlur`，正好承接"双击标题改名"）、`children`、`iconbutton`、`menubutton`。渲染入口是 `blockframe-header.tsx` 的 `HeaderTextElems`。
- **会话级按钮进块框头右侧**：用 `viewModel.endIconButtons`（`custom.d.ts:400`），AISessions 已经在用它挂自动刷新按钮（`aisessions.tsx:155`）。搜索 / 星标 / ⋯ 会话菜单按 `zone: "pinned"` 挂进去。
- **面板头整行不渲染**：`session-detail.tsx:1163` 那行 `h-[46px]` 只在「列表 + 详情同块」时渲染；纯详情块（`aisessions:sessionid` 有值）不渲染。
- **块框头高度**：`--header-height: 30px` 定义在 `theme.scss:29`，`.block-frame-default-header` 同时用了 `min-height` 和 `max-height`（`block.scss:194-195`）。方案 A 要 36px，必须按块局部覆盖，不能改全局变量——`--header-height` 还被 `block.scss:683` 和 `block.scss:821-823` 用来定位。
- **标题排版**：`.block-frame-text` 是等宽 12px + `opacity: .7`（`block.scss:253-258`），会话标题需要自己的类（13px / 600 / 主色）。
- **⚠️ 按钮分区顺序**：`.block-frame-end-icons` 的 CSS 强制 `reveal` 区 `order: 0`、`pinned` 区 `order: 2`（`block.scss:614-621`），两组不能交错。方案 A 要的「会话按钮 ｜ 竖线 ｜ 块按钮」需要新增一个分区（例如 `zone: "session"`）或给按钮加 `order` 出口。
- **改名交互**：改名状态现在在 `SessionDetailPane` 的 React state 里；标题移到块框头后，视图模型要自己持有 `renaming` / `titleDraft`。

### 方案 B · 隐藏块框头，面板头升级

- 设 `viewModel.noHeader = true`（`custom.d.ts:405`），`blockframe.tsx:239` 会整条跳过块框头。参考 `frontend/app/view/launcher/launcher.tsx:32`。
- 视图内补回块级按钮：关闭用 `uxCloseBlock`（`@/app/store/keymodel`），放大用 `nodeModel.toggleMagnify()`，并入上一个块用 `layoutModel.inlineMinimizeBlock(blockId)`。
- 代价：拖拽手柄丢失；块级按钮逻辑与 `blockframe-header.tsx` 分叉。

### 方案 C · 双层弱化

- 纯 CSS：`.block-frame-default-header` 压到 26px、去下边框、图标降到 `opacity: .35`；面板头降到 38px、去下边框、标题改主色；两者之间加一条发丝线。
- 注意 `.block-frame-default-header` 是所有视图共用的，全局改会影响别的块；需要按视图加作用域类（例如基于 block meta 的 class）。

## 原型使用

浏览器直接打开 `index.html`。页面含 4 个按真实块尺寸复刻的方案框（880px 宽），深/浅色主题切换，悬浮块框头会显示 magnify / 合并 / ⋯ 按钮（真实实现是 `display: none`，原型里降为 22% 透明度以便静态对比占位），方案 A 的标题点击可改名。

原型里 reveal 区按钮用了 `opacity` 过渡而不是 `display` 切换，这是为了让静态截图也能看到按钮占位；真实实现以 `block.scss:600-606` 为准。
