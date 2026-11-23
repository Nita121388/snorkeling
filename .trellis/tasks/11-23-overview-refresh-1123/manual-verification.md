# 人工复现步骤（nita 手动跑，2026-11-23）

> 自动化台 `scripts/verify/overview-refresh/verify.mjs` 保留备用，但**本轮以人工结果定性**。
> 每步只回答一个问题，结论按文末矩阵映射到假设 H1-H4。

## 准备

1. 用最新构建（0.0.136 之后的本地 dev 或新包）打开 app。
2. 打开一个 **Overview 块**（列表视图 + 看板视图各看一次），确保它是"当前工作区的那个 Overview"。
3. 打开 DevTools Console，粘这一段，记下输出（Tab 名 + 块数）：

```js
const g = await import('/frontend/app/store/global.ts');
const ws = g.globalStore.get(g.atoms.workspace);
console.log('workspace', ws?.oid, ws?.tabids?.length);
console.table(ws.tabids.map((t) => { const tab = g.WOS.getObjectValue('tab:' + t); return { name: tab?.name, blocks: (tab?.blockids ?? []).length }; }));
```

## 步骤（每步记"出现 / 不出现 / 多久出现"）

| # | 动作 | 期望 |
|---|---|---|
| S2a | 在**当前激活 Tab** 里新建一个 agent block（Overview 的「＋Agent」或 CommonText 新建都行） | Overview 列表 + 看板 2 秒内出现该卡 |
| S2b | 在**后台 Tab**（未激活）里同样新建一个 agent block | 该 Tab 的组里 2 秒内出现该卡 |
| S3 | 鼠标 hover 刚才那个**已激活 Tab** 的 Tab 头 | 悬浮卡里 agent 行数 = 实际 agent 块数（含新增那个） |
| S1 | AISessions 列表里「恢复」一个会话 → 回到 Overview | 2 秒内出现这张恢复出来的卡 |
| **对照** | 每步不出现时，**按 Ctrl+R 刷新窗口**（或切到别的 Tab 再切回 OverView），再复看 | 刷新后出现 → 是"不重算/不订阅"；刷新后仍不出现 → 是"数据/过滤" |

## 结果矩阵（把每步结果告诉我，我据此定性）

| 现象 | 结论 |
|---|---|
| 刷新后出现 | **H1/H2 成立**：派生 atom 未被重算 或 新块 oref 未被订阅/懒加载没触发 → 修 `useOverviewBlocks`/`getTabCardDataAtom` 的订阅与 memo 键 |
| 刷新后仍不出现，且 Console 里该 Tab 的 `blocks` 计数**是 +1** | 数据到了、渲染被过滤 → 查 `buildTabGroups`/`shouldShowFullOverviewBlock`/过滤器 |
| 刷新后仍不出现，且 Console 里 `blocks` 计数**没变** | 后端 `tab.blockids` 没更新（建块路径只写 layout 不写 tab）→ 查 `CreateBlockInTab` 链路 |
| 只有 hover 期间不更新、移开再 hover 就对 | **H3 latch** → 修 `InfoCardPortal`/hover 打开期间的数据快照 |
| 每步都正常（人工看都对） | **H4**：之前的现象是视图/工作区错位，不是 bug → 关掉本包，改文档说明"Overview 只显示当前工作区" |

## 需要额外确认的一句

S1 那次你看到没卡时，看的 Overview 是哪一个：Tab 栏里叫 **OverView** 的那个 Tab，还是别的视图？
（数据层面本会话块在 ws `07361d21` tab `sessions`，而 Overview 块在 tab `OverView` —— 同工作区，理论可见。）
