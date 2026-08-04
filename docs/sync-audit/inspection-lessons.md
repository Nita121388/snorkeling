# Snorkeling 巡检教训库（inspection-lessons）

> append-only：每轮巡检完追加一条，永不修改历史行。
> 教训来源：巡检发现的问题模式 → 下次该加什么检查规则 → 升级检查器/SKILL。
> 升级动作本身记录在 `evolution-log.md`。

## 首轮（2026-08-04）

- **问题模式**：镜像源文件在 git 重构中被改名/删除，README 里 `> 镜像源：` 引用的旧路径失效。
  实证：`shell-settings/README.md` 引用 `pkg/util/shellutil/scanshells.go`，全仓已 0 引用。
- **下次该加什么检查规则**：L1 检测到镜像缺失时，先尝试对仓库内 `ll文件名` 做模糊匹配（改名/迁移可能保留同名或近名文件），再报缺失，避免误报并可自动建议新路径。
- **配套**：把 `.mockup` 下 README 无「同步状态/最后同步」标记的，纳入 L1 检查（`new-agent-panel` 已漏标）。
