# A5.5 设计 — rootdir / relocate / 轮转 / 容量

## 边界

| 层 | 文件 | 职责 |
|---|---|---|
| 配置 | `pkg/wconfig/settingsconfig.go` | `persona:rootdir` + 治理键 |
| 纯逻辑 | `pkg/persona/relocate.go` | `PlanRelocate` / `Relocate`（跨盘 copy 回退 + 校验 + 回滚）/ `StorageOf` / `RotateJournal` |
| 写路径 | `pkg/persona/journal.go` | `AppendJournal` 跨月自动轮转（best effort） |
| app 侧根解析 | `pkg/service/aisessionsservice` | `personaSettingsRoot()` → `persona.ResolveRoot(root)` |
| CLI | `cmd/wsh/cmd/wshcmd-persona.go` | root 优先级、`relocate` / `stats` / `journal rotate`、settings 合并写 |
| 设置面板 | `frontend/app/view/waveconfig/personasettings.tsx` | 根目录 + 容量三项 + 迁移 + 治理开关 |

## 契约

- root 优先级：`--root` > `PERSONA_ROOT` > `settings.json persona:rootdir` > `~/.snorkeling/personas`。
- relocate：dry-run 零写入；apply 逐目录 move（`os.Rename`，跨盘 `copy+remove`），逐条校验
  （文件数/字节数），失败按已搬列表逆序回滚；`--copy-not-move` 保留旧副本；成功后
  `wconfig.SetBaseConfigValue({"persona:rootdir": newRoot})`（受校验的合并写，不重写文件）。
- 容量三项：档案 = `.persona/` 去掉 `MEMORY/archive`；归档 = `MEMORY/archive`；产物 = `work/`；
  `syncable = 档案 + 归档`。
- 轮转：journal 行时间戳月份 ≠ 当前月 → 追加到 `MEMORY/archive/YYYY-MM.md`（按行分月），
  主文件只留当前月与注释头；`AppendJournal` 写入前 best-effort 轮转。
- 设置面板：draft + 单一 Save；迁移按钮先 dry-run 展示清单再 apply；容量条读 `persona stats`。

## 风险

| 风险 | 处置 |
|---|---|
| relocate 半途失败丢人设 | 逐条校验 + 逆序回滚；单测注入失败 |
| settings 被重写丢用户键 | 用 `SetBaseConfigValue` 合并写；`PERSONA_ROOT` 时跳过 |
| 轮转把当前月条目也搬走 | 按行解析 RFC3339 月份，只搬非当前月；单测断言 |
| 容量口径混算 | 三桶分离 + `syncable` 显式字段 |

回滚：新增文件 + 配置字段 + 面板注册，`git revert` 单 commit，无迁移。
