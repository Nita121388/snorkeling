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
| P02 | 🟡 | `.mockup/new-agent-panel/README.md` | 无「同步状态」标记、无「镜像源」、无「最后同步」 | **推荐：✅ 通过（补标记）**。步骤：在 README 顶部加三行——`> 同步状态：● 已落地`、`> 镜像源：frontend/app/view/term/envmodal.tsx`（或该原型实际镜像的组件）、`> 最后同步：2026-08-04`；需 agent 先 grep 确认该原型对应的真实组件再填 | L1 报告未标注 | 2026-08-04 |
| P03 | 🟡 | `.mockup/_to-keep/` | 实为 9 项，比登记多出 3 项；`new-agent-vendor.html` 等未在 REVIEW_GUIDE 总表登记 | **推荐：✅ 通过（补登记）**。步骤：把 `_to-keep/` 下 9 个 html 逐一比对 `__REVIEW_GUIDE__.md` 分类，将缺失的 3 项（`new-agent-vendor.html` 等）按格式补入总表；**保留全部 9 项，不删** | 首轮对账 | 2026-08-04 |
| P04 | 🔴 | 未提交工作区 | 9 文件 44+/66- 未提交（connutil.go wsh 上传超时诊断 + connection-timeout 测试），与巡检系统无关 | **推荐：✅ 通过（独立 commit 保存）**。步骤：① 确认这批改动是「wsh 上传超时诊断」功能；② 单独 `git add` 这 9 个文件（**不含** package-lock.json）提交，message 如 `feat: wsh 上传超时诊断+测试`；③ package-lock.json 的 70 行无关改动单独审视，不该提交就还原 `git checkout -- package-lock.json` | `git status` 9 个 M/?? 文件 | 2026-08-04 |

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