# Implement：Hero 定时执行后端

## 顺序清单

1. **先红**：写 `pkg/wshrpc/wshserver/scheduledtask_hero_test.go` 三个指名测试（引用尚不存在的 `Hero` 字段 → 编译/断言红），
   红输出存 `loop/red/N-1123-hero-sched-core.txt`。
2. 模型：`ScheduledTaskType` 加 `Hero string`（omitempty），老任务零值不变。
3. 派生：单点 `resolveTaskExecution`（显式值 > hero.json > 现状默认；hero 缺失 → 现状 + 日志）。
4. block：`launchBlockForTask` 注入 `hero` / `hero:name`，`cmd:cwd` = 解析后 workdir。
5. headless：cwd = 解析后 workdir；run 记录照旧。
6. CLI/MCP：命令透传 `hero` + 帮助一行。
7. 转绿：三个 Named 测试全 PASS；`go build ./...` 过。

## 验证

```bash
go build ./... && echo GO_BUILD_OK
go test -count=1 ./pkg/scheduler/... ./pkg/wshrpc/wshserver/... ./pkg/wconfig/... ./pkg/hero/... && echo GO_TESTS_OK
go test -count=1 -run Hero -v ./pkg/scheduler/... ./pkg/wshrpc/wshserver/... ./pkg/wconfig/... 2>&1 | grep -c -- "--- PASS"   # 期望 3
```

## 回滚点

- 常量开关 `ScheduledTaskHeroEnabled`（默认 true）；关掉即忽略 `Hero` 字段，行为回现状。
- 无 schema 迁移、无数据写入，回滚无需修数据。
