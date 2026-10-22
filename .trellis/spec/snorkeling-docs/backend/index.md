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
5. **AI 端点密钥的优先级只有一处定义。** 任何要拿 AI 端点密钥的代码（聊天链路、
   设置编辑器的 "Test connection" / "Fetch models" 探测）都必须走
   `aiusechat.ResolveAPIToken(apiToken, secretName)`：显式密钥（mode 的 `ai:apitoken`）
   优先，其次按名字读本机密钥库（`ai:apitokensecretname`）。不要在其它包里重写一遍
   取密钥逻辑——历史上正因为探测按钮与聊天链路各写一份，导致同一份 mode 配置
   “聊天能用、按钮 401”。
   - 探测类请求（GET 之类的无副作用读）**不得**因为没有密钥就提前失败：匿名端点要继续可用；
     但被 401/403 拒了必须说清楚原因（“no API key was sent: secret ... is not in the
     Settings > Secrets store”），不能只回传服务端的裸 401。
   - 会产生副作用的请求（Test connection 会真的跑一次 completion）保留前置拦截，
     但提示要点名是哪个 secret 没找到。
