# AI Sessions 索引性能基线报告

> 数据源：运行中索引的一致性快照，3,420,934,144B，`quick_check=ok`。
> 原始基准：`tmp/aisessions-index-perf-bench/REPORT.md`（任务结束前会清理 tmp，关键数字已固化到本文）。
> 机器：Windows 11 / 16 逻辑 CPU / 可用内存约 3.27GB；读取器 cache_size≈2MB、mmap=0。

## 1. 安全边界

- 快照通过 SQLite backup API 生成，未执行 DDL/VACUUM 到原库。
- 备份期间运行中的 Snorkeling 改写了原库；只读 WAL 打开与新出现的 `-shm/-wal` 时间接近，**不能严格证明原库 sidecar 零触碰**。
- 快照本身一致且 `quick_check=ok`；备份后未再打开原库。
- 所有 DDL、VACUUM、写入基准都在 `tmp/` 副本完成。

## 2. 库存

| 对象 | 字节 | 说明 |
|---|---:|---|
| `ai_session_messages` | 2,532,200,448 | 1,175,749 行；text 1,281,462,229B；thinking 653,241,877B |
| PK 自动索引 | 295,862,272 | `(session_key,seq)` |
| 显式 session 索引 | 295,862,272 | 与 PK 完全重复 |
| user 全角色索引 | 278,548,480 | 实际索引全部 1,175,749 行 |
| `ai_sessions` | 6,266,880 | 6,203 行，5,225 visible |
| 整个快照 | 3,420,934,144 | 约 3.42GB |

- `session_key` 平均 205.12B，最长 336B。
- 角色：assistant 655,313；tool 451,929；user 64,517；developer 3,990。
- 来源：pi 996,804；codex 175,980；claude 2,183；opencode 782。
- 最大 text 25,578,148B（codex 工具目录树）；最大 thinking 436,198B。
- 最大消息数会话 5,944 条 / 10,007,419B；最大正文会话 154 条 / 25,934,898B。

## 3. 当前基线（热运行 P50）

| 用例 | P50 ms | P95 ms | cache miss P50 | 返回字节 |
|---|---:|---:|---:|---:|
| 列表摘要 pipeline | 103.438 | 126.469 | 4,038 | 5,405,618 |
| 单会话元数据 | 0.332 | 0.534 | 18 | 997 |
| turn starts（5,944 条会话） | 30.338 | 36.257 | 2,494 | 363 |
| turn starts（P95 会话） | 0.471 | 0.745 | 12 | 1 |
| turn span（最大会话第一轮） | 2.161 | 3.138 | 144 | 38 |
| 最大正文详情（25.93MB） | 39.072 | 47.904 | 6,371 | 25,939,468 |
| 当前搜索（无命中词） | **4,318.829** | 4,363.930 | 347,096 | **866,101,849** |
| 朴素 SQL `instr(lower(text))` | 8,859.034 | 10,541.725 | 621,433 | 0 |
| user count | 3.387 | 5.045 | 380 | 3 |
| user page | 1.207 | 1.748 | 105 | 11,207 |
| SaveMessages 最大正文 | 424.604 | 508.951 | — | 25,934,898 |
| SaveMessages 最大消息数 | 503.939 | 960.089 | — | 10,007,419 |

结论：

- 缓存命中的列表/摘要 SQL 不是 43s 级瓶颈。
- 当前搜索拉 866MB 文本到 Go，P50 4.32s，是明确的主要性能缺陷。
- 简单把 substring 推入 SQL 更慢，且 SQLite `lower()` 不等于 Go Unicode lowercase。
- 最大会话 turn 扫描 30ms，可优化但不足以解释 503。
- 整会话重写最大正文 0.42s、最大消息数 0.50s。

## 4. 候选存储与查询

### 删重复索引

- 逻辑空间减少 **295,862,272B**。
- 查询计划从显式索引切到 PK 自动索引；VM_STEP/cache miss 不变。
- DROP 后文件不缩小，VACUUM 后从 3,420,934,144B 降到 3,087,577,088B。
- 读耗时的顺序 A/B 差异含缓存噪声，不作为因果结论。

### user 部分索引

- 278,548,480B → **14,364,672B**（-94.84%）。
- user count/page 计划不变。
- 删重复索引 + user 部分索引 + VACUUM：**2,826,240,000B**（-17.38%）。

### 窄元数据

- 长键窄表：315,203,584B；最大会话 turn 30.338→10.185ms，cache miss 2,494→322。
- 整数 fk 窄表：**44,875,768B**；turn 30.338→**9.195ms**，turn span 2.161→0.252ms。

### 独立正文表（初版候选）

- 整数 map + 窄元数据 + `WITHOUT ROWID` 正文表合计 2,877,489,152B。
- 三表 equijoin 详情：39.072→**2,761.496ms**（70.7× 回退），不可接受。
- 两条范围查询：39.072→93.791ms（2.4× 回退）。
- 后续需评估 rowid 正文表 + map 查询后直接按 fk 范围读，避免三表 join；未完成前不宣称拆表可行。

## 5. 补充实测：Go 搜索三候选、Unicode 语义对拍与 loadAll 运行时复现

> 工具：`tmp/aisessions-index-perf-bench/followup/`（Go `go1.25.6` + `go-sqlite3` / SQLite `3.51.3`，复用同一只读不可变快照 `baseline.sqlite`，`database_state_before == database_state_after`）。
> 内存采样：每次迭代前 `runtime.GC()`，每 10ms 采样 `HeapAlloc`/`HeapInuse`，并记录精确 `TotalAlloc` 增量。

### 5.1 Unicode 语义对拍（10 例）

`semantic-followup-results.json`（耗时 75ms）：

- `go_bulk`、`go_streaming`、`go_udf` 三种策略在 **10/10** 用例上与 Go `strings.ToLower + strings.Contains` 逐条一致（`all_go_strategies_match_expected = true`）。
- SQLite ASCII `instr(lower(text), ?)` 有 **3 例漏检**：
  - `NAÏVE` 匹配 `naïve`（Go=true，SQLite=false）
  - `İSTANBUL` 匹配 `istanbul`（Go=true，SQLite=false）
  - `ΚαΛΗΜΈΡΑ` 匹配 `καλημέρα`（Go=true，SQLite=false）
- 同时锁住非等价边界：`ß` vs `ss` / `SS` vs `ß`（均为 false，非 Unicode casefold）、`ΟΣ` vs `ος`（false，无词尾 sigma 映射）、`é` vs `é`（false，不做组合字符规范化）、CJK 子串（`你好`）与 emoji 子串（`😀`）。

### 5.2 Go 端搜索三候选对比（1 cold + 3 hot，5,225 可见会话）

| 候选策略 | 查询 | 命中会话 | cold ms | 热 P50 ms | 热 P95 ms | 扫描行 | 扫描正文 MB | 峰值堆 MB | 总分配 MB |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `go_bulk`（现状） | `absent_ascii` | 0 | 39,556.1 | **8,539.4** | 10,310.0 | 587,441 | 866.10 | 62.39 | 1,895.9 |
| `go_udf`（`contains_lower`+LIMIT 1） | `absent_ascii` | 0 | 9,356.8 | **9,211.2** | 9,790.0 | 587,441 | 865.41 | 63.18 | 1,937.9 |
| `go_streaming`（`rows.Next`） | `absent_ascii` | 0 | 9,194.6 | **9,101.9** | 11,455.7 | 587,441 | 866.10 | 63.68 | 1,844.9 |
| `go_bulk`（现状） | `absent_unicode` | 0 | 9,459.0 | 8,880.2 | 8,935.6 | 587,441 | 866.10 | 62.62 | 1,895.9 |
| `go_udf` | `absent_unicode` | 0 | 11,099.6 | 9,548.7 | 10,425.6 | 587,441 | 865.41 | 63.42 | 1,918.9 |
| `go_streaming` | `absent_unicode` | 0 | 8,719.5 | 9,363.3 | 11,188.0 | 587,441 | 866.10 | 63.63 | 1,844.9 |
| `go_bulk`（现状） | `unicode_case_hit` (`NAÏVE`) | 1 | 9,583.3 | 10,226.2 | 12,301.4 | 587,441 | 865.59 | 62.85 | 1,895.3 |
| `go_udf` | `unicode_case_hit` (`NAÏVE`) | 1 | 9,754.5 | 9,662.5 | 9,717.6 | 587,156 | 864.90 | 63.49 | 1,913.0 |
| `go_streaming` | `unicode_case_hit` (`NAÏVE`) | 1 | 8,652.3 | 8,788.1 | 8,816.8 | 587,156 | 865.59 | 63.64 | 1,843.8 |
| `go_bulk`（现状） | `cjk_hit` (`错误`) | 4,454 | 6,970.3 | **4,789.5** | 5,125.9 | 576,630 | 253.96 | **104.97** | **1,230.4** |
| `go_udf` | `cjk_hit` (`错误`) | 4,454 | 3,180.7 | **3,197.1** | 3,633.7 | 211,192 | 253.90 | 63.88 | 573.2 |
| `go_streaming` | `cjk_hit` (`错误`) | 4,454 | 2,733.5 | **3,062.5** | 3,453.8 | **211,192** | 253.96 | **64.03** | **547.6** |

结论：

- **结果逐条一致**：4 类查询在三种策略下的 `matched_digest` 完全一致（`absent_*` 0 命中、`NAÏVE` 1 命中、`错误` 4,454 命中）。
- **真实 Go 链路比 C 基准更慢**：C `scanbench.exe` 无命中 P50 为 4.32s，真实 Go 链路因 CGO 拷贝 + `strings.ToLower` 分配（单次 1.84–1.94GB 总分配），无命中 P50 达 **8.54–9.21s**。
- **`go_udf` 淘汰**：虽然 `body_bytes_returned_to_go = 0`，但 SQLite 每行仍通过 CGO 回调传入 Go 字符串，无命中反而更慢（9.21s vs 9.10s），高命中也慢于流式（3.20s vs 3.06s），且引入自定义驱动复杂度。
- **`go_streaming` 有确定收益但不达 1.5s 门**：高命中查询（`错误`）靠每会话早退使扫描行降 **63.4%**（576,630→211,192）、P50 降 **36.1%**（4.79s→3.06s）、峰值堆降 **39.0%**（104.97→64.03MB）、总分配降 **55.5%**（1,230.4→547.6MB）。
- **1,500ms 验收门裁决**：**所有非索引扫描方案均未达标**（无命中 P50 8.5–9.2s，高命中 P50 3.06s）。阶段 C 先上 `go_streaming` 收敛内存与高命中耗时，**1.5s 目标保持现状、另开迭代评估 FTS5 trigram 加速器与完整语义对拍**。

### 5.3 `loadAll` 写放大运行时复现（fake-provider，24 消息 / 3.96MB / 8 帧）

`loadall-followup-results.json`（耗时 558ms，独立临时库，零生产代码修改）：

| 场景 | 总帧数 | `Provider.LoadMessages` 次数 | `SaveMessages` 等价写次数 | Frame 1 耗时 | 最终 `session/file mtime,size` | 拼接字节一致 |
|---|---:|---:|---:|---:|---|---|
| `missing-mtime-size`（现状续帧缺 freshness） | 8 | **2**（首帧 1 + Frame 1 冗余 1） | **2**（首帧 1 + Frame 1 冗余 1） | **90.455ms** | **`0, 0`（被污染清零）** | 是 |
| `real-mtime-size`（携带真实 freshness） | 8 | **1**（续帧全为 0） | **1**（续帧全为 0） | **16.454ms** | **真实值（保留）** | 是 |

关键修正（实测比纯静态分析更精确）：

- 静态分析原推测“每个续帧都会 miss 并重写”；**实测证实更隐蔽的双重缺陷**：
  1. **Frame 1 触发冗余全量重写 + 清零污染**：Frame 0 写入真实 `mtime/size`，Frame 1 携带 `0, 0` 触发 cache miss → 整会话重解析 + `SaveMessages` 重写（90.46ms vs 16.45ms），并把 `ai_sessions` / `ai_files` 的 `mtime/size` 覆写为 `0, 0`。
  2. **Frame 2–7 触发 `0 == 0` 假命中 + 跨请求乒乓重写**：后续帧因 DB 已被清零反而走 `0 == 0` 假命中（若期间文件变更会静默漏更新）；而 DB 遗留的 `0, 0` 保证下一次任何携带真实 `mtime/size` 的正常打开/扫描必 miss 并再次全量重写，形成 **`real ↔ 0` 乒乓写放大**。

## 6. 对修复计划的约束

1. 先修 RPC 等待预算与 loadAll freshness，再动 schema。
2. 低风险索引优化可独立上线。
3. 窄元数据 sidecar 保留宽表 authoritative，避免详情回退。
4. 搜索不得用 SQLite ASCII lower 直接替代 Go Unicode 语义。
5. SaveMessages 优先增量/diff，但必须保留 canonical parity 与事务原子性。
6. 任何候选都要通过完整 text/thinking 字节一致、搜索/批注/轮次 parity。
