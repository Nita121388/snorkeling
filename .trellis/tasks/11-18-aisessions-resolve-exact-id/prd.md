# 会话定位只认精确 key/id：移除前缀匹配

## 做什么

- `pkg/aisessions/manager.go` `resolveSession`：去掉 `strings.HasPrefix(summary.ID, identifier)`，只保留 `Key == identifier || ID == identifier`。
- `pkg/aisessions/index.go` `Index.GetSession`（旧 JSON 索引）：同样去掉前缀分支与随之失效的「短前缀命中」注释。
- `pkg/aisessions/sqlite_index.go` `SQLiteIndex.GetSession`：删掉第 3 步 `id LIKE '<prefix>%'` 查询与 `escapeLikePrefix`。
- 更新 `sqlite_index_test.go` 里锁定前缀行为的断言：单前缀命中 → `session not found`，多前缀 → `session not found`；`%` 字面量仍 not found。
- 新增红证测试 `manager_exact_id_test.go`：精确 id 命中、截断 id 必须报错。

## 不做什么

- 不动 session key 的构造（`<source>:<id>:<filePath>` 与远端 `remote:<b64>` 段）与 remote 路由。
- 不收敛 `matches` 的排序逻辑（Key 精确优先保留）。
- 不动前端任何调用点：所有入口传的都是完整 key 或完整裸 id。

## 验收判据

```bash
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions -count=1"      # ok
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aisessionsservice -count=1"  # ok
```

红证（G2，已登记）：`go test ./pkg/aisessions -run TestManagerLoadRejectsTruncatedID` → FAIL（截断 id 静默命中）。
