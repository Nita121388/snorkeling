# 会话定位只认精确 key/id：移除前缀匹配

> 背景：用户 2026-11-18 反馈「有时候打开的 sessions detail 内容和 Header 对不上」。诊断
> （docs/answers/session-detail-header-mismatch-20261118-1251.html）发现 `resolveSession` /
> `Index.GetSession` / `SQLiteIndex.GetSession` 三处都有 `HasPrefix(ID, identifier)` 前缀匹配，
> 唯一命中时静默返回另一个会话。

## Goal

1. 三处会话定位全部收成精确匹配（`key == id` 或裸 `id == id`）；截断的 id 一律 `session not found`。
2. 行为用测试锁定：红证测试修前红、修后绿。

## Requirements

- **R1** `pkg/aisessions/manager.go` `resolveSession`：删除前缀分支；匹配集内不再需要非精确守卫。
- **R2** `pkg/aisessions/index.go` `Index.GetSession`：同 R1（旧 JSON 索引同步收口）。
- **R3** `pkg/aisessions/sqlite_index.go` `SQLiteIndex.GetSession`：删除第 3 步 `id LIKE '<prefix>%'`
  与 `escapeLikePrefix`；精确 key/id 两步查询保留。
- **R4** `sqlite_index_test.go` 前缀行为断言改为 not found；新增 `manager_exact_id_test.go`
  （精确 id 命中 + 截断 id 报错）。

## 非目标

- 不改 session key 构造与 remote 路由（`remote:<b64>` 段）。
- 不改前端调用点（全部传完整 key 或完整裸 id）。
- 不动 matches 排序（Key 精确优先保留）。

## Acceptance Criteria（必须机器可判）

| # | 判据 | 命令 → 期望 |
|---|---|---|
| A1 | 后端测试全绿 | `go test ./pkg/aisessions -count=1` → ok |
| A2 | 服务层测试全绿 | `go test ./pkg/service/aisessionsservice -count=1` → ok |
| A3 | 红证（修前） | `go test ./pkg/aisessions -run TestManagerLoadRejectsTruncatedID` → FAIL（截断 id 静默命中）→ 修后 ok |
