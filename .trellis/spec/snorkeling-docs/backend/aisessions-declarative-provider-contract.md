# AI Sessions 声明式 Provider 契约（后端 + 前端来源面）

> 适用范围：`pkg/wconfig`（`agent:sessionproviders`）、`pkg/aisessions`（声明式 provider 与注册）、`pkg/service/aisessionsservice`（`GetSourceList`）、`frontend/app/view/aisessions`（来源清单）。
> 来源：2026-11-26 `11-26-aisessions-declarative-provider`（Antigravity 首个受益者）。

## 为什么有这个契约

会话历史扫描的 provider 原本全部编译期硬编码在 `DefaultProviders()`（codex/claude/opencode/pi）。
接入一个新 agent（如 Antigravity）必须改 Go 代码 + 发版。声明式 provider 把「数据源在哪、列怎么映射」
降级为配置数据，代码只保留两类东西：内置默认条目表，和一个 `sqlite` 类型的通用实现。

## 必须遵守的不变量

### 1. 声明式 provider 只读，且必须是 `Provider` 接口的正常公民

- 打开外部 db 一律 `mode=ro`（对齐 `provider_opencode.go` / ccswitch 的只读 DSN）。绝不写 agent 数据。
- 必须走 `Manager` 扫描链路（single-flight / 预算 / 新鲜度，见 `aisessions-scan-contract.md`），
  **不得**新增第二个扫描入口。
- 必须实现 `SummaryFileProvider`（`ListFiles`/`ParseSummary`）。少一个实现，`collectScanUnits`
  就会整体退回非预算的 legacy 路径——这是沉默的性能回归，已有实测教训。

### 2. 配置合并语义对齐 agent catalog

- `agent:sessionproviders` 是 map，key = source id。
- 合并 = 内置默认条目 ∪ 用户配置；同 key **逐字段**覆盖（`{"antigravity":{"disabled":true}}`
  只关这一个字段，不丢内置 table/columns）。
- `disabled: true` 剔除；`type` 缺省当 `sqlite`，显式写未知类型则跳过（不静默改写）。
- 注册额外有 `os.Stat` 门：db 不存在就不注册（跨机干净，无扫描错误噪音）。

### 3. 列缺失允许，字段级降级

- 列映射是字段 → 列名，缺列只影响对应字段，不让整次扫描失败。
- 时间解析失败回退 0（排序退化），记日志，不 error。
- `FilePath` 优先 per-conversation 文件（存在时），否则 `<summarydb>#<id>`。原因：索引变更检测以
  `file_path` 为键，多会话共用一个 summary db 路径会失去身份。

### 4. 消息正文不是声明式能力

- `LoadMessages` 对声明式 provider 返回空 slice + nil error。Antigravity 的会话正文是 protobuf blob
  （`conversations/<uuid>.db` 的 `steps.metadata`），没有公开 schema，声明式无法表达。
- 详情页必须能优雅降级：只要求挂载不崩，不做正文承诺。要正文时写专用 Go provider（编译期通道）。

### 5. 来源清单只有一个真源

- 前端不得再维护「来源全集」。`CHAT_SOURCES` 降级为图标/label 兜底与内置 4 源的补全提示。
- 来源全集来自 `AISessionsService.GetSourceList`（编译期 4 源 ∪ 声明式配置条目，含 `available`）。
- 持久化的筛选值不能因为「不在内置集合」被清空：`sanitizeSource` 接受合法 id 模式（`^[a-z0-9][a-z0-9_-]{0,63}$`）。
- 未知来源样式走现有中性回退（`bg-secondary` 点 + `getAgentIcon` 首字母/emoji 链），**不得**为新 agent 写专属样式类。

## 已知边界

| 边界 | 现状 | 出路 |
|---|---|---|
| Antigravity 正文（protobuf） | 不支持，详情只有头信息 | 专用 Go provider |
| `jsonl` 声明类型 | 未实现（本期只做 `sqlite`） | 同一合并/注册框架下加类型分支 |
| 外进程/第三方 provider | 未实现 | 独立方案（子进程 JSON-RPC），不在本契约内 |

## 验证

- 单测：`go test ./pkg/aisessions ./pkg/wconfig ./pkg/service/aisessionsservice`
- 真机台：`node scripts/verify/aisessions-declarative-source/verify.mjs`
  （会话可见 / 筛选面板有配置 label / 过滤后只剩该来源 / 详情挂载不崩）
