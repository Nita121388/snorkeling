> **Confirmed: 2026-11-23 @nita**

# Hero 定时执行后端（方案 A）：ScheduledTaskType 加 hero 字段 + hero home cwd + block meta 注入

## Goal

让调度任务能绑定一个 hero：到点执行时以 hero home 为工作目录、默认继承 hero 的 provider/model，
并在 mode=block 建块时注入前端同口径的 hero meta，使 A4 名册 / hover 卡 / AISessions 聚合能认出这是 hero 任务。

复用现有调度系统（方案 A），不新建调度器。

## Requirements

### 做什么

1. **模型字段**：`pkg/wconfig/settingsconfig.go` 的 `ScheduledTaskType` 增加可选 `Hero string `json:"hero,omitempty"``
   （hero id）。零值时行为与现状完全一致（字节级：不写 JSON 字段）。
2. **派生解析（单点实现，读路径唯一）**：
   - 任务带 `Hero` 且 `Workdir` 为空 → workdir 默认 `<hero root>/<hero id>`（root 取现有 hero root 口径，
     即 `pkg/hero.ResolveRoot/DefaultRootDir` 或 wconfig 中对应设置，不要另造一份）；
   - provider / model / thinking 缺省时取 `hero.json` 的声明值；任务显式值**优先**（空串视为缺省）；
   - hero id 不存在 / hero.json 读不到 → 回落到现状行为并记一条明确日志，**不报错、不阻断调度**。
3. **mode=block 建块**：`pkg/wshrpc/wshserver/scheduledtask.go` 的 `launchBlockForTask` 注入 block meta
   - `hero` = hero id（键名对齐前端 `AgentHeroIdMetaKey`），`hero:name` = 非空展示名（对齐 `AgentHeroNameMetaKey`）；
   - `cmd:cwd` = hero home（第 2 条的 workdir 解析结果）。
4. **mode=headless**：进程 cwd = hero home；run 记录仍落现有 `~/.snorkeling/scheduledtask-runs/`。
5. **CLI / MCP 口径**：`cmd/wsh/cmd` 的 scheduled task 相关读写命令能读能写 `hero` 字段（JSON 透传即可，别另立 flag 体系）；
   帮助文本一句话说明。
6. **单测**（判据按函数名 grep，必须是这三个名字，多余测试不要带 `Hero` 前缀）：
   - `TestScheduledTaskHeroDefaults`：hero 字段 → workdir 默认 hero home；provider/model 默认取 hero.json；显式值覆盖；
     hero 不存在时回落不报错。
   - `TestScheduledTaskHeroBlockMeta`：mode=block 时 block meta 含 `hero` 与 `hero:name`（非空），`cmd:cwd` = hero home。
   - `TestScheduledTaskHeroHeadlessCwd`：headless 时 cwd = hero home，run 记录文件新增 1 个。
   合计断言 ≥ 10。

### 不做什么

- 不新建调度器、不改 cron 解析 / 启动补跑 / 配额（agent 10 个）逻辑。
- 不改前端（Overview 定时任务区与编辑弹窗 hero 选择器在 `N-1123-hero-sched-ui`）。
- 不动 hero scaffold / journal / sync / rename / relocate。
- 不改 `AgentLaunchRequest` 结构（除非上一条注入必须；改动需在 PR 说明中列出）。

## Acceptance Criteria

- [ ] `go build ./...` → `GO_BUILD_OK`
- [ ] `go test -count=1 ./pkg/scheduler/... ./pkg/wshrpc/wshserver/... ./pkg/wconfig/... ./pkg/hero/...` → `GO_TESTS_OK`
- [ ] `go test -count=1 -run Hero -v ./pkg/scheduler/... ./pkg/wshrpc/wshserver/... ./pkg/wconfig/... | grep -c -- "--- PASS"` → `3`
- [ ] 红证：先写三个测试（对现状必红），红输出存 `loop/red/N-1123-hero-sched-core.txt`，再实现转绿
- [ ] 无 hero 字段的老任务：调度行为与 settings JSON 字节级不变（自检方式写进 pr 说明）

## Notes

- 判据是「命令 → 期望输出」，不接受"我看了一下没问题"。
- 越界写 = 该包 abort：只允许 `touch` 白名单内文件。
- 不提交、不记台账、不动看板（主 agent 收口）。
