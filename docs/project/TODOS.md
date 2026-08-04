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
| P01 | 🔴 | `.mockup/shell-settings/` | 镜像 `pkg/util/shellutil/scanshells.go` 已不存在 | 查明新位置（如 shellutil.go）或移 `_to-delete` | 全扫描 0 引用，`ScanShells` 无结果 | 2026-08-04 |
| P02 | 🟡 | `.mockup/__REVIEW_GUIDE__.md` | `_to-keep/` 实为 9 项，多出 3 项未登记；顶层 `vcs-block-redesign.html` 未纳入 | 补登记或清理 | 首次对账单 | 2026-08-04 |

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