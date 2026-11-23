> 同步状态：▲ 设计活跃（2026-11-23 原型成稿，未动生产代码；等 #3 刷新问题定性 + #4 验证后进入落地）
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
