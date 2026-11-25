# 执行计划：调查与 HTML 整改方案

> 本任务当前只做调查与规划；以下“实施”阶段是未来整改包的顺序，不在本轮执行。

## 本轮调查清单

- [x] 1. 建任务，锁定零功能回退、只读调查、HTML 交付约束。
- [x] 2. 盘点索引库结构、角色/来源分布、正文/thinking/索引大小。
- [x] 3. 在 `tmp/` 一致性副本上测列表、元数据、turn、详情、搜索、SaveMessages。
- [x] 4. 测删重复索引、user 部分索引、窄元数据表、整数 fk、独立正文表候选。
- [x] 5. 追踪 `Summary` 503 与 `LiveSessionState` 空响应调用链。
- [x] 6. 追踪 `DetailDelta(loadAll)` 的新鲜度缺失与写放大。
- [ ] 7. 补搜索候选基准（bulk / 流式 / SQL 自定义函数）与 loadAll fake-provider 复现。
- [ ] 8. 汇总调查报告，明确实测/推断/未证实边界。
- [ ] 9. 生成 HTML 整改计划（`collapse: true`，0 渲染错误）。
- [ ] 10. 清理 `tmp/aisessions-index-perf-bench/` 全部副本与中间产物。

## 未来整改包顺序（本轮不执行）

### P0-A：RPC 等待预算与 LiveSessionState

- [ ] `JsonlRpcProcess.Send` 支持 context cancellation。
- [ ] `GetState` 使用调用方 deadline；控制面默认 1.5s。
- [ ] `Summary(false)` miss 不 join 60s/120s flight；加请求侧预算。
- [ ] `Summary(refresh=true)` 与 List scan 统一协调。
- [ ] `LiveSessionState` disk fallback 整体有界，超时保持 `{live:false}`。

验证：

```bash
# 目标包测试（未来实施时）
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... ./pkg/web/..."
```

新增判据：短 deadline 快速返回、共享扫描只跑一次、503/空响应为 0。

### P0-B：loadAll freshness 修复

- [ ] continuation summary 带真实 mtime/size，或按 ID resolve。
- [ ] `saveSummaryTx` 不用缺失 freshness 覆盖已有值。
- [ ] >3 帧会话首帧后零 provider 重解析、零 SaveMessages。
- [ ] 保持 canonical 顺序、ItemKey、帧边界不变。

### P1-A：低风险索引维护

- [ ] 删除建表 DDL 中重复 `idx_ai_session_messages_session`。
- [ ] 已有库迁移 `DROP INDEX`。
- [ ] user 索引改 `WHERE role='user'`。
- [ ] 更新索引存在性测试与查询计划测试。
- [ ] 维护窗口 VACUUM；线上请求路径不 VACUUM。

### P1-B：additive 窄元数据 sidecar

- [ ] 新增 `session_fk` map + 窄元数据表 + 独立 generation。
- [ ] 同一事务 dual-write；检测旧二进制写入并重建 sidecar。
- [ ] turn/count/user 元数据 dual-read，宽表继续服务详情。
- [ ] feature flag 灰度；关闭 flag 即回滚。
- [ ] 最大会话 turn P50 ≤10ms，详情 P50 ≤基线 110%。

### P2-A：搜索优化

- [ ] 先上流式读取，消除 866MB 物化。
- [ ] 基准确认 SQL 自定义 `contains_lower` + `LIMIT 1` 是否达标。
- [ ] 若需 FTS/trigram，先做 Unicode/CJK/子串 false-negative 对拍。
- [ ] 结果逐条一致；P50 ≤1,500ms；否则保持旧实现。

### P2-B：增量 SaveMessages

- [ ] canonical prefix/diff 验证。
- [ ] 变化后缀原子替换；整会话替换保留 fallback。
- [ ] 最大正文/最大消息数写耗时不超过基线 110%。

## 风险文件（未来实施）

- `pkg/aisessions/manager.go`
- `pkg/aisessions/scancoordinator.go`
- `pkg/aisessions/sqlite_index.go`
- `pkg/aisessions/sqlite_read.go`
- `pkg/aisessions/chat/rpcprocess.go`
- `pkg/aisessions/chat/session.go`
- `pkg/service/aisessionsservice/aisessionsservice.go`
- `pkg/service/aisessionsservice/chatcontrol.go`
- `pkg/web/web.go`
- 对应 `*_test.go`

## 回滚点

- 每个未来实施包独立 commit、独立 flag/迁移。
- sidecar 不丢数据即可关闭；搜索可回旧 Go 路径。
- 索引迁移前必须备份；VACUUM 只在维护窗口。
- 任何详情/搜索/批注 parity 失败，立即停止切流。
