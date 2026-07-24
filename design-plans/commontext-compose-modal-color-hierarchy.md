# Common Text 弹窗使用一致的语义表面与操作层级

Written against: 73cd16d80ce0eb298d171f76cf134b9c5518e6cb

## Evidence chain

- Surface: Light 主题下打开 `CommonTextComposeModal`，选中一条 Common Text 后查看右侧详情。
- Problem: CDP 计算样式显示 Modal 为 `#fffdf8`，右侧详情与顶部 Compose textarea 却使用 Canvas `#ebe5d9`；详情 textarea 的 `bg-editorbg` 在仓库中没有定义，运行时背景为透明；详情 footer 的 `Send`、`Copy`、`Insert` 全部使用同一旧式 grey 填充，导致主操作不突出；`All tags` 又在详情区形成一张带背景、边框和圆角的嵌套卡片。
- Design evidence: `docs/design-system.md` 第 2、4、7、8 节要求 feature UI 使用语义 token、Canvas 仅用于根与无框页面区域、选中态使用 action-soft 或 accent indicator、主操作使用 action token，并要求 Modal 内使用无框分区而非卡片套卡片。
- Owner: `frontend/app/commontext/commontext-compose-modal.tsx` 中的 `CommonTextComposeModal`。
- Scope and affected surfaces: Common Text Compose Modal 的顶部编辑器、Master-Detail 左侧选中行、右侧详情、All Tags 分区与详情 footer；所有 dark/light/monochrome 主题均继承语义 token 结果。
- Uncertainty: 当前 GitNexus MCP 与 `.gitnexus/run.cjs` 均不可用；实施前必须恢复 GitNexus impact 能力并确认 `CommonTextComposeModal` 的 upstream 风险。视觉证据来自当前运行中的 Electron Light 主题，dark 与 monochrome 仍需实施后验证。

## Design decision

把左右工作区统一为 panel surface，输入控件继续使用已有 form-element 语义变量，选中行使用较柔和且尺寸稳定的 action-soft 状态，详情区唯一主操作 `Insert` 使用默认 action button。把 All Tags 从嵌套卡片降为同一详情表面上的分区，仅用一条语义边框分隔。这样保留现有暖色 Light 主题身份，同时避免 Canvas 过深或 Modal surface 大面积铺白两个极端。

## Reuse

- `bg-panel` / `--panel-bg-color`: 左右工作区的暖色基础表面。
- `bg-modalbg` / `--modal-bg-color`: 弹窗外壳与局部输入表面。
- `--form-element-bg-color`、`--form-element-text-color`、`--form-element-border-color`: 两个 textarea 的表单语义；通过 Tailwind arbitrary property 引用，避免新增仅供此组件使用的 token alias。
- `bg-actionsoft`、`border-actionsoftborder`: 列表选中态。
- `Button` 默认 `solid green`: 其实现已经映射 `--action-bg-color`、`--action-hover-bg-color`、`--action-text-color`，用于详情 `Insert` 主操作。
- `border-border`: Master-Detail、All Tags 分区与未选中行的稳定边界。
- Exemplar: `frontend/app/element/input.scss` 的 `.input` 表单颜色；`frontend/app/element/button.tsx` 与 `frontend/app/element/button.scss` 的默认 primary action；`docs/design-system.md` 的 Modal、Input、Button 和 selected state 契约。

## Changes

1. `frontend/app/commontext/commontext-compose-modal.tsx`
   - Change: 顶部 Compose textarea 将 `bg-background` 替换为 `bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)]`；保留现有 `border-border`、尺寸、展开/折叠、IME、caret 与 focus 行为。
   - Change: Master-Detail 左右 pane 统一使用 `bg-panel`，同步更新旧注释；避免把 Canvas 当作 Modal 内面板色，也避免用 Modal surface 大面积铺白。
   - Change: 详情 textarea 删除未定义的 `bg-editorbg`，改用与顶部 textarea 相同的 form-element background/text 语义；不改正文尺寸、字体、行高和编辑行为。
   - Change: 每个列表行始终保留相同宽度的左侧边框；选中行使用 `border-actionsoftborder bg-actionsoft`，未选中行使用透明边框与现有 `hover:bg-hoverbg`。不要用只在选中态才出现的 border/padding，避免行内容横向位移。
   - Change: All Tags 容器移除 `rounded-lg`、完整 `border` 和 `bg-modalbg/60`，改为同一详情 pane 内的 `border-t border-border pt-2.5` 无框分区；保留标签内容、空状态、滚动上限与点击行为。
   - Change: 详情 footer 的 `Insert` 去掉 `grey` class，让现有 `Button` 默认 primary action 生效；`Send`、`Copy` 和删除按钮保持次级/破坏性层级，不改变功能、顺序或 disabled 行为。
   - Preserve: 搜索、过滤、键盘导航、详情自动保存、pin、Send、Copy、Insert、Delete、标签派生、IME 防护和 Modal 尺寸均不变。
   - Verify: Light 下 Modal 内不再出现整块 `#ebe5d9` Canvas pane；两个 textarea 都解析到 `--form-element-bg-color`；选中行有柔和填充及持续可见的左侧 cue；Insert 是 footer 唯一 action-filled button；All Tags 不再形成内嵌卡片。

## Scope

- Inherit: `CommonTextComposeModal` 的 dark、light、monochrome 渲染状态。
- Verify: 选中/未选中/hover、textarea focus、Insert hover、无 terminal 时 Send disabled、有/无 tag、无 detail item、窄窗口下 Master-Detail overflow。
- Exclude: `CommonTextManagerContent`、全局 theme palette、共享 `Modal`、共享 `Button`/`Input` 实现、Common Text 数据与交互逻辑、其他弹窗。

## Validation

- Product: 打开 Common Text Compose Modal，选择列表项，编辑正文，点 tag，执行 Insert/Copy/Send；预期行为和保存状态与修改前一致。
- Interface: 使用 `node scripts/inspect-electron-ui.mjs` 在 dark、light、monochrome 下检查默认、hover、selected、focus、disabled、空标签和窄窗口；记录 Modal、左右 pane、两个 textarea、选中行、All Tags、Insert 的 computed background/color/border、矩形尺寸、`clientHeight`、`scrollHeight`、`overflow` 与 `overflowY`，并各留一张截图。
- System: 确认没有新增颜色常量、主题变量、共享 primitive 或新的 feature CSS 文件；`rg -n "bg-editorbg|bg-background" frontend/app/commontext/commontext-compose-modal.tsx` 不再命中本计划替换的三个 surface 用法。
- Repository: GitNexus `impact({target: "CommonTextComposeModal", direction: "upstream"})` -> 在编辑前记录 direct callers、affected processes 与风险等级；HIGH/CRITICAL 时先向用户预警并停止等待确认。
- Repository: `npm test -- --run frontend/app/commontext/commontext-compose-modal.test.ts` -> 相关 Vitest 全部通过。
- Repository: `npm run build:prod` -> production build 成功。
- Repository: GitNexus `detect_changes({scope: "compare", base_ref: "main"})` -> 只包含 `CommonTextComposeModal` 的预期展示影响，不出现数据或跨流程变更。

## Stop conditions

- Stop if GitNexus impact 返回 HIGH/CRITICAL，直到用户确认风险。
- Stop if `bg-[var(--form-element-bg-color)]` 未被 Tailwind v4 生成，或 textarea 计算色未解析为各主题的 form-element token；此时优先复用已有表单 class/owner，不新增局部硬编码颜色。
- Stop if `Button` 默认 primary variant 不再映射 action tokens，或把 `Insert` 改为 primary 会改变尺寸和 footer 排布；先修正为现有等尺寸 primary variant。
- Stop if 实现需要修改共享 `Modal`、`Button`、`Input` 或全局主题；该变化超出已批准范围，必须单独评估影响。

## Design documentation

- After acceptance and validation: none；现有 `docs/design-system.md` 已完整定义本次使用的 Modal、form、selected 和 primary action 契约。
