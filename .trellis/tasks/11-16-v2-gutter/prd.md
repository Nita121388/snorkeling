# 会话详情分页 v2 落地（B1：前端分页 + 视觉 + Annotations RPC 游标）

> 母任务：`10-25-aisessions-annotation-timeline`
> 主设计文档：`design/plans/aisessions-annotation-timeline-v2.md`（v2 深版，551 行，本任务的需求与规格唯一来源）
> 原型：`design/prototypes/aisessions/aisessions-timeline-v2/`（2026-11-11，已审阅）
> 批次：**B1**（前端分页 + 视觉，唯一后端改动是 `Annotations` RPC 加游标）

## 0. 问题

v1 批注时间线全量拉取 + 全量渲染，三个上限已到：

1. **条目量级**：R3 上线后 agent 每会话写 5–30 条，单会话批注将达数百条，`Annotations` 全量返回不再成立。
2. **时间语义缺失**：rail 只有圆点与轴，无法「回看 11-06 那天标了什么」。
3. **视觉根因**：独立时间轴上的圆点浮在没有内容的位置（空白轴上的孤点），这是 v1 被评价为「丑」的根因。

## 1. 范围（= 主文档 §6 B1 表）

**做**：

| 文件 | 改动 |
|---|---|
| `frontend/app/view/aisessions/annotation-model.ts` | `buildTimeBuckets`、`bucketOf`、kind 元数据（图标/顺序，含 node） |
| `frontend/app/view/aisessions/annotation-model.test.ts` | 桶边界 / DST / 缺失 ts / 空桶 / 单条 / 多条目同 seq |
| `frontend/app/view/aisessions/annotation-store.ts` | window / cursor / evict / invalidate（§3.6–3.7），保留 v1 全量接口兼容 |
| `frontend/app/view/aisessions/annotation-store.test.ts` | 失效矩阵逐行、驱逐、并发（inflight + 迟到响应丢弃） |
| `frontend/app/view/aisessions/annotation-rail.tsx` | 行对齐 gutter（rAF 滚动同步）、类型色实心核、浮动工具条、过滤弹层、端帽 `↑N`、键盘 roving focus、轴 scrub + tooltip、草稿条、折叠未读 |
| `frontend/app/view/aisessions/annotation-rail.dom.test.tsx` | 状态矩阵 8 态 + 键盘 |
| `frontend/app/view/aisessions/annotation-card.tsx` | 来源徽章（You / ✨AI·草稿 / 🤖agent·时间）、上下条导航 `‹ 1/5 ›`、编辑入口（外部条目只读） |
| `frontend/app/view/aisessions/annotation-card.dom.test.tsx` | 徽章三档、导航边界 |
| `frontend/app/view/aisessions/session-detail.tsx` | 分段头挂载 + 前插锚定（scrollTop 补偿，复用 10-27 的锚定工具）+ 分页模式状态 `pageMode/intervalHours/countSize/lockPageId` + `computePages()/scopeSeqs()` 纯函数 + 翻页条 + 详情头视图 chip 入口 |
| `frontend/app/view/aisessions/timeline-virtual.ts` | 暴露 `seqToTimestamp`（无行为变更） |
| `pkg/service/aisessionsservice` | `Annotations` 加 cursor/limit（B1 唯一后端改动） |

**不做（明确出界，进其他任务）**：

- B2 写入通道（`AnnotationAppend` RPC、`author/idempotency_key` 列、`wsh annotation` CLI）→ 母任务后续批次
- B3 MCP tool + ACS token scope → 母任务后续批次
- 批注 Block / Obsidian 导出（`10-25-aisessions-annotation-export`）
- 字符区间批注（`10-19-aisessions-annotate`）
- rail 日历热力图 / 横向时间轴（主文档 §4.6 / §8「不做」）

## 2. 成功判据（主文档 §1，B1 覆盖 S1/S2/S3/S6）

| # | 判据 | 验证 |
|---|---|---|
| S1 | 10k 条批注会话，打开详情首屏 RPC ≤ 1 页（≤100 条），rail 首帧 < 50ms | 埋点 + 真机会话 |
| S2 | 「加载更早」前插 100 条后视口像素不动（scrollTop 补偿误差 ≤ 1px） | DOM 测试断言 scrollHeight 差 |
| S3 | 任意批注 ≤ 2 次交互内到达（日期跳转 / j-k 键 / 过滤收窄） | 交互走查 |
| S6 | rail 8 态（empty/loading/error/loaded/dense/drafts/orphan/collapsed）都有成品 + 键盘模型可走通 | 原型场景矩阵对照 + DOM 测试 |

加分判据（B1 内必须真实）：

- 分页 5 模式（all/day/turn/interval/count）可切、页 id 稳定、作用域收窄（rail 标记 / 卡片 / 过滤计数 / 草稿条只反映当前页）
- `autoPageMode`：≤500 条 all，>500 按日；手动选过后不再被默认覆盖；随 tab 持久化（对齐 10-29-filter-state-persist）

## 3. 约束

- 白名单 = 上表 11 个文件；写出界即 out-of-scope park。
- 前插锚定**必须复用** `10-27-aisessions-virtual-row-stability` 的工具，不另造一套。
- 桶构建日界线用本地日历构造（`new Date(y,m,d)`），禁止 `ts - i*86400000`。
- rail 永不出滚动条（`overflow: hidden` + 只渲染可见行标记）。
- 时间格式遵循 `11-02-datetime-format-config`，不硬编码 `MM-DD`。
- 编辑器 Modal 与 `11-02-modal-single-shell-refactor` 的 DialogShell 对齐。
- i18n：新 UI 文案全部走 `frontend/app/i18n/`（11-14 已全量落地，禁止硬编码中英文字符串）。
