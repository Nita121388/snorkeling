# AISessions Tab 悬浮卡 Notion 风格重设计

## Goal

把 Tab 悬浮信息卡（`TabInfoCard`）从"三份重复信息 + 三套图标语言 + 全 11px 扁平层级"改成 Notion / Things 3 式结构：header 只留身份与聚合计数，agent 清单用浅底 pill 表达状态，内容构成用属性 chips 表达。

设计依据：`design/prototypes/tab-card-v2/`（变体 #4 `v-notion`，用户已选定）。

## Requirements

- R1 删除重复信息：去掉独立"内容构成"分区里的 `4 agents` 计数行，以及 `fa-bolt + Agents` 分区标题；agent 数量并入 header 右侧元信息。
- R2 header 层级：workspace 图标 + Tab 名（13px / 600）+ flag 色块 + 右侧计数（10.5px muted）；header 与正文之间加 1px hairline。
- R3 Agent 行：26px 行高，左侧 papel emoji **原样放行、不套容器**，统一尺寸 13px（占位 16px）；provider 名用次要文字色（`--secondary-text-color`）。
- R4 状态表达：右侧改为浅底 pill（10.5px，圆角 999px），不再用右贴边纯文字；`working` / `thinking` 用 `--agent-working-color` 的低透明底和文字色，`done` 用 `--agent-done-color`，`idle` / 未知用 `--form-element-bg-color` + 次要文字色。
- R5 provider 去重：所有 agent 行 provider 相同时，行内只显示一次——provider 提到分组标题（`Agents · pi ×4`）；provider 混合时保留每行 provider 文本，分组标题退回 `Agents`。
- R6 无状态兜底：状态未知时显示 `Idle`，不再显示 `—`。
- R7 宽度稳定：卡片固定宽度（268px，`min-width`/`max-width` 同值），状态 pill 不参与宽度竞争。
- R8 内容构成：非 agent 计数（chat / file / note / terminal）在 agent 清单下方以属性 chips（`2 chat` / `12 file` / `1 note`）展示；与 header 计数不重复。
- R9 纯函数抽离：block 分类、计数汇总、状态呈现、分组标题四段逻辑抽到独立模块，可脱离 React 单测。
- R10 补单测，覆盖 R1/R4/R5/R6/R8 的判定逻辑。

## 与已确认推荐的一处偏差

原推荐把属性 chips 定为"只在无 agent 时显示"。实际实现改为**始终展示非 agent 计数**，且 header 计数只显示 agent 数量。

理由：按原规则，有 agent 的 Tab 会永久丢失 chat / note / terminal 计数（信息净损失）；改成"header 只放 agent 数、chips 只放其余类型"同样不产生重复，且不丢信息。若不需要，删掉 chips 区块只改一处即可。

## Non-goals

- 不统一 `getAgentIcon` 解析链（persona → provider → logo），不引入 `<AgentIcon>` 抽象；emoji / logo 的渲染分支保持现状，只调尺寸与容器。
- 不改 Tab 栏上的 `TabBadges` 状态点与竖条。
- 不改 `BlockInfoCard` 等其它 InfoCard 使用方。
- 不为 working 态加呼吸动画（动画只保留在 Tab 上的状态点）。

## Acceptance Criteria

- [ ] AC1 卡内不再出现 `4 agents` 计数行与 `fa-bolt` 的 `Agents` 分区头；agent 数量出现在 header 右侧。
- [ ] AC2 同一 provider 的 4 个 agent 只出现一次 provider 文本（在分组标题里），行内不重复 `pi`。
- [ ] AC3 每行状态是 pill；`working` 行 pill 使用 `--agent-working-color` 系配色，`done` 行使用 `--agent-done-color`。
- [ ] AC4 状态未知的行显示 `Idle`，DOM 中不出现 `—`。
- [ ] AC5 卡片渲染宽度恒为 268px；状态文本最长（`Tool · bash`）时宽度不变。
- [ ] AC6 有 agent 的 Tab 仍能看到 chat / file / note 计数（属性 chips）。
- [ ] AC7 `tab-info-card-model.test.ts` 通过，覆盖分类/汇总/状态呈现/分组标题/空态。
- [ ] AC8 现有 `vtab.test.tsx`、`tab-more-menu.dom.test.tsx` 不回归。
