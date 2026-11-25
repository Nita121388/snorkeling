# 技术设计：AI Sessions 索引性能整改（零功能回退）

> 本设计只描述计划，不代表已实施。生产代码、当前 SQLite、会话 JSONL 均不改。
> 基准快照：`tmp/aisessions-index-perf-bench/baseline.sqlite`，3,420,934,144B，`quick_check=ok`。

## 1. 已证实瓶颈与排除项

| 结论 | 证据 | 含义 |
|---|---|---|
| 列表摘要 pipeline P50 103.438ms | 5,225 个可见会话，11,145 行，5.4MB 返回 | 不是 43s 级瓶颈 |
| 单会话元数据 P50 0.332ms | key 精确查询 + meta/tags/props | SQLite 命中路径健康 |
| 最大会话 turn starts P50 30.338ms | 5,944 条消息，2,494 cache miss | 可优化，但不足以解释 503 |
| 最大正文详情 P50 39.072ms | 25.93MB 正文，154 行 | 宽表顺序读并不慢 |
| 当前全文搜索 P50 4,318.829ms | 拉取 866,101,849B 文本 | **主要用户可感知性能缺陷** |
| 朴素 SQL `instr(lower(text))` P50 8,859ms | 全表 1,175,748 FULLSCAN_STEP | **禁止直接替换**，且 Unicode 语义不等价 |
| SaveMessages 最大正文 P50 424.604ms | 整会话 DELETE+INSERT | 写放大真实存在 |
| SaveMessages 最大消息数 P50 503.939ms | 5,944 条 | 同上 |
| 重复 session 索引 295,862,272B | 与 PK 自动索引列完全一致 | 纯冗余 |
| user 全角色索引 278,548,480B | 1,175,749 个 key | 可改部分索引 |
| user 部分索引 14,364,672B | 64,517 个 user key | **减少 94.84%** |
| 整数窄元数据 44,875,776B | 1,175,749 行 | turn 扫描 30.338→9.195ms |
| 独立正文表 equijoin P50 2,761.496ms | cache miss 18,890→477,527 | **70.7× 回退，暂缓拆表** |

基准限制：cold 是新连接首次执行，不是物理冷盘；读取器 cache_size≈2MB、mmap=0；候选 A/B 顺序执行，部分毫秒差可能来自 OS 缓存/负载。存储大小、查询计划、扫描行/页/字节是硬证据。

## 2. RPC 超时根因与修复边界

### 2.1 Summary

链路：`Summary(false)` → `resolveSession(allowStale=true)` → live registry → SQLite → **miss 时 `refreshAllSummaries`** → join 已有 flight。

- HTTP `/wave/` 有 21s `TimeoutHandler`（可配置最高 60s）：`pkg/web/web.go:548-550`。
- `http.Server.WriteTimeout` 固定 21s：`pkg/web/web.go:576-580`。
- List 后台 scan 预算 60s：`pkg/aisessions/scancoordinator.go:34-37`。
- `Summary(refresh=true)` 后台 refresh 预算 120s：`pkg/aisessions/manager.go:51-54`。
- joiner 只受 HTTP ctx 约束，没有独立请求预算：`pkg/aisessions/scancoordinator.go:227-235`。

结果：TimeoutHandler 先写 → 503 `"Timeout"`；WriteTimeout 先断 socket → `ERR_EMPTY_RESPONSE`。

**修复**：
- polling Summary 的 SQLite miss 不 join 60s/120s flight；给请求侧独立预算（建议初始 1.5s，可配置），超时返回现有可重试错误/pending 形状。
- 无 flight 时保留现有 8s 同步扫描或转后台后立即 pending。
- Detail 的 `allowStale=false` 语义不放宽。
- `Summary(refresh=true)` 的新会话提升语义保留，但后台刷新必须与 List scan 共用协调，不能另起 `ScanSummaries` 并发全量扫。

### 2.2 LiveSessionState

两条超时路径：

1. live GUI chat：`GetState(ctx)` 忽略 ctx，`rpc.Send` 固定 30s：`pkg/aisessions/chat/session.go:291-309`、`pkg/aisessions/chat/rpcprocess.go:43-48,144-160`。
2. disk fallback：`CurrentModelState → Summary(false)` 可 join 长 scan；tail miss 后 `manager.Load` 还可全量读正文/触发 SaveMessages：`pkg/aisessions/types.go:261-274`、`pkg/service/aisessionsservice/chatcontrol.go:116-141`。

**修复**：
- `JsonlRpcProcess.Send` 增加 context-aware 变体，`GetState` 真正响应 deadline；控制面请求初始预算 1.5s。
- `LiveSessionState` 整体 best-effort 有界；超时返回现有 `{live:false}`，前端已保留 requested model 并允许重试。
- disk fallback 先走窄元数据/有界 tail；只有一致性测试通过后才移除 legacy full-load。
- Claude/OpenCode 的 model fallback 单独实现，不靠全量 Load。

### 2.3 loadAll 写放大（代码已证实，待运行时复现补强）

`DetailDelta` continuation summary 只填 `Key/ID/Source/FilePath/MessageCount`，没有 `MTime/Size`：`pkg/service/aisessionsservice/aisessionsservice.go:1268-1283`。

随后 `LoadDelta` 跳过 resolve，`loadAllDelta → loadMessages`；`GetMessages` 因 mtime/size=0 必 miss，provider 整文件解析，`SaveMessages` 整会话 delete+insert，并把 mtime/size 写回 0：`pkg/aisessions/manager.go:752-830`、`pkg/aisessions/sqlite_index.go:1496-1527,1547-1582,2090-2140`。

**修复**：
- continuation 必须携带真实 mtime/size，或每帧按 ID 重新解析 summary（不能把 0 当真实值）。
- `saveSummaryTx` 拒绝用缺失 freshness 覆盖已有非零值。
- 第一帧建立缓存后，后续 loadAll 帧的 provider LoadMessages/LoadToolCalls/SaveMessages 新增次数都应为 0。
- 该修复不改帧边界、消息顺序、ItemKey 或返回内容。

## 3. 索引整改：分阶段，不一次性换库

### 阶段 A：低风险索引维护

1. 从建表 DDL 删除 `idx_ai_session_messages_session`；对已有库执行一次 `DROP INDEX`。
2. 查询自动改用 `sqlite_autoindex_ai_session_messages_1`；计划和扫描量不变。
3. `idx_ai_session_messages_user` 改为 `WHERE role='user'` 的部分索引。
4. 更新 `TestSessionMessagesUserIndexExists`，不再要求重复索引存在，并断言部分索引条件。
5. 文件缩小需要 VACUUM；VACUUM 只在应用关闭/维护窗口做，不在 RPC 请求路径做。

**兼容风险**：旧二进制打开库时会用 `CREATE INDEX IF NOT EXISTS` 重建重复索引。共存期要么接受临时重建，要么用 maintenance 设置控制；不能宣称旧版本下空间仍保持。

### 阶段 B：additive 窄元数据 sidecar（推荐核心方案）

不删宽表、不拆正文表，新增：

```
ai_session_message_map(session_fk INTEGER PRIMARY KEY, session_key TEXT UNIQUE)
ai_session_message_meta(
  session_fk INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  timestamp INTEGER,
  tool_name TEXT,
  thinking_present INTEGER NOT NULL,
  char_count INTEGER,
  text_nonblank INTEGER NOT NULL,
  text_preview TEXT,          -- 可选，120 rune，服务 UserRows/TurnHead
  generation TEXT NOT NULL,  -- 独立新鲜度
  PRIMARY KEY(session_fk, seq)
) WITHOUT ROWID
```

- 外部 `SessionSummary.Key` 不变；整数 fk 只在单个 origin/connection DB 内有意义。
- 宽表 `ai_session_messages` 保持完整正文与旧路径兼容。
- sidecar 带独立 `generation/count/hash`，不能只靠 mtime/size 判断新表是否同步。
- dual-read：turn/count/user 元数据优先 sidecar；缺失/版本不符回退宽表。
- dual-write：同一事务写宽表 + sidecar；旧二进制写入宽表后，新二进制能识别 sidecar stale 并重建。
- 切流用 feature flag；回滚只需停止读 sidecar，不丢数据。
- 待详情 join/溢出页问题解决后，才评估独立正文表；本轮基准已证明直接拆表会严重回退。

### 阶段 C：搜索优化（独立灰度）

目标：保持当前 `strings.ToLower(strings.TrimSpace(query))` + `strings.ToLower(text)` + `strings.Contains` 的 Unicode 子串语义，不把 SQLite ASCII `lower()` 当等价。

候选优先级：

1. **流式逐行处理**：不 `SELECT text` 全量物化，降低 866MB 峰值内存；I/O 仍可能大。
2. **SQL 内自定义 `contains_lower(text, query)` + 每会话 `LIMIT 1`**：函数用 Go `strings.ToLower/Contains`，提前命中，不把正文传到应用层；需基准确认。
3. **FTS5 trigram/外部索引**：只能作为加速器，必须做 false-negative 对拍；CJK、标点、Unicode 大小写、跨 token、超长 tool text 全部验证。未证明前不替换。

搜索不包含 thinking，GUI List query 不搜正文，详情内搜索是前端子串；三条路径不能混为一谈。

### 阶段 D：增量写入

先完成 loadAll freshness 修复，再考虑 SaveMessages 增量：

- provider 返回完整 canonical 列表，不能简单按最大 seq append；pi 分支展开可能重排 seq。
- 必须先 diff/验证 canonical prefix；变化后缀才替换，整会话替换仍保留为 fallback。
- 元数据、正文、summary/file marker 在同一事务提交。
- 用最大正文/最大消息数/小会话三组样本做 parity 与写耗时回归。

## 4. 功能影响矩阵

| 功能 | 阶段 A | 阶段 B | 搜索优化 | RPC/loadAll 修复 | 硬验收 |
|---|---|---|---|---|---|
| 列表/筛选 | 无行为变化 | 无 | 无 | Summary 可能返回 pending/旧值 | 结果集合、排序、分页一致 |
| 详情完整加载 | 无 | 宽表仍 authoritative | 无 | 首帧后 continuation 不重写 | text/thinking 字节一致 |
| 全文搜索 | 无 | 无 | 有风险 | 无 | Unicode/CJK/子串结果完全一致 |
| 批注/锚点 | 无 | 不引入双锚点 | 无 | 无 | 旧 seq 锚点不 orphan |
| 轮次分页 | 无 | sidecar 读取 | 无 | 无 | `ComputeTurns` 与 SQL parity |
| stale/强一致 | 无 | generation 不能误判 fresh | 无 | Summary 与 Detail 分工保持 | mtime/size 变化可识别 |
| remote/origin | 无 | fk per-DB | 无 | 有界超时 | 同名会话不串 key |
| 实时模型卡 | 无 | 可加速 disk fallback | 无 | 30s→1.5s | requested model 回退保留 |

## 5. 可观测性与验收门

### P0 修复门

- `Summary` / `LiveSessionState` 不再出现 >21s 请求；503/空响应为 0。
- `GetState` 100ms deadline 下 100ms 级返回，共享扫描不被取消。
- loadAll >3 帧：首帧后 provider 解析/工具扫描/SaveMessages 新增次数为 0，freshness 非零且真实。

### 索引门

- 删重复索引 + user 部分索引后，逻辑空间减少 594,694,144B；VACUUM 后文件约 2,826,240,000B（-17.38%）。
- user count/page 查询计划不变。
- 最大会话 turn starts P50 ≤10ms（基线 30.338ms）。
- 最大正文详情 P50 不超过基线 110%（39.072ms → ≤43ms）。

### 搜索门

- 结果与当前实现逐条一致；返回字节/峰值内存显著下降。
- P50 目标 ≤1,500ms（基线 4,318.829ms）；若候选达不到，保持现状并单独迭代，不为指标破坏语义。

### 写入门

- 最大正文 SaveMessages 不超过基线 110%（424.604ms）；最大消息数不超过 110%（503.939ms）。
- 增量方案必须通过 canonical parity、事务原子性、旧消息可更新测试。

## 6. 回滚

- 阶段 A：保留迁移前备份；重索引可在维护窗口重建。旧二进制可能重建重复索引。
- 阶段 B：feature flag 关闭即回旧宽表；sidecar 可删除重建，不影响 note/tags/props/annotations。
- 搜索优化：按 flag 回旧 Go 搜索。
- RPC 修复：按方法/环境开关回退，但不得恢复 30s 无 context 等待。
- loadAll freshness 修复是正确性修复，不回滚到写 0。

## 7. 证据边界

- 已证实：存储构成、查询基线、候选索引收益、宽表详情耗时、搜索传输量、RPC 超时机制、loadAll 缺 freshness 代码链。
- 待运行时补强：43.65s 各阶段耗时、搜索候选最终收益、loadAll 实际调用次数、写锁争用。
- 安全例外：备份期间运行中的 Snorkeling 改写了原库；只读 WAL 打开与新 sidecar 时间接近，不能严格证明原库零触碰。快照 `quick_check=ok`；后续不再打开原库。
