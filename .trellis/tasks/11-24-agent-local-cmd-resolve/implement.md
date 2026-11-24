# 执行计划：Agent 块本机启动命令解析

## 顺序（红证先行）

1. **红证测试（前端）** — `frontend/app/workspace/agent-launch.test.ts` 增加用例组：
   - local + 解析成功 → 绝对路径
   - local + 解析为空 → 裸 cmd（不抛错）
   - local + 含空格路径 → 裸 cmd
   - local + `.cmd` 后缀 → 裸 cmd
   - remote 既有断言不变
   命令：`npm run test -- agent-launch` → 前 4 条中至少「local + 解析成功」为红。记录红证输出。

2. **前端核心实现** — `agent-launch.ts`：
   - 抽出 `shouldUseLocalResolvedCmd(resolved)` 守卫；
   - `resolveAgentBlockCommandForLaunch` 放开本机分支（远程逻辑零改动）。
   命令：`npm run test -- agent-launch` → 全绿。

3. **调用面收口** — `session-overview.tsx`（submitAddAgent / new-tab-with-agent）、`hero-launch.ts`（或调用点）接入解析。补 DOM/单测断言（至少 submitAddAgent 提交的 blockDef.meta.cmd），命令：`npm run test -- session-overview`。

4. **后端** — `clientservice.ResolveLocalCommand` 薄导出 + `agentlaunch.go` 本机解析与守卫；单测：tmp HOME 里造 `~/.opencode/bin/opencode`，断言 meta.cmd 绝对路径；空格/空结果保持裸 cmd。
   命令：`go test ./pkg/service/clientservice/... ./pkg/wshrpc/wshserver/...` → 全绿。

5. **全量检查** — `npx tsc --noEmit`（或仓库既有 typecheck 脚本）+ `npm run test` 相关包；go 全量 touched 包测试。

6. **真机验证** — GUI 启动 Snorkeling（带 `--remote-debugging-port`）：
   - New Agent → OpenCode 建块 → 块内无 `command not found`，提示符正常；
   - Overview add-agent → OpenCode 建块 → 同样正常；
   - 反证：`~/.opencode/bin` 不在 app 进程 PATH 时（GUI 启动即满足）必须仍是绝对路径 cmd。
   台账：`docs/project/verify-ledger.md` 记一行结论，证据进 `verify-runs/`（gitignore）。

7. **spec 回写** — `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`（或就近 spec）加硬约束：「本机 agent 块 cmd 必须解析为绝对路径；守卫规则三条（空/空格/shim 后缀）」+ 方法论坑位。

8. **提交** — 前端/后端分两个 commit；commit 前跑 `detect_changes()`（GitNexus）确认影响面只有 agent 启动链路。

## 验证命令清单

```bash
npm run test -- agent-launch
npm run test -- session-overview
npm run test -- workspace
go test ./pkg/service/clientservice/... ./pkg/wshrpc/wshserver/... ./pkg/blockcontroller/...
npx tsc --noEmit
```

## 回滚点

- 步骤 2 后：前端核心可独立 revert（调用面未接，行为回到今天）。
- 步骤 4 后：后端独立 revert（不影响前端已解析的块）。

## loop 队列

按 `AGENTS.md`：夜间实现需 `loop/queue.mjs` 工作项 + `touch` 白名单。本任务若走夜班，入队前先写 touch 白名单（`frontend/app/workspace/agent-launch.ts`、`frontend/app/session-overview/session-overview.tsx`、`frontend/app/workspace/hero-launch.ts`、`pkg/service/clientservice/clientservice.go`、`pkg/wshrpc/wshserver/agentlaunch.go` + 对应测试）。注意：`task.py create` 的 loop hook-bridge 本机失败（配置里是 Windows 路径 `E:/primary/projects/loop/bin/loop.mjs`），入队需手动执行或先修 hook 路径。
