# 诊断中心（Diagnostics Hub）— AI 调用审计 × 运行日志 融合原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/aiaudit/aiaudit-view.tsx, frontend/app/view/aiaudit/aiaudit-model.ts, frontend/app/view/aiaudit/aiaudit-format.ts, pkg/pslog/pslog.go
> 最后同步：2026-11-12

关联设计：`design/plans/project-logging.md`（日志系统 §7 读取面 / §9 与 AI Audit 边界）、`design/plans/commontext-background-send.md`（§4.4 提示条、§7 剩余风险）

打开：直接双击 `index.html`。冒烟测试：`node design/prototypes/logging/diagnostics-hub/smoke.test.cjs`（30 项断言，PASS/FAIL 退出码）。

---

## 1. 要解决什么

项目现在有两个互不相通的面：

- **AI 调用审计**（`aiaudit-view.tsx`）：用户视角，"我让 AI 做了什么、成没成"。数据在 DB，有翻页、统计、详情抽屉。
- **运行日志**（本设计新增）：开发者视角，"哪一步慢、哪一步错了、哪个进程、什么码"。JSONL 文件 + CLI。

同一个现实问题（"这次生成为什么失败"）需要两边一起看，如果做成两个块，排查就是来回切。**融合的目标不是合并存储**（设计文档 §9 已写死边界），而是让两个数据源在**同一个界面骨架**里可互跳、可对照、可一起导出。

## 2. 三个候选方案

| 方案 | 形态 | 代价 | 结论 |
|---|---|---|---|
| A 独立日志块 | 新增 `view=log` 块，与 AI Audit 并列 | 两个块 + 两套筛选栏 + 无法对照 | ❌ 排查仍要切的窗口，合并不了 |
| B 审计视图内加 tab | 在现有 AI Audit 块里加"运行日志" tab | 改动小，但审计的"清空 30 天/统计"语义会被日志污染 | ❌ 两个视图语义不同（业务 vs 诊断），共用一个块头会让人误以为是同一份数据 |
| **C 统一诊断中心 + 联合时间线** | 一个视图、三个 tab（审计 / 日志 / 联合时间线）、共享详情抽屉、双向跳转 | 需新增 view 类型与两套数据源适配 | ✅ **采纳**：骨架共享、语义分离、提供只有"合"才能得到的视角（联合时间线） |

选 C 的关键理由：**联合时间线是 A/B 都给不了的能力**。排查失败时，"审计条目前后发生了什么日志" 比"知道有日志"重要得多。

## 3. 融合契约（双向链接规则）

| 方向 | 触发 | 行为 |
|---|---|---|
| 审计 → 日志 | 审计行 / 抽屉「查看相关日志」 | 切到日志 tab，搜索框预设 `block:<blockid>`，顶部黄色来路横幅（可一键清除） |
| 日志 → 审计 | 日志抽屉「回到审计条目」 | 切回审计 tab，**直接打开该条目详情抽屉**，横幅标注来路 |
| 共用关联键 | `blockid` 优先，`sessionref` 兜底 | 与日志设计 §4「跨进程关联约定」一致：FE 铸的 `fe-<n>` 传不到后端，所以不用 traceid 做跨面关联 |
| 共享抽屉 | 审计条目 / 日志事件 | 同一抽屉组件，两种内容形态；各自底部列出"另一侧"的关联项，点即跳 |
| 导出诊断包 | 失败审计条目 | 生成 Markdown：审计 JSON + 关联日志 JSONL + "仅含不透明引用"声明 |

## 4. 界面结构

```
proto-bar   场景切换 / 明暗主题
toolbar     视图 tabs（审计 · 日志 · 联合时间线）+ 视图专属筛选 + 搜索 + 危险/工具动作
banner      跨视图跳转来路提示（可清除）
stats       统计条（同排版，三种内容）
list        日分组列表（审计表 / 日志表 / 联合时间线）
drawer      共享详情抽屉（右滑，440px）
modal       诊断包预览
```

**对齐真实组件的部分**（不是自由发挥）：

- 审计列宽沿用 `aiaudit-view.tsx` 的 `columnWidths`（`112px / 180px / auto / 96px / 84px / 78px / 56px`，此处合并为 7 列）
- 筛选文案沿用真实值：`All features` / `Title` / `Note & Tags` / `Timeline` / `Field`，搜索占位 `Search session / model / error / key`
- 状态 pill 五态与配色取 `aiaudit-format.ts` 的 `StateMetaMap`（done / failed / running / queued / cancelled）
- 统计条顺序沿用真实实现：`24h calls` → `failed`（可点筛）→ `avg` → 24 小时柱状 → feature chips
- 危险动作两步确认沿用 `Clear 30d` → `Confirm clear 30d`

**新增的部分**（本原型要拍板的设计新增点）：

- 视图 tabs 与第二套筛选（level / comp / domain）
- 日志行结构：时间 / 级别 / 组件 / `domain/event` / outcome / 耗时
- 联合时间线：同一轴上的两种徽标（蓝=AI 审计，灰=日志）
- 限流与预算的系统行（`log-dropped count=82`、预算百分比）
- 隐私关闭的整页说明（`log:level=off` 时日志视图只剩说明，但**审计不受影响**——这正是两个数据源分离的价值演示）

## 5. 场景矩阵

| 场景 | 演示什么 |
|---|---|
| 正常 | 三视图数据、关联提示（`· 3 条关联日志`）、可互跳 |
| 失败风暴 | 错误批量输入 → 前端限流聚合行 + 目录预算行；统计条同时给出丢弃数与预算占用 |
| 隐私关闭 | `log:level=off` 整页说明；审计照常有数据；统计条显示 `off` |
| 空态 | 三视图各自的空态文案 |

## 6. 与设计文档判据的对应

| 判据 | 本原型覆盖 |
|---|---|
| S6 打开日志目录 | toolbar「打开日志目录」按钮（第一版只有目录，无面板） |
| S7 commontext 四事件 | 日志视图 mock 含 `send-start/queued/inject/fallback/fail` 五条，且可被审计条目关联 |
| S13 `log:level=off` | 「隐私关闭」场景 |
| **建议新增 S14** | 融合跳转：审计→日志 blockid 预设、日志→审计回开抽屉（本原型 smoke test 已断言） |
| **建议新增 S15** | `log:level=off` 时 AI 审计仍可用（数据源分离的可验证断言） |

## 7. 明确未做（不在本原型范围）

- 真实分页（`AuditPageSize=100` 游标）与 `Load more` 只是占位
- 日志 `tail --follow` 的实时流（按钮存在，行为未模拟）
- 导出诊断包未接剪贴板/文件（只渲染预览）
- 应用内"日志面板"这一独立块类型：本原型是**唯一**要做的面，避免再开第三个入口

## 8. 待拍板

1. 融合形态是否采纳 C（统一诊断中心三视图）？还是保留 AI Audit 独立块 + 另开 Diagnostics 块（回到 A）？
2. 联合时间线是否第一版就要（它需要两套数据源同时按时间窗拉取，成本主要在"审计按 ts 拉、日志按 ts 读文件"的对齐）？
3. 诊断包导出的落地形式：剪贴板 Markdown / 存文件到 `docs/answers/` / 直接生成 issue 模板？
4. 视图 tabs 的默认落点：打开块时默认审计（现状兼容）还是联合时间线（排查优先）？
