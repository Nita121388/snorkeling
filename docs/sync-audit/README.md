# Snorkeling 同步巡检系统（sync-audit）

> 基于 skills 的 Snorkeling 项目巡检系统：自动检查 → 登记 → 审批 → 执行 → 关闭，且每次巡检自我进化。
> 系统代码全部集中在本文件夹，git 管理，可整体复制 / 回滚 / 带走。

## 核心原则

1. **事实源分层**：代码 > 事实源文档 > 镜像。镜像不独立写新内容。
2. **自动只到「检查 + 登记」**：所有修改动作必须人工审批。
3. **一切可回滚**：修改独立 commit + 修改前快照（`snapshots/`）+ commit 号追溯。
4. **审批减负担**：一次一条、置信度徽章、💬批注、批量绿灯、随时退出续审。
5. **自我进化**：每次巡检沉淀教训 + 写进化 Log，下次更高效。

## 文件说明

| 文件 | 作用 |
|---|---|
| `sync-governance.md` | 系统设计（v1.2：三层检查 / 闭环 / 回滚 / 时间管理 / 进化Log） |
| `TODOS.md` | 登记表（待审批 / 已关闭 / 已拒绝 / 💬待回复 / 挂起 / 已自动修正） |
| `approval-ui.html` | 审批界面（双击打开，逐条 / 批注 / 批量绿灯） |
| `audit-sync.mjs` | L1 硬查脚本（扫 `.mockup/` 校验收镜像源） |
| `inspection-lessons.md` | 教训库（append，每轮巡检沉淀问题模式） |
| `evolution-log.md` | 进化日志（append-only，每次 agent 自我进化写一行，commit 可回滚） |
| `snapshots/` | 修改前快照（回滚兜底） |

## 用法

### L1 硬查（静默常驻，问题才出声）
```bash
node docs/sync-audit/audit-sync.mjs          # 可读报告
node docs/sync-audit/audit-sync.mjs --json    # 结构化 JSON（供审批/agent）
```
退出码：0=干净；1=有 🔴/🟡。

### 手动巡检
```
对 agent 说：「巡检」或「检查原型」
→ 跑 L1(--json) + L2(agent 语义软查)
→ 生成待审批清单 → 打开 approval-ui.html 审批
→ 按决策执行（独立 commit + 快照）→ 重跑验证 → 关闭
```

### 审批界面
```
双击 docs/sync-audit/approval-ui.html
```
键盘：1通过 / 2拒绝 / 3批注 / 4稍后 / g批量绿灯 / Esc取消；进度存 localStorage 可续审。

## 触发时机（sync-governance §9）
- **巡检**：实时（commit/版本变化，仅 L1 静默）· 会话级（收尾 L1+L2）· 按需
- **审批**：会话收尾合成清单 / 🔴危险立即 / 用户主动

## 状态标记（写原型 README 用）
```
> 同步状态：▲ 设计活跃 ｜ ● 已落地 ｜ ▼ 过时待清理 ｜ ◐ 部分落地
> 镜像源：frontend/xxx.tsx, pkg/yyy.go
> 最后同步：YYYY-MM-DD
```