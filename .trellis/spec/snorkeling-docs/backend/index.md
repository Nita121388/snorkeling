# Backend Development Guidelines

> 本项目的后端（Go / `pkg/**`）约定与不变量。

---

## Guidelines Index

| Guide | Description | Status |
|---|---|---|
| [AI Sessions 扫描与加载契约](./aisessions-scan-contract.md) | 全量扫描 single-flight + 时间/内存预算；轮询允许 stale、详情要求 current；进度事件契约 | 有效 |

---

## 通用约定（本项目实证）

1. **重活必须有预算。** 遍历用户数据（会话文件、索引、目录扫描）的路径要同时具备
   时间预算与内存预算，并且可被单个 env 开关关闭（便于线上排查）。
2. **并发共享而不是并发重复。** 同一份昂贵结果，多个调用方应 join 同一个 calculation
   （参见 `pkg/aisessions/scancoordinator.go` 的 flight 实现），不要每个 RPC 各跑一遍。
3. **包依赖单向。** `pkg/aisessions` 不 import `wps`；需要向前端推进度时用回调，
   由 `pkg/service/*` 层转事件。
4. **不写用户数据。** 扫描/索引类代码只读 agent 写入的文件（`~/.pi`、`~/.codex`），
   派生数据一律落在 Snorkeling 自己的索引里。
