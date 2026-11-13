# A5 设计 — rootdir 单仓同步 v1

## 1. 边界

| 层 | 文件 | 职责 |
|---|---|---|
| 数据 | `pkg/persona/persona.go`（已有 `SyncConfig`） | shared/own 数据模型 |
| 新增纯逻辑 | `pkg/persona/sync.go` | root gitignore、git 封装、生成物重建、journal 冲突合并 |
| CLI | `cmd/wsh/cmd/wshcmd-persona.go` | `persona sync <verb>` |
| 生成物复用 | `pkg/persona/scaffold.go` | `plannedFiles` 里挑 GENERATED 三项，不手写第二份模板 |
| 测试 | `pkg/persona/sync_test.go` | 临时目录 + 真 git，全机器判定 |

## 2. 契约

### 2.1 root .gitignore

`EnsureRootGitignore(root)` 幂等：缺文件则写 §3.2 清单；存在则只补缺失行，永不删用户内容。
清单 = `*.local.json` / `work/` / `agents/` / `AGENTS.md` / `.index/` / `*.lock` / `.DS_Store` / `Thumbs.db`。
注意 per-persona `.gitignore`（A1）已覆盖据点内路径，root 文件负责**整仓**口径（含子目录匹配）。

### 2.2 sync 子命令

| 子命令 | 行为 | 写入 |
|---|---|---|
| `init` | mkdir root、写 root .gitignore、`git init`（已有 .git 则 no-op）、返回 JSON 状态 | 是 |
| `status` | `git status --porcelain` + branch/remote/clean，未 init 时明确报错 | 否 |
| `pull` / `push` | `git pull` / `git push`，remote 缺失时透传 git 错误 | 是 |
| `rebuild` | 遍历 `List(root)`：为每人设重写 3 个 provider 契约 + 根 AGENTS.md；`WriteRoster(root)` 重建 L0 | 是（仅 GENERATED） |

`rebuild` 的不变量（单测锁）：CHARTER.md / MEMORY/* / persona.json / persona.local.json 的内容与 mtime 不变。

### 2.3 journal 冲突合并（纯函数）

```go
func MergeJournalTexts(ours, theirs string) string
```

- 两边按行合并、去掉空行与重复行，**保留双方独有条目**，稳定按行文本排序；
- 生成 `MEMORY/inbox.md` 提示由 `MergeJournalNote(id, kept int) string` 生成（含来源说明）；
- 不尝试理解 Git conflict markers —— `<<<<<<<`/`=======`/`>>>>>>>` 三行被识别后丢弃，两侧正文都保留。

### 2.4 sync.mode

`SyncModeShared = "shared"`，`SyncModeOwn = "own"`；`NormalizeSyncMode` 对空值返回 shared、非法值报错。
`SetSyncMode(root, id, mode)` 只改 `persona.local.json` 的 `sync.mode`，保留其它字段（幂等、原子替换）。

## 3. 风险与回滚

| 风险 | 处置 |
|---|---|
| rebuild 覆盖人写的 AGENTS.md | 只写 GENERATED 白名单四件（3 契约 + 根指针）；CHARTER/MEMORY 绝不碰 |
| git 不在 PATH | 测试用 `exec.LookPath` 跳过；CLI 报明确错误 |
| root .gitignore 覆盖用户自定义 | 只补缺失行，不删不改 |
| 同步把 work/ 传出去 | 单测断言 `git status --porcelain` 在只改 work/ 时为空 |

回滚：新增文件 + 一处 CLI 注册，`git revert` 单 commit，无迁移、无数据写。
