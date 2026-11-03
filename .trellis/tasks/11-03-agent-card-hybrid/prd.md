# Agent Card 合体版：C 行骨架 + D 头像/引用块 + 右上三件套

## Goal

把 `design/prototypes/agent-card-hybrid/` 定稿的视觉方案落到真实组件，重排 agent hover card（以及同一个卡片的弹窗形态）的信息层级：

- **头部**：30px 品牌头像块 + 名称 + 副标题（model · title source），状态 / 收藏 / 放大三件套收进右上角。
- **标题**：变成卡片主体 —— 12.5px 正文、2 行截断、左 2px 状态色引用线。
- **属性区**：`icon + label 左 / value 右`，一行一条信息，26px 行高，空值用 `—`。
- **底部**：单行 footer（`+ Add property` / `✨ AI` / session id / 复制），不再占两行按钮 + 一行 id。

预期收益：同数据下卡高 **296px → 251px**（340 宽、2 行标题，原型实测），同时把「星标 / 标题来源」这类低价值行从属性区移走。

## Background（现状事实 + 原型结论）

**原型（已定稿待实现）**

- `design/prototypes/agent-card-hybrid/index.html`：主卡 + 5 态 + 300/340/380 宽 + 填充态 + 折叠态 + emoji 人格 + 超长标题，支持 `?state&width&theme&collapsed&hover` 深链。
- `design/prototypes/agent-card-beautify/`：8 套对照集（0 现状 + A–G），本任务是其中 **C（Raycast 行骨架） + D（GitHub 头像/引用块） + 右上三件套** 的合成落地。
- 实测：`agent-card-beautify` 方案 0 高 296px @340 宽（页面 `data-card-heights`）；合体版 251px；折叠 140px。

**代码现状（真实实现，全部实测过行号）**

| 位置 | 事实 |
| --- | --- |
| `frontend/app/view/term/agent-hover-card.tsx:149-260` | 头部 = 18px logo + provider + model + 放大按钮；下面是独立 `.agent-card-status-row`（dot + label）；Note/Tags 段交给 `SessionNoteSection`；底部独立 `.agent-card-session-id` 行 |
| `frontend/app/element/info-card/info-card.scss:225-240` | `.info-card.agent-card` 用 `::before` 画左侧 3px 通长圆头色条（agent-card-accent 任务已落地），`border-radius: 0 6px 6px 0`、`padding-left: 15px` |
| `frontend/app/element/info-card/session-note-section.tsx:205-231` | 标题行 = `InfoCardHead`（tag 图标 + 11px 灰 marquee + TitleSourceBadge）+ 右侧 3 个 hover 才出现的小按钮（放大 / AI 标题 / AI metadata） |
| `frontend/app/element/info-card/session-note-section.tsx:290-340` | 属性区 = `<PropertyList mode={canEditProperties ? "detail" : "card"} footer={<AIPropertiesButton/>}>`；hover 卡传 `canEditProperties` → detail 模式 |
| `frontend/app/view/aisessions/property/property-list.tsx:352-380` | detail 模式把 `titleSource / starred / created / updated` 归入 `SecondaryBuiltinKeys` 折叠组，主区只留 Tags/Note/自定义 |
| `frontend/app/view/aisessions/property/property-list.tsx:405-470` | 行结构 = `.property-row` → `.property-row__name`（固定 100/116px）+ `.property-row__value`（左对齐，`ValueDisplay` 内 `Empty` 斜体） |
| `frontend/app/view/aisessions/property/property-model.ts:170-203` | 内置行顺序 `titleSource(0) < starred(1) < created(2) < updated(3) < tags(4) < note(5)`；`starred` 值来自 `summary.marked` |
| `frontend/app/view/aisessions/property/property-store.ts:55-64` | 写 starred = `service.Mark(summary.key, value === true, "")` + `dispatchAISessionNoteUpdated(updated)` |
| `frontend/app/view/aisessions/utils.ts:437-448` | 已有 `formatSessionRelativeTime(timestamp, now?)` → `just now / 25s ago / 3m ago / 2h ago / 2d ago`，可直接复用 |
| `frontend/app/view/aisessions/property/property-model.ts:294-300` | 已有 `humanizeKey`（`first_user_message` → `First User Message`），用于副标题的 title source |
| `frontend/app/modals/agentcardmodal.tsx` + `agent-hover-card.tsx:46-52` | 弹窗沿用同一个 `AgentHoverCard`（`embedded` + `frameless`），尺寸 520–640px |

## Requirements

- **R1 头部重排**：卡片头部 = 30px 头像块（复用 `getAgentIcon` 的 logo/emoji/badge 输出）+ 名称（13px/600）+ 副标题（10.5px mono：`model · titleSource`）；右上角依次为 **状态 chip、收藏（checkbox 语义）、放大按钮**。删除独立的 `.agent-card-status-row`。
- **R2 标题成为主体**：标题从 11px 次要色 `InfoCardHead` 改为 12.5px 正文色块，最多 2 行，左侧 2px 状态色竖线（色值 = `--info-card-accent`），`title` 属性挂全文；`TitleSourceBadge`（AI 标记）保留在标题块内。
- **R3 属性区行骨架**：hover 卡使用新的 `agent` 布局 —— 每行 `icon（12px）+ label（68px，次要色）+ value（右对齐，次要色）`，行高 26px，去掉逐行分割线；行 hover 才显示编辑 affordance。
- **R4 属性区内容重排**：hover 卡隐藏 `starred`（已进头部）与 `title_source`（已进副标题）；固定顺序 `Updated → Created → Tags → Note → 自定义属性`；空值渲染 `—`（不再 `Empty` 斜体英文）。
- **R5 时间相对化**：`created_at / updated_at` 显示 `formatSessionRelativeTime` 结果，`title` 挂现有绝对格式（`formatDateTimeValue`）；相对时间每秒刷新不需要（卡片存活期短，打开时计算即可）。
- **R6 底部单行**：footer 一行完成 `+ Add property`（左）+ `✨ AI auto-fill` + session id（8+4 截断，`title` 全量）+ 复制按钮（右）；删除原 `.agent-card-session-id` 独立行与 `AI auto-fill` 的独立虚线按钮行。
- **R7 星标归位**：星标按钮读 `summary.marked`，点击写 `service.Mark(...)`，失败要能回显（复用 `state.error` 或按钮 disabled + tooltip）；不引入新的全局状态。
- **R8 不回归 detail 卡**：`SessionDetailInfoCard`（会话详情）与 `PropertyList` 的既有 detail 模式行为、`Starred` checkbox 行、`Empty` 占位、`SecondaryBuiltinKeys` 折叠逻辑全部保持不变；新布局必须 opt-in。
- **R9 形态兼容**：`embedded`（弹窗 520–640）复用同一布局但不显示右上放大按钮；`frameless` 保持无边框/无阴影；`mode="gui"|"tui"` 语义不变。
- **R10 宽度**：hover 卡固定 `340px`（`max-width: min(400px, calc(100vw - 24px))`），弹窗仍 520–640；300px 极限宽度下头部不得换行溢出。
- **R11 可访问性**：星标 `aria-pressed` + `aria-label`（收藏/取消收藏）、状态 chip 有 `title` 全文案、复制按钮保留现有 `title`/错误态、行按钮保留 `aria-label`。
- **R12 测试**：为新增的 `agent` 布局与 `toggleStarred` 加单测；既有 `property-list` 测试必须继续通过。

## Non-goals

- 不纳入 Warp 式 usage 指标（Duration / Cost / Context）—— 需要新数据源，另起任务。
- 不改 `PropertyList` 的 Notion 式编辑器（类型选择器 / 值编辑器 / AI 提议）本身。
- 不改 `SessionNoteSection` 的 AI 生成逻辑与 note 自动保存逻辑。
- 不改 `agent-card-accent` 之外的其他 InfoCard 消费者（Files / Tab 卡 / Block Sidebar）。
- 不实现「点击状态 chip 打开状态菜单」。

## Acceptance Criteria

- [ ] AC1 头部渲染顺序为「头像 → 名称/副标题 →（右）状态 chip → 星标 → 放大」；无独立状态行；`embedded` 下无放大按钮。
- [ ] AC2 副标题内容 = `model`（缺失时 `未指定`）+ `·` + `humanizeKey(titleSource)`；`titleSource` 为空时只显示 model。
- [ ] AC3 标题块 2 行截断、左 2px 状态色线、正文色；hover 卡内 AI 标记（`titleSource === "ai"`）仍然可见。
- [ ] AC4 属性行顺序固定 `Updated / Created / Tags / Note / 自定义`；`Starred` 与 `Title Source` 不再出现；空值显示 `—`。
- [ ] AC5 时间显示相对值（`2m ago` 级别），`title` 为 `Nov 3, 2026 11:24` 级别绝对时间。
- [ ] AC6 底部只有一行：`+ Add property` 左，`✨`、`3ce67d75…7ca2`、复制右；点击复制有成功反馈，id hover 有全量 tooltip。
- [ ] AC7 点击星标立即写入并刷新（`summary.marked` 变化后按钮态同步）；写失败有可见错误且不误显示已收藏。
- [ ] AC8 `SessionDetailInfoCard` 与 `PropertyList` detail 模式渲染结果与改动前一致（既有测试全绿）。
- [ ] AC9 340px 宽、2 行标题、空 tags/note 的 hover 卡实测高度 ≤ 260px（原型 251px）。
- [ ] AC10 `npm run` 前端校验：目标目录 vitest 全绿 + `tsc --noEmit` 无新增类型错误。
- [ ] AC11 浅色 / 深色主题下无对比度回归（头像块、chip、引用线、footer 均使用主题 token）。

## Open Questions（design 里已给结论）

1. 星标逻辑放 hook 还是组件内？→ **hook**（`useSessionNoteState` 增 `toggleStarred`），保证详情卡/后续列表行复用。
2. 属性行布局走新 `mode` 还是新 `layout` 参数？→ **新增 `layout?: "notion" | "agent"`**，`mode` 语义（card/detail 的信息量）保持不变。
3. 底部单行如何让 `AgentHoverCard` 的 session id 与 `PropertyList` 的 `+ Add property` 同行？→ `SessionNoteSection` 新增 `footerExtra` 插槽，转发给 `PropertyList` 的 footer 右组。
4. 左侧 3px 色条（已落地的 agent-card-accent 方案 E）怎么办？→ **整卡移除**，状态改由 chip + 圆点 + 标题引用线表达；`agent-card-accent` 原型 README 标注「被本任务取代」。
