# Snorkeling 同步巡检登记表（TODOS）

> 本表是检查→审批→执行→关闭的唯一登记入口。
> 生产工具：`audit-sync.mjs`（L1 硬查）+ `snorkeling-sync-audit`（L2 软查）+ `approval-ui.html`（审批）。
> 状态机：`⏳待审批 → ✅已关闭 / ❌已拒绝 / 💬待回复 / ⏸挂起`
> 审批触发：会话收尾合成清单 / 🔴危险信号立即 / 用户主动（见 sync-governance.md §9.2）。

## 基线（每次排查后更新）

- 上次版本基线：`0.14.5-beta.4.snorkeling.0.0.68`（2026-08-04）
- 基线日期：2026-08-04
- 仓库 HEAD：`13e787a5`（docs: sync-governance v1.2）
- 监控对象：`E:\code\snorkeling`（main）+ `.mockup/` + Obsidian `My Projects\Snorkling\`

## ⏳ 待审批

| ID | 级别 | 资产 | 问题 | 建议动作 | 证据 | 生成时间 |
|---|---|---|---|---|---|---|
| P01 | 🔴 | `.mockup/shell-settings/` | 原型 README 引 `pkg/util/shellutil/scanshells.go`（文件不存在）。**深度巡检精确定位**：`scanshells.go` 是方案文档（§七 ScanShells()）**规划中的新文件**，从未实现；当前实现基线是 `shellutil.go:88 DetectLocalShellPath()` + `DetectShellTypeAndVersionFromPath()`。属「原型引用了未来/未实现文件」，非迁移也非死引用 | **推荐：✅ 通过（更新镜像源，转机械修正）**。步骤：① `shell-settings/README.md` 镜像源改为现存 `pkg/util/shellutil/shellutil.go`（注明当前基线），保留「后续新增 ScanShells」说明；② 补一条「待求证：ScanShells() 尚未实现」到 README 待议区；③ 重跑 `audit-sync.mjs` 无缺失 | 深度巡检：方案 §七 明确「新文件 scanshells.go,导出 ScanShells()」=规划未实现；shellutil.go 有 DetectLocalShellPath(L88)/DetectShellTypeAndVersionFromPath(L502)；README 自述「真实后端走 scanshells.go(待实现)」 | 2026-08-04 |
| P05 | 🟡 | `.mockup/_to-delete/` | Agent 状态模块 4 个旧原型（`agent-status-current.html`/`agent-card-responsive.html`/`agent-terminal-redesign.html`/`terminal-agent-redesign.html`）无同步状态标记，且深色旧风格，已被真实代码完整实现取代（功能已落地：`agent-status-*.ts` 数据模型 + `block.tsx` 状态点渲染 + session-overview 三层汇聚） | **推荐：✅ 通过（确认清理/删除）**。步骤：① 抽查 4 项确认真实 UI 无复刻者遗漏；② 确认功能已落地（本登记即证据）；③ 移入 `_to-delete` 已满足流程，终审删除或归档 | 深度巡检：grep `AgentDisplayState` 16 个实现文件；`block.tsx` 显式「状态点渲染」注释；原型无同步标记 | 2026-08-04 |
| P02 | 🟡 | `.mockup/new-agent-panel/README.md` | 无「同步状态」标记、无「镜像源」、无「最后同步」 | **推荐：✅ 通过（补标记）**。步骤：在 README 顶部加三行——`> 同步状态：● 已落地`、`> 镜像源：frontend/app/view/term/envmodal.tsx`（或该原型实际镜像的组件）、`> 最后同步：2026-08-04`；需 agent 先 grep 确认该原型对应的真实组件再填 | L1 报告未标注 | 2026-08-04 |
| P03 | 🟡 | `.mockup/_to-keep/` | 实为 9 项，比登记多出 3 项（`aisessions-no-tag-filter`/`aisessions-path-filter`/`commontext-pinned-detail-insert`）。**深度巡检已确认落地矩阵**：9 项中 8 项对应真实代码/文档存在（aisessions/、commontext/、workspace/、theme.scss、design-system.md），仅 `combine-dashboard` 对应未实现的 `combinedashboard/` 组件（设计活跃待落地） | **推荐：✅ 通过（补登记，全部保留）**。步骤：① 在 `__REVIEW_GUIDE__.md` `_to-keep` 清单补入这 3 项（各注明对应真实组件已存在，作为设计资产保留）；② 无需删除任何项 | 深度巡检落地矩阵：`_to-keep` 9 项 → 8 项代码存在 + 1 项设计待落地（combinedashboard/ 缺） | 2026-08-04 |
| P04 | 🔴 | 未提交工作区 | 9 文件 44+/66- 未提交（connutil.go wsh 上传超时诊断 + connection-timeout 测试），与巡检系统无关 | **推荐：✅ 通过（独立 commit 保存）**。步骤：① 确认这批改动是「wsh 上传超时诊断」功能；② 单独 `git add` 这 9 个文件（**不含** package-lock.json）提交，message 如 `feat: wsh 上传超时诊断+测试`；③ package-lock.json 的 70 行无关改动单独审视，不该提交就还原 `git checkout -- package-lock.json` | `git status` 9 个 M/?? 文件 | 2026-08-04 |
| P06 | 🟢 | `.mockup/_to-keep/commontext-search-virtual.html` | 深度巡检 Common Text 模块：原型主张虚拟滚动，真实代码只采纳 limit 500（未真虚拟化），原型作为**待改进提案**保留（设计资产）——属健康状态，无需修 | **推荐：✅ 无需处理（设计资产）**。仅记录：若未来做真虚拟化，此原型是现成参考 | 深度巡检：`commontext-compose-modal.tsx:29 LIST_LIMIT=500`，无虚拟滚动实现 | 2026-08-04 |

> 此处为实时截图示：
> `node .mockup/audit-sync.mjs` 自动生成新的 🔴/🟡 条目后，agent 把它们追加到这里，
> 并将已属于「机械修正」的直接入 `<已自动修正>` 区。

## ✅ 已关闭

| ID | 级别 | 问题 | 处理 | commit | 关闭时间 |
|---|---|---|---|---|---|
| — | | | | | |

## ❌ 已拒绝

| ID | 问题 | 拒绝原因 | 时间 |
|---|---|---|---|
| — | | | |

## 💬 待回复（批注条文）

| ID | 问题 | 你的批注 | agent 修订后建议 | 时间 |
|---|---|---|---|---|
| — | | | | |

## ⏸ 挂起

| ID | 问题 | 挂起原因 | 时间 |
|---|---|---|---|
| — | | | |

## 📦 已自动修正（机械修正区，无需审批）

> 这些是机械事实修正：版本号过期 / 镜像路径失效 / 日期 / status 字段。
> 已自动执行并留 commit，若错误可 revert（见 §8.0/8.2）。

| ID | 自动修正内容 | commit | 时间 |
|---|---|---|---|
| — | — | — | — |