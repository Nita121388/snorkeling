# Overview Agent 卡片视觉层次

## Goal

Overview 看板卡（`.session-overview-board-card`）三处视觉整改，实现口径以原型
`design/prototypes/overview-dashboard/agent-card-hierarchy/` 为准：

1. **`emoji` 属性不在卡面重复**：卡片左上头像已渲染同一 emoji，属性行再列一次 `emoji 🐚` 是纯重复。
2. **属性行去名字前缀**：`select` / `status` / `person` / `multi_select` 的值自解释，只显示值；
   `text` / `number` / `url` / `checkbox` 保留名字（去掉就读不懂）。
3. **meta 行图标化（M4）**：状态胶囊 / agent 类型 / 项目 / 标签四类信息不再共用同一种胶囊几何 ——
   状态=唯一彩色胶囊；agent 类型=品牌标 + 名称；项目=folder 图标 + 名称；标签=迷你方片。
4. **卡面脱离面板底色 + 间距/字号分级**：卡片不再 `background: transparent`，标题 13px 成为唯一大字行，
   正文 11.5px/1.55，脚注 9.5px，段间 9~11px（现状 6px）。

## 用户可见行为

- 看板卡 hover：背景抬一档 + accent 38% 描边 + 阴影加深 + 上移 1px。
- 卡片属性行：`Status` / `优先级` / `负责人` 等不再出现属性名，hover 显示 `名字: 值`。
- `emoji` 属性在卡面消失，在会话属性面板（`property-list`）仍可见可编辑。
- meta 行：`● Working 8m  ✦ codex  📁 snorkeling  #frontend`（`#` 前缀降透明度）。

## 约束

- 不改数据契约：`props` / `tags` 的存储与 RPC 不动。
- 不动 `AgentStatusChip` 几何（来源 `agent-status-chip.scss`）；不改列表行/时间线以外未涉及的样式。
- 品牌色只上图标，文字保持 secondary —— 状态色仍是 meta 行唯一彩色信号。
- Verify 探针契约（`data-board-tag` / `data-board-tag-overflow` / `.session-metrics` /
  `.session-overview-board-card-avatar` / `.session-overview-board-card-view-label`）不得丢失。

## 不做（本期）

- 变体 B「正文内容井」（再 +16px/卡）、变体 C「状态色左轨」：原型保留，本期不实现。
- 列表行 `RowMetaChips` 的 meta 行图标化：本期只接 `hideName`，标签/项目词汇保持现状（另一包再统一）。

## 验收判据

- [ ] `npx vitest run overview-board` → 全绿（含新增 hideName / emoji 去重用例）
- [ ] `npx tsc --noEmit -p frontend` 或仓库既有 typecheck 命令 → 无新增错误
- [ ] `node scripts/verify/index.mjs --area overview-board` → 全绿（含本包新增断言）
- [ ] 新增断言：卡面 `backgroundColor` 与面板可区分；`data-board-prop="emoji"` 不渲染；
      `hideName` 行无 `.session-overview-board-card-prop-name` 节点且 `title` 含属性名
