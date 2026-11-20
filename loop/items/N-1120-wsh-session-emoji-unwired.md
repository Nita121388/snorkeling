---
id: N-1120-wsh-session-emoji-unwired
title: "wsh CLI 接线 bug：session emoji 命令组不可达（init() 漏 AddCommand）"
type: bug
priority: P1
severity: S2
status: open
origin: self
source: "nita 2026-11-20 布置：0.0.132 已装二进制 strings 可见 emoji 文案但 wsh session emoji 返回 unknown command"
task: 11-20-wsh-session-emoji-unwired
order: 100
touch: [cmd/wsh/cmd/wshcmd-session.go, cmd/wsh/cmd/wshcmd-session_test.go, loop/red/N-1120-wsh-session-emoji-unwired.txt, loop/**]
rollback: null
budget: {minutes: 60, retries: 2}
releaseCandidate: false
createdAt: "2026-11-20T00:45:31Z"
---

# wsh CLI 接线 bug：session emoji 命令组不可达（init() 漏 AddCommand）

## 背景

commit 2c94b2c6e 新增 session emoji 功能（后端字段/推荐注入/MCP 六工具），但 wshcmd-session.go 的 init() 注册 sessionCmd 子命令时漏了 sessionEmojiCmd，其 5 个子命令只挂在自身身上，导致整组 CLI 不可达。修法：把它加进 sessionCmd.AddCommand 列表，另补顶层回归测试锁住 sessionCmd 子命令集合。

## 来源

- self：nita 2026-11-20 布置：0.0.132 已装二进制 strings 可见 emoji 文案但 wsh session emoji 返回 unknown command

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./cmd/wsh/cmd/ -run TestSessionCmdSubcommandsRegistered -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./cmd/wsh/cmd/ -run TestSessionEmojiCmdSubcommandsRegistered -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./cmd/wsh/cmd/ -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./cmd/wsh; if ($LASTEXITCODE -eq 0) { echo WSH_BUILD_OK }"` → `WSH_BUILD_OK`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go run ./cmd/wsh session emoji --help"` → `recommendations`

## 记录

- 修前红证：`loop/red/N-1120-wsh-session-emoji-unwired.txt` → 5 判据 3 红（顶层接线测试红 / 全包测试红 / help 不含 recommendations），且 TestSessionEmojiCmdSubcommandsRegistered 单独绿（子命令挂上了但整组不可达）、go build 绿（能编译但接线漏）。
- 修后绿证：prove 5/5 ok；新编二进制 `tmp/wsh-session-emoji/wsh.exe` 的 `session emoji --help` 列出 get/set/inject/recommendations/prefs，`session --help` 列出 emoji。
- 踩坑：prove 判据命令走 cmd.exe → PowerShell 双层解析，`''` 单引号转义与 `&&` 在 PS5 无效，判据命令避免内层引号与 `&&`。
