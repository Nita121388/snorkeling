# Implement — 会话定位只认精确 key/id

提交：`fix(aisessions): 会话定位只认精确 key/id，移除三处 id 前缀匹配`（N-1118-resolve-exact-id）。

## 实际改动

- `pkg/aisessions/manager.go` `resolveSession`：删除 `strings.HasPrefix(summary.ID, identifier)` 分支。
- `pkg/aisessions/index.go` `GetSession`：同上；顺带删掉随之失效的「短前缀歧义」报错守卫（匹配集里已不可能出现非精确命中）。
- `pkg/aisessions/sqlite_index.go` `GetSession`：删除第 3 步 `id LIKE '<prefix>%'` 查询与 `escapeLikePrefix`。
- `pkg/aisessions/sqlite_index_test.go`：单前缀/多前缀断言由「命中/歧义」改为 `session not found`；`%` 字面量断言不变。
- `pkg/aisessions/manager_exact_id_test.go`（新增红证）：精确 id 命中、截断 id 必须报错。

## 验证

| 命令 | 结果 |
|---|---|
| `go test ./pkg/aisessions -count=1` | ok（48s；一次 Windows TempDir 清理锁 flake 重跑通过） |
| `go test ./pkg/service/aisessionsservice -count=1` | ok（82s） |
| 红证 `TestManagerLoadRejectsTruncatedID`（修前） | FAIL：expected error for truncated id, got nil |
| gitnexus detect_changes (staged) | 11 files，risk low |

## 已知边界

- 所有前端入口传的都是完整 key 或完整裸 id，无一依赖前缀行为（grep 复核过 Detail/Summary/Mark/Note/RestoreContext 调用点）。
- GitNexus 对 `resolveSession` 的 upstream 影响评级是 HIGH（9 个直接调用方），本次改动只收窄非法输入的匹配，不改任何精确命中的行为。
