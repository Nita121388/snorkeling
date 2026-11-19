# 连接下拉：右栏图标居右对齐 + hover 一键复制 + 使用次数排序 + 加载骨架

## Goal

把连接下拉（Connect to 弹窗，`frontend/app/modals/conntypeahead.tsx` + `typeaheadmodal.tsx`）的四件事一次做对：

1. **右栏居右对齐**：来源徽标（gear / file-lines / clock）与「当前连接」勾选统一贴在行右边缘，不再跟着名字长度漂移。
2. **hover 一键复制**：鼠标悬浮某行时右侧浮出 copy 图标，点一下复制该连接名（不触发连接动作）。
3. **加载骨架**：弹窗打开后到 `ConnListCommand`/`WslListCommand` 返回前，显示 shimmer 骨架行，面板不塌陷、不跳高。
4. **按使用次数排序**：常用的连接排前面（同 section 内），排序稳定、可预期。

## 根因（为什么要改结构，不是调样式）

- `.typeahead-item-source` 的 `margin-left: auto` 挂在 `.typeahead-item-name` **内部**，而后者宽度 = 内容宽 → `auto` 只能把它推到文字右侧；同时行级 `.typeahead-current-checkbox` 也在用 `margin-left: auto`，两个 auto 互相竞争。
- `.typeahead-item-name.ellipsis` 打不到文本：`display:flex` 容器里的裸文本是匿名 flex item，`text-overflow` 不生效 → 长名字不截断，而是把右栏挤出行外。
- 组件没有 loading 概念：`connList` 初始 `[]` → 首帧 `suggestions.length === 0` → `.has-suggestions` 为假 → 面板高度按「只有输入框」算，RPC 回来再撑开。
- 排序只按 `connections[name]["display:order"]`（默认全 0 = 后端返回顺序），使用频率完全不参与。

## Requirements

### R1 右栏右对齐

- 行结构改为三段：左 icon / 可省略的 label（`flex:1 1 auto; min-width:0`）/ 固定宽度右栏（`margin-left:auto`）。
- 来源徽标与 current 勾全部收进右栏，右栏内部不再使用 `margin-left:auto`。
- 长连接名必须真省略（`text-overflow: ellipsis` 生效），不得把右栏挤出。

### R2 hover 一键复制

- copy 槽位**常驻固定宽度**（默认 `opacity: 0; pointer-events: none`），hover 该行或键盘选中该行时浮现；hover 按钮本身/已复制时 `opacity: 1`。
- hover 前后行高、右栏 x 坐标**零位移**（不允许布局跳动）。
- 仅对「有连接名语义」的行显示复制（远程 / wsl / git bash）；本机行、Disconnect、Edit Connections、New Connection 不显示。
- 复制文本 = 该连接的**连接名**（与可粘回连接框的值一致）。
- 点击必须 `stopPropagation`，不得触发该行的连接/选择动作；复制成功给 copied（check + success 色）反馈，失败不假报成功。
- 复制走仓库既有 `frontend/util/clipboard.ts#copyText`，按钮复用 `frontend/app/element/copybutton.tsx`。

### R3 加载骨架

- `TypeAheadModal` 增加可选 `loading`（默认 false，其他调用面零影响）。
- loading 时渲染 5 行骨架（左圆点 + 不等宽文本条，`animate-pulse`），`role="status"` + `aria-busy="true"`；行高对齐真实行，加载完成后不跳高。
- 面板分割线（`has-suggestions` 语义）在 loading 期间保持，避免塌陷再撑开。
- RPC 成功或失败都必须结束 loading（失败不得骨架永驻）。

### R4 按使用次数排序

- 新增前端使用计数存储：`snorkeling:connUsage` = `{ "<连接名>": 次数 }`，走 `localStorage`（与 widgets/persona 等纯 UI 偏好同策略，不改 `settings.json`、不动后端）。
- 计数时机：连接**成功建立**后 +1（`changeConnection` 成功路径），失败不计。
- 排序：同 section 内 `次数 desc → display:order asc → 名字 asc`（`display:order` 仍作为同频次的显式优先级，不剥夺用户手排能力）。
- 排序是纯函数，单测可断言；不引入对新后端/新 RPC 的依赖。

### 非目标

- 不做「按最近使用时间」/「跨机器同步计数」/「显示次数数字」的 UI（只加 `data-conn-use` 属性备验证用）。
- 不改后端 `ConnListDetail` / 连接来源判定逻辑。

## Acceptance Criteria（判据）

- [ ] `npx vitest run frontend/app/modals --reporter=basic` → 全绿（含右栏结构、复制文本、loading 骨架、使用次数排序断言）
- [ ] `npm run i18n:check` → exit 0（0 hardcoded、en/zh parity 通过；新增 key 双语齐全）
- [ ] `node scripts/verify/conn-typeahead-rail/verify.mjs` → exit 0：
  - 同 section 内所有行右栏右边缘 `x+width` 极差 ≤ 1px
  - 未 hover 行 copy `opacity === "0"`，hover 后 ≤150ms 内 > 0
  - hover 前后行 `getBoundingClientRect().height` 差 = 0
  - loading 期间出现骨架行且 `.suggestion-item` = 0
  - 使用次数排序：注入 `connUsage` 后行序与期望一致
- [ ] 红证：新断言在旧源上失败（`loop/red/N-1117-conn-typeahead-row-rail.txt`）

## Constraints

- 只改 `touch` 白名单内文件；出界即停。
- 不新增后端 RPC；`SuggestionConnectionItem` 只加可选字段。
- 文案全部走 i18n（`modals` namespace，en + zh）。
