# Snorkeling 进化 Log（evolution-log）

> **append-only**：只追加，永不修改、删除历史行。保证自我进化可追溯、可回滚。
> 每次 agent 主动改进自身（升级检查规则 / SKILL / 脚本 / 教训沉淀）必须写一行。
> commit 号在进化落地后回填，用于 `git revert`（sync-governance §8.2/12.1）。

| 日期 | 进化内容 | 改动对象 | 触发来源 | 证据/commit |
|---|---|---|---|---|
| 2026-08-04 | 首建巡检系统，audit-sync 参数化并支持 --json | audit-sync.mjs / README / TODOS / approval-ui | 系统落地 | 见首次提交 |
| 2026-08-04 | 范式修正：文件对齐→功能模块三处对齐；新增 modules.md 模块基线；深度+增量巡检 | sync-governance §4 / modules.md / SKILL | 教训 L01（用户指正） | 本 commit |