# A5 跨机同步 v1（rootdir 单仓 + gitignore 清单）

## Goal

人设跟着人走：换台机器 clone 下来，登场即恢复记忆。

## Requirements

- rootdir 作为 git 仓库（`wsh persona sync init|status|pull|push` 薄封装，或文档化 git 命令）
- `.gitignore` 按设计 §3.2：`*.local.json`、`work/`、`agents/`、`AGENTS.md`、`.index/`、噪声
- `persona.local.json: sync.mode = shared | own`（own = 该人设独立成仓）
- 跨机 clone 后首次登场自动重建 `.index/PERSONAS.md` 与 `agents/*`
- 冲突面：journal 追加型；冲突保留双方并写 inbox 提示（不静默丢）

## Acceptance Criteria

- [ ] 只有 `work/` 变更时 `git -C <rootdir> status --porcelain` 为**空**
- [ ] 双 clone 模拟：A 写 facts → push → B pull → B 登场读到（脚本断言）
- [ ] `git -C <rootdir> ls-files | grep -c "^.index/"` → `0`；`agents/` 同 → `0`
- [ ] journal 冲突合并后双条都在且 inbox 有提示

## 依赖

A1；A5.5（rootdir 已迁移场景）。
