# A5.5 位置设置与大文件治理（rootdir + relocate + 轮转）

## Goal

人设家可以搬到大盘；搬家不丢人设、不断 git 历史、不把本机产物同步出去。

## Requirements

- `settings.json: "persona:rootdir"`（绝对路径、可写校验；可移动盘/网络路径黄色警告）
- 设置面板「🎭 人设」节：根目录选择 + 容量条（人设数/总大小/剩余空间）+ [迁移…] + 存储治理（journal 按月轮转、30 天休眠提示、50MB 软上限三动作）+ 单人设覆盖表
- `wsh persona relocate <new-root> --dry-run|--yes [--exclude] [--copy-not-move]`：清单 → 逐目录 move → 更新 settings → 重扫名册 → 校验文件数/字节数 → 失败回滚
- 只改 rootdir 不迁移 → 设置页黄条「X 个人设仍在旧位置」
- journal 满月轮转 → `.persona/MEMORY/archive/YYYY-MM.md`，主文件归零
- 容量口径三项分开（档案/归档/产物）

## Acceptance Criteria

- [ ] `go test ./pkg/persona/...` → ok（relocate 校验/回滚用例）
- [ ] `relocate --dry-run` 输出目录级清单且 mtime 不变（零写入）
- [ ] `--yes` 后新旧 rootdir 文件数一致、旧目录空、`git log` 行数前后一致
- [ ] 跨月写入触发轮转：archive 文件存在且 journal.md < 10KB
- [ ] 设置页三态（正常/黄条/非法路径）真机断言各 1 条

## 依赖

A1。
