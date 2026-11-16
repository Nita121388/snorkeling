# 技术设计 — B1 前端分页 + 视觉

> 完整规格在主文档 `design/plans/aisessions-annotation-timeline-v2.md`（§3 分页协议 / §4 视觉交互 / §6 落地批次）。本文件只记 B1 范围内的边界、契约与取舍，不复制主文档。

## 1. 数据流（B1 后）

```
session-detail.tsx
  ├─ annotation-store.ts ── window {buckets, oldestCursor, newestCursor, hasMoreOlder}
  │      └─ Annotations RPC (cursor, limit=100)   ← B1 唯一后端改动
  ├─ annotation-model.ts ── buildTimeBuckets / computePages / scopeSeqs  （纯函数）
  ├─ AnnotationRail (52px) ── 行对齐 gutter：marker.y = 行屏幕 y（rAF 同步，虚拟行用 getOffsetForIndex）
  └─ Flow ── BucketSection(日分段头 + 消息行)×N + GapRow；前插 scrollTop 补偿
```

## 2. 核心契约（照主文档实现，逐条单测锁定）

### 2.1 RPC 游标（主文档 §3.3）

- 复合游标 `(beforeSeq, beforeId)`，严格前缀式排序键 `(seq ASC, id ASC)`
- SQL：`WHERE session_key=? AND (?2=0 OR seq<?2 OR (seq=?2 AND id<?3)) ORDER BY seq DESC,id DESC LIMIT ?4+1`（多取 1 判 hasMore，不用 OFFSET）
- `limit` 默认 100，夹取 [20,500]；cursor 缺省 = 最新页（旧调用兼容，等价回滚出口）

### 2.2 游标失效矩阵（主文档 §3.6，8 行逐行单测）

判定口径：排序键空间变了 = 失效；尾部增删 = 不失效。AI 重生成替换 drafts / 重锚定 / 会话文件重写 / 切筛选 / 切会话 → 整窗 invalidate 回最新页。

### 2.3 窗口驱逐（§3.7）

`MaxBuckets=5、MaxEntries=2000`；驱逐距视口最远的桶，永不驱逐最新桶；`atEarliest` 与 `hasMoreOlder` 分开两个布尔。

### 2.4 桶构建（§3.2）

- `dateKey` 取**锚点消息时间**（不是批注创建时间）；本地日历日界线
- 缺 ts → `unknown` 桶排最后，不静默丢弃；空桶不生成只记 `gapDaysBefore`
- `turn` 分页：user 消息 seq 定轮，页 id `t:<user seq>`；`count` 尾锚定从最新端切块（页 id `c:<页首 seq>`）；`interval` 页 id `i:<windowStartTs>`；`day` 页 id `d:YYYY-MM-DD`

### 2.5 前插锚定（§3.8）

```
delta = scrollHeight_after - scrollHeight_before; scrollTop += delta
```
同一帧内 `useLayoutEffect`/rAF 完成；复用 10-27 virtual-row-stability 的锚定工具；`scrollTop < 200px` 预取，失败静默重试 1 次。

### 2.6 gutter（§4.2b）

- marker y = 目标消息行屏幕 y；虚拟列表下取 `virtualizer.getOffsetForIndex`，不读 DOM rect
- 视口外 marker 不渲染；`RailBody { overflow: hidden }`
- 相邻 marker 最小间距 `MarkerMinGap = 16px`；同行多条 → `clusterRailItems` 合簇
- rail 头改绝对定位浮动工具条，不占轴线高度
- 点数 > 120 → 聚簇（不允许缩到看不见）

### 2.7 分页模式（§4.2c）

- `pageMode ∈ {all, day, turn, interval, count}`；非 all 模式顶部翻页条 `‹ 今天 · 11-11 · 2/2 · 7 条消息 ›`
- 主入口 = 详情头右侧视图 chip；上下文入口 = 翻页条文字可点；默认值 = 设置「默认分页方式」；每 tab 持久化（connection+sessionKey），菜单内「跟随默认」
- `autoPageMode`：≤500 → all，>500 → day；`pageModeUserSet` 后不被覆盖
- 分页只在前端渲染层；数据加载仍是 §3.3 游标分页，两回事
- 端帽 `↑N` 只在 all 模式出现；跳到不在当前页的消息 → 先切页再定位
- scopeSeqs() 收窄：rail 标记 / 悬浮卡 / kind 过滤计数 / 草稿条 / 读数只反映当前页

## 3. 状态与持久化

- `session-detail.tsx` 新增 `pageMode / intervalHours / countSize / lockPageId` state；`computePages() / scopeSeqs()` 纯函数（进 model 层可单测）
- 持久化对齐 `10-29-aisessions-filter-state-persist` 的 tab 状态通道（connection+sessionKey 键）
- 分页弹层与翻页条是轻量浮层，**不走** DialogShell；编辑器 Modal 走 DialogShell

## 4. 视觉 token（主文档 §4.2 表，B1 全量）

rail 52/16px；8px 类型色实心核（核内左上高光 + kind 色 30% 柔光晕；禁近黑核）；草稿空心 / 孤儿 warning / agent 角标 5px / 轴 2px 双端渐隐 / hover 24px 光晕 140ms / 分段头 sticky 84% + 相对日期 chip / 密度微条 4×15px / 卡 320px max-height 62vh / flash 1200ms / 前插无动画。

## 5. 兼容与回滚

- v1 全量接口保留：`Annotations` 不带游标 = 最新页（≤ 上限 500 条时与旧语义等价）
- rail gutter 化是视觉重做，但卡片/编辑器数据流不动（B2 才加 author 字段；B1 卡片来源徽章先按 `source` 字段渲染 You/✨AI，🤖agent 档 B2 接线后自动出现）
- 回滚：B1 前端改动一个 commit；RPC 游标参数可缺省，老前端等价

## 6. 风险

| 风险 | 缓解 |
|---|---|
| gutter 滚动同步掉帧 | rAF 合并批量、只读一次偏移；性能预算 60fps 写进测试矩阵 |
| 前插闪一帧空白 | 必须同帧 useLayoutEffect；DOM 测试断言无中间帧 scrollHeight 跳变 |
| DST 桶边界差 1h | 日历构造 + 单测锁 3 月/11 月边界 |
| 分页模式 × 虚拟滚动 × 锚定三方叠加回归 | computePages/scopeSeqs 纯函数先行单测，DOM 测试覆盖切页不丢滚动位置 |
| 硬编码文案违反 i18n | 全部走 i18n key，check 阶段 grep 硬编码字符串 |
