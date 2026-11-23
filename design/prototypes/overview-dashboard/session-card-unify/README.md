> 同步状态：▲ 设计活跃（2026-11-23 第三稿：样式已对齐真实实现——token 与几何全部从生产 SCSS 原样搬运；
> 等 #3 刷新问题定性 + #4 验证后进入落地）
> 镜像源：`frontend/app/session-overview/overview-board.tsx`（BoardCard + 11-23 动作区）、
> `frontend/app/session-overview/session-overview.tsx`（BlockRow + CardSendExpander/展开体）、
> `frontend/app/session-overview/overview-card-send-panel.tsx`（11-23 抽出的共享 composer）、
> `frontend/app/session-overview/overview-board-model.ts`（boardCards 映射）、
> `frontend/app/session-overview/session-overview.scss`（卡片几何）
> 最后同步：2026-11-23

# SessionCard 融合原型：列表卡 × 看板卡 → 单一组件

任务：`.trellis/tasks/11-23-session-card-unify`。原型：`index.html`（零依赖，浏览器直接打开）。

## 核心主张

**一份 SessionCard，形态由容器宽度决定**，不做两个组件、不做 variant prop：

| 容器宽度 | 形态 | composer 呈现 | 参考 |
|---|---|---|---|
| ≥300px（列表行、宽看板列 360） | 行形态：展开 preview/Note/4 格度量轨 | 内联展开（现有行为） | `BlockRow` |
| <300px（看板列 220/280） | 卡形态：压缩信息 | 浮层（FloatingPortal，11-23 已交付） | `BoardCard` |

实现选择（原型里两种都留了）：CSS 容器查询（`@container`）零 JS；保底方案 `ResizeObserver` 打
`data-size` 属性，Electron 兼容性更稳，**建议先按 data-size 落地**。

## 2026-11-23 样式对齐（nita 反馈：与当前样式差异太大）

原型原先是我自定的视觉，与生产差异大。第三稿起**全部对齐生产实现**，差异只剩"融合"本身：

| 原型元素 | 对齐源（原样搬值） |
|---|---|
| 卡片容器 | `.session-overview-board-card`：padding 13 / radius 10 / border 1px / surface 底 / shadow 0 1px 2 |
| 行形态容器 | `.session-overview-block-row`：**透明底** + padding 8 / radius 8 / hover 底色（is-row 类） |
| 头部/头像/标题/年龄 | head flex gap 6；avatar 20×20 r6 f14；title 13px/1.35 w600；age 10px |
| 动作按钮 | `.session-overview-board-card-action`：20×20 / r4 / 11px / secondary 色 / hover 描边 |
| meta 行 / provider / 项目 | flex wrap gap 7 / 9.5px secondary（真实字号，不是原型自定的 10.5） |
| 会话标签 pill | `.session-overview-board-tag`：h15 / r4 / 6% 底 / 9.5px w500 / max-width 84 |
| 属性胶囊 | `.property-chip`：h20 / r3 / px6 / 12px + 三色 |
| preview / note | 11.5px secondary / 2 行 clamp / mb 6 |
| 度量轨 + mini | data 区 mt 11 gap 4；mini 3px gap 1 |
| 主题 token | `theme.scss` 暗/亮全套原值（surface/border/accent/text/secondary/error/warning） |

## 2026-11-23 反馈修订（nita）

1. **卡片加「会话方块」条**：卡片里新增一行小方块，代表最近 N 条消息 ——
   蓝＝你发出的、绿＝agent 回复、黄＝工具调用，行尾标 `最近 12 条`。窄宽度自动缩小方块、隐藏文字标。
   （若你要的"会话方块"是别的口径——比如按轮次/按块而非按消息——见文末待确认项。）
2. **「发消息」在原型里更明确**：
   - 动作区「✈ 发消息」在宽形态显示图标 + 文字；「⟳ 恢复」同理；
   - 右侧第一张看板卡**默认展开**，浮层 composer 一进来就能看到；
   - 页面新增「发消息到底怎么发」四步拆解（悬停 → 点发消息 → 输入回车 → 行程条与回复回填）。

## 待确认（一句话即可）

「会话方块（列表那种）」到底指哪个口径？

| 选项 | 含义 | 原型现状 |
|---|---|---|
| A | 最近 N 条**消息**的方块条（我按这个做的） | ✅ 已画 |
| B | 最近 N 个**轮次/turn** 的方块（问答一次一格） | 可改，数据源同 `session turns` |
| C | 卡片里嵌**列表那种块行**（block rows，一个块一行） | 与"一张卡=一个块"冲突，需要改数据模型 |

## 原型演示什么

1. 左列「现状」：两套实现并排 + 已核到的差异清单（列表无度量轨 / hideName 口径漂移 / 动作区不一致）。
2. 右列「融合」：**同一个模板**渲出看板形态（列宽 220/280/360 可切）+ 列表形态（100% 宽）。
   鼠标悬停出动作区（恢复/发送/跳转/备注/删会话/关块）；点卡片主体 = 展开 composer
   （宽→内联、窄→浮层，同一份 DOM 由容器查询切换）；Esc/再点收起。
3. 底部能力矩阵：融合后每个能力只有一个实现点（恢复/发送/动作/chip/属性/度量轨）。

## 实现口径（进 design.md 用）

- 新组件 `frontend/app/session-overview/session-card.tsx`；
  props = `{ card: OverviewSessionCard, expanded?, onToggleExpand?, actions }`。
- 数据收口 `OverviewSessionCard`：以今天 `boardCards` memo 的字段为底（已有 90%），
  列表行不再自己拼字段。
- 三步里程碑（每步可独立验收/回滚）：
  ① 抽组件 + 看板切新组件（像素回归 `overview-board` 79/79 不退化）；
  ② 列表行切新组件（`overview-ux` 15/15 不退化，composer 行为零变化）；
  ③ 删 `BlockRow` / `BoardCard` 旧渲染分支与重复映射。
- 硬红线：composer 逻辑只来自 `overview-card-send.ts` + `overview-card-send-panel.tsx`；
  恢复只走 `AgentResumeCommand`；动作热区 `stopPropagation` 不得回归。

## 前置依赖（不满足不动工）

- `11-23-overview-refresh-1123` 定性收口（刷新没问题，新增块能上屏 —— 否则融合后 bug 会加倍）。
- `11-23-board-card-actions` 手动验证通过（能力先对齐，再融合）。
