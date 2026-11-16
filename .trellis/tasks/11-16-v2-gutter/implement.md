# 实施清单 — B1

> 判据先行：每步动手前写得出「命令 → 期望输出」。全程对照原型 `design/prototypes/aisessions/aisessions-timeline-v2/`。

## Step 1 · RPC 游标（后端唯一改动）

- [x] `pkg/service/aisessionsservice` `Annotations` 加 `cursor/limit`（主文档 §3.3 SQL）— 2026-11-16
- [ ] 验证：`go test ./pkg/aisessions ./pkg/service/aisessionsservice -run Annotation`（游标边界 / hasMore / limit 夹取 / 不带 cursor=最新页）
  - 注：本机需 `GOPROXY=https://goproxy.cn,direct`（proxy.golang.org 不可达）；提交时尚未跑完，待补
  - 落实方式：`PageAnnotationViews` 在重锚定**之后**分页（先分页会在过期 seq 空间算页边界、漏标窗口外 orphan）

## Step 2 · 桶构建纯函数

- [x] `annotation-model.ts`：`buildTimeBuckets / bucketOf / kind 元数据（含 node 菱形）`— 2026-11-16
- [x] `annotation-model.test.ts`：桶边界 / DST（3月+11月）/ 缺失 ts → unknown / 空桶 gapDaysBefore / 单条 / 同 seq 多条 — 35 例
- [x] 验证：`npx vitest run frontend/app/view/aisessions/annotation-model.test.ts` → 35/35 通过
- 附带：`opts.labelFor` 注入点 = 11-02 时间格式对接点；i18n `annotationRail.today/yesterday/unknownTime` + `annotationCard.kind.node`（en/zh）

## Step 3 · store 窗口化

- [ ] `annotation-store.ts`：window/cursor/evict（§3.7 上限）/invalidate（§3.6 矩阵 8 行）；保留 v1 全量接口
- [ ] `annotation-store.test.ts`：失效矩阵逐行、驱逐（永不驱逐最新桶、atEarliest 独立）、并发迟到丢弃
- [ ] 验证：`npx vitest run frontend/app/view/aisessions/annotation-store.test.ts`

## Step 4 · 分页模式纯函数

- [ ] `computePages() / scopeSeqs()`（model 层，可单测）：all/day/turn/interval/count、页 id 稳定、count 尾锚定
- [ ] 测试：五种模式切页、翻到最旧页补数据、跳转自动切页、作用域收窄
- [ ] 验证：`npx vitest run`（新测试文件）

## Step 5 · rail gutter 化

- [ ] `annotation-rail.tsx`：行对齐 marker（rAF 同步 + getOffsetForIndex）、类型色实心核、浮动工具条、过滤弹层（5 类含 node）、端帽 `↑N`（加载/错误态）、轴 scrub、草稿条、折叠未读、键盘 roving focus（§4.4）
- [ ] `annotation-rail.dom.test.tsx`：8 态矩阵 + 键盘 + aria 契约
- [ ] 验证：`npx vitest run frontend/app/view/aisessions/annotation-rail.dom.test.tsx`

## Step 6 · 卡片来源徽章 + 导航

- [ ] `annotation-card.tsx`：徽章三档（B1 先 You/✨AI；🤖 留桩）、`‹ 1/5 ›` 上下条、Edit 入口、外部条目只读态（B1 只读桩）
- [ ] `annotation-card.dom.test.tsx`：徽章、导航边界（首条无上一条）
- [ ] 验证：`npx vitest run frontend/app/view/aisessions/annotation-card.dom.test.tsx`

## Step 7 · session-detail 集成

- [ ] `session-detail.tsx`：日分段头挂载 + 前插 scrollTop 补偿（同帧）+ `pageMode/intervalHours/countSize/lockPageId` state + 翻页条 + 详情头视图 chip + autoPageMode（≤500 all / >500 day）+ tab 持久化（对齐 10-29）+ 设置「默认分页方式」
- [ ] `timeline-virtual.ts`：暴露 `seqToTimestamp`（无行为变更）
- [ ] 验证：`npx vitest run frontend/app/view/aisessions`（整目录全绿）

## Step 8 · 全量检查 + 真机验证

- [ ] `npm run lint && npx tsc --noEmit`（或项目等价命令，走 scripts/run-task.mjs）
- [ ] 原型 smoke：`node design/prototypes/aisessions/aisessions-timeline-v2/smoke.test.cjs`
- [ ] 真机：`node scripts/verify/index.mjs --area aisessions-timeline`（性能预算：首屏 RPC ≤100 条、rail DOM ≤120 节点、P95 派生 ≤2ms、60fps）
- [ ] 台账：`docs/project/verify-ledger.md` 一行结论；i18n 硬编码 grep（新 UI 文案全走 key）

## 门与回滚

- 每 Step 一个可回滚 commit；Step 5 是最大风险点（视觉重做），先出灰盒（数据真、样式粗）再精修
- B2/B3 不在本包：动 `pkg/aisessions/annotations.go` / wsh CLI / MCP 即出界
- 完成定义：测试矩阵全绿（主文档 §7 表）+ verify ledger 入库 + 原型对照走查（8 态 × 明暗主题）
