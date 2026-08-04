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
| P01 | 🔴 | `.mockup/shell-settings/` | 镜像 `pkg/util/shellutil/scanshells.go` 已不存在，且 `shellutil.go` 中无 `ScanShells` 函数（彻底死引用，非改名） | 更新 README 镜像源为实际实现的 `shellutil.go` / `tokenswap.go` / `wshinstallscript.go`，或评估该原型是否仍需保留 | 全仓 grep `scanshells\|ScanShells` 无结果；`ls pkg/util/shellutil/` 无此文件 | 2026-08-04 |
| P02 | 🟡 | `.mockup/new-agent-panel/README.md` | 无「同步状态」标记、无「镜像源」、无「最后同步」 | 补三行状态标记，并填写镜像源（若已落地标 ●） | L1 报告未标注 | 2026-08-04 |
| P03 | 🟡 | `.mockup/_to-keep/` | 实为 9 项，比登记多出 3 项；`new-agent-vendor.html` 等未在 REVIEW_GUIDE 总表登记 | 补入 REVIEW_GUIDE 总表或确认去留 | 首轮对账 | 2026-08-04 |
| P04 | 🔴 | 未提交工作区 | 9 文件 44+/66- 未提交（connutil.go wsh 上传超时诊断 + connection-timeout 测试），与巡检系统无关 | 归入独立 commit 保存，避免工作区污染（尤其 package-lock.json 混入） | `git status` 9 个 M/?? 文件 | 2026-08-04 |

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