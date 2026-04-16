# 上游同步与发布 Playbook

更新时间：2026-04-17

## 目标

- 持续同步 Wave 官方更新
- 维持 Snorkeling 定制能力
- 避免把本地实验性分支污染发布分支

## 分支约定

- `upstream/main`：官方主线镜像（只同步，不直接开发）
- `main`：Snorkeling 可发布主线
- `refactor/snorkeling`：当前开发分支

## 同步步骤（建议）

1. 拉取官方更新到本地：
   - `git fetch upstream`
2. 更新本地同步分支：
   - `git checkout -B upstream-main upstream/main`
3. 回到 Snorkeling 主线并 rebase：
   - `git checkout main`
   - `git rebase upstream-main`
4. 处理冲突后运行验证：
   - `npm exec -- eslint frontend`
   - `npm exec vitest run frontend/app/workspace/agent-launch.test.ts`
   - `go test ./...`
5. 合并回开发分支：
   - `git checkout refactor/snorkeling`
   - `git rebase main`

## 冲突优先级

- 优先保留官方安全修复与基础能力
- Snorkeling 定制能力以最小侵入方式重新叠加
- 涉及 Agent 启动/配置逻辑冲突时，优先保留以下行为：
  - 按终端上下文智能打开
  - 多终端显式选择
  - profile 配置驱动启动命令

## 发布策略

- 每次同步后先走 CI，再打 tag 发布
- 仅对通过 `Snorkeling CI` 的 commit 打 `snorkeling-v*` tag
