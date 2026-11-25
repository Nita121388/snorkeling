# AI Sessions 消息消费者与 Schema 演进约束

> 只读调查报告。当前代码基线：`854310f350adff0eef3eb59c683fdde5c33eb213`。
> 本报告没有改生产代码、没有打开或修改当前 SQLite/JSONL、没有创建数据库副本。
> 文中「代码证实」表示可由当前源码直接推出；「需实测」表示发生率/耗时必须再由主任务在 `tmp/` 副本上测量。
> PRD 给出的 3.42GB、1,174,138 行等数字在本报告中仅作为任务给定背景，未由本子任务复测。

## 1. 给主任务的结论摘要

1. **P0 代码级放大链路：`DetailDelta(loadAll)` 的每一帧都会整会话重解析并全量重写消息缓存，而且会把缓存新鲜度写成 0。**
   - service 构造 continuation summary 时只填 `Key/ID/Source/FilePath/MessageCount`，没有 `MTime/Size`：`pkg/service/aisessionsservice/aisessionsservice.go:1268-1283`。
   - `LoadDelta` 看到 `FilePath` 和 `Source` 非空便跳过 `resolveSession`，随后进入 `loadAllDelta`：`pkg/aisessions/manager.go:752-766`。
   - `loadAllDelta` 调用 `loadMessages(summary, false)`：`pkg/aisessions/manager.go:805-830`。
   - `GetMessages` 要求 `ai_files.mtime/size` 与 summary 完全相等；上述 summary 两项均为 0，因此必然 miss：`pkg/aisessions/sqlite_index.go:1496-1527`、`pkg/aisessions/sqlite_read.go:31-55`。
   - miss 后 provider 整文件解析，并调用 `SaveMessages`：`pkg/aisessions/manager.go:1476-1493`。
   - `SaveMessages`  delete+insert 全会话，再用同一个 summary 写 `ai_sessions/ai_files`，把 `mtime/size` 写成 0、`message_indexed` 写成 1：`pkg/aisessions/sqlite_index.go:1547-1582`、`pkg/aisessions/sqlite_index.go:2090-2140`。
   - Agent 详情和子代理卡片确实使用这条 continuation 路径：`frontend/app/view/aisessions/agent.tsx:210-307`、`frontend/app/view/aisessions/subagent-card.tsx:94-139`。
   - **影响推断（需实测）**：若一个会话按 512KiB 帧预算分成 F 帧，continuation 会执行 F−1 次整文件解析、F−1 次工具文件全扫、F−1 次整会话 delete+insert；初次 Detail 若缓存未命中还会再加一次。帧大小计算见 `pkg/aisessions/util.go:27-34`、`pkg/aisessions/util.go:213-232`。

2. **`SaveMessages` 的生产调用点只有 3 个，不是每次 Summary/轮询都会写。** 但上述 loadAll 路径把「分帧读取」变成了「每帧全量重写」，另两条入口是列表补计数和显式全量建索引：`pkg/aisessions/manager.go:575-650`、`pkg/aisessions/manager.go:1424-1493`、`pkg/aisessions/sqlite_index.go:1753-1790`。

3. **当前消息缓存不是完整 Message 投影。** 表里没有 `entry_id/item_key/model`，但 `Message` 类型有这三个字段：`pkg/aisessions/sqlite_index.go:157-167`、`pkg/aisessions/types.go:110-127`。因此：
   - 批注锚点在缓存命中时退化为 `seq:<n>`，服务端写批注/生成批注锚点时会再次读原文件：`frontend/app/view/aisessions/annotation-model.ts:35-44`、`pkg/aisessions/annotation_anchor_build.go:124-142`。
   - `LiveSessionState` 的「最后一个带 Model 的 assistant」磁盘兜底在缓存命中时拿不到 Model：`pkg/service/aisessionsservice/chatcontrol.go:93-145`。

4. **窄元数据表 + 独立正文表在功能上可做，但不能直接替换旧表。** 列表计数、用户分页、轮次扫描只需要 `session_key/seq/role/timestamp/tool_name/char_count` 及正文的非空/预览信息；详情、ReadTurn、搜索、AI 生成才需要完整正文。依赖证据见 `pkg/aisessions/sqlite_read.go:59-270`、`pkg/aisessions/sqlite_index.go:1496-1582`、`pkg/aisessions/sqlite_index.go:1951-1992`。

5. **整数 `session_fk` 只适合做新消息表内部键，不能替换外部 `SessionSummary.Key` 或低容量元数据表的 `session_key`。** 外部 key 由 `source:id:filePath` 组成并参与 origin 合并去重、remote 路由、批注/标签/属性关联：`pkg/aisessions/types.go:447-450`、`pkg/service/aisessionsservice/origins_all.go:19-22`、`pkg/service/aisessionsservice/origins_all.go:68-76`、`pkg/aisessions/sqlite_index.go:180-206`。

6. **重复索引 `idx_ai_session_messages_session(session_key, seq)` 与复合主键自动索引重复，当前查询可透明删除；旧二进制会在下次打开时重建。** 建表处同时创建两者：`pkg/aisessions/sqlite_index.go:157-167`、`pkg/aisessions/sqlite_index.go:240-246`。当前还有一个测试明确要求该索引存在：`pkg/aisessions/sessionread_test.go:615-641`。

7. **FTS5 不是当前搜索语义的 drop-in replacement。** 当前 SQLite 搜索是「metadata 子串匹配 + 每个未命中会话拉取全部 text + Go `strings.ToLower`/`strings.Contains`」，不搜索 thinking：`pkg/aisessions/sqlite_index.go:1951-1992`、`pkg/aisessions/index.go:534-560`。分词型 FTS 会改变子串、标点、CJK、大小写语义。

8. **Schema 兼容不能只看 `schema_version`。** 当前常量仍是 4，但 user 角色索引、content_hash、props 列等明显是后续增量能力；打开库时也总会把版本写回 4：`pkg/aisessions/sqlite_index.go:24-26`、`pkg/aisessions/sqlite_index.go:246`、`pkg/aisessions/sqlite_index.go:316-320`、`pkg/aisessions/sqlite_index.go:523-540`。新方案应使用独立 feature sentinel/新表，不能假设旧版本会保留更高版本号。

---

## 2. 消息表消费者全景

### 2.1 后端路径矩阵

| 路径 | 实际读取/写入 | 字段依赖 | 语义与风险 | 证据 |
|---|---|---|---|---|
| 缓存新鲜度 | `ai_files(file_path,mtime,size,message_indexed)` 三重检查 | `session_key` 用于消息查询；`file_path/mtime/size/message_indexed` 决定是否可用 | Summary 可旧，Detail/渐进读取必须新；不能把 0 当真实新鲜度 | `pkg/aisessions/sqlite_read.go:31-55`；`pkg/aisessions/manager.go:1557-1581`；`pkg/aisessions/manager.go:1786-1811` |
| `GetMessages` |  freshness 后 `SELECT seq,role,text,timestamp,tool_name,thinking,char_count WHERE session_key=? ORDER BY seq` | 全部七列 + `session_key` | 整会话正文物化；空 rows 视为 miss；缓存不返回 `EntryID/ItemKey/Model` | `pkg/aisessions/sqlite_index.go:1496-1544` |
| 列表 `populateMessageCounts` | 先读已存 `MessageCount`；为 0 时 `GetMessages`，miss 则 provider 解析并 `SaveMessages` | 内部只需 role/text 计算 readable count，但当前 `GetMessages` 连 thinking 和全文一起拉 | 存储计数 >0 后不再解析；128MiB/5s 预算，但预算在单会话前检查，可能被一个大会话突破 | `pkg/aisessions/manager.go:575-650`；`pkg/aisessions/scancoordinator.go:126-148`；`pkg/aisessions/util.go:776-812` |
| `Detail` / `Manager.Load` | resolve summary → `loadMessages` → 可选 `LoadToolCalls` | 全部消息字段；ToolCall 另走 provider | 默认返回全会话；`Tail` 在 service 层裁剪；`LoadAll` 在 Manager 内按帧切 | `pkg/aisessions/manager.go:687-750`；`pkg/service/aisessionsservice/aisessionsservice.go:1209-1249` |
| `DetailDelta` 字节模式 | provider `LoadMessageDelta`，不查消息表、不 `SaveMessages` | cursor `byteOffset/fileSize/mtime/lastSeq` + 新消息字段 | 增量语义独立于 SQLite 消息缓存；resetRequired 触发前端全量刷新 | `pkg/aisessions/manager.go:768-803`；`frontend/app/view/aisessions/session-timeline-sync.ts:20-36` |
| `DetailDelta(loadAll)` | `loadAllDelta` → `loadMessages` + 可选工具全扫 → 按 `MessageOffset` 切帧 | 全部消息字段 + offset | **当前 continuation summary 缺 mtime/size，导致每帧缓存必 miss 并全量重写，见 §1** | `pkg/aisessions/manager.go:752-766`；`pkg/aisessions/manager.go:805-844`；`pkg/service/aisessionsservice/aisessionsservice.go:1268-1283` |
| `Summary` | `resolveSession(...allowStale=true)`，本身不读消息正文 | `ai_sessions` key/id/source/file/mtime/size + meta | 缓存行存在即允许旧；refresh=true 时后台刷新 summary，不直接 `SaveMessages` | `pkg/aisessions/manager.go:860-878`；`pkg/aisessions/manager.go:1557-1581` |
| `Search`（Agent Control `SessionList`） | `Manager.Search` → `SQLiteIndex.Search` | metadata 字段 + 每个候选会话的 `text` | metadata 未命中才拉该会话全部 text；Go lowercase substring；不查 thinking | `pkg/agentcontrol/session.go:99-121`；`pkg/aisessions/manager.go:144-178`；`pkg/aisessions/sqlite_index.go:1951-1992` |
| GUI `List(query)` | `ScanListResult` → `ListWithDistributionAndQuery` | 只查 summary/meta/tags，不查消息正文 | GUI 列表查询不是全文搜索；不要误把 List 的 query 当消息搜索 | `pkg/service/aisessionsservice/aisessionsservice.go:884-935`；`pkg/aisessions/sqlite_index.go:1863-1949` |
| `SessionInfo` | `CountUserMessages`、`LastMessageAt`、`CountMessages` | role/text/timestamp/session_key | 无正文返回；stale 仍返回 counts，但明确 `Stale=true` | `pkg/aisessions/sessionread.go:234-279`；`pkg/aisessions/sqlite_read.go:59-79` |
| `SessionUsers` | `UserRowsPage` | session_key/role/seq/text/timestamp/tool_name/char_count | 非空 user、倒序 LIMIT+1、返回时升序；SQL 取 121 rune 预览 | `pkg/aisessions/sessionread.go:282-323`；`pkg/aisessions/sqlite_read.go:18-27`、`pkg/aisessions/sqlite_read.go:82-109` |
| `UserOutline` | 新鲜时 `UserOutlineRows` + `CountUserMessages`； stale/refresh 回退 full Load | role/text/seq/timestamp/tool_name/thinking/char_count | 输出必须与旧 `LatestUserOutlineMessages` 一致；stale 不静默返回旧行 | `pkg/aisessions/sessionread.go:169-188`、`pkg/aisessions/sessionread.go:496-539`；`pkg/aisessions/sqlite_read.go:111-130` |
| `ReadTurns` | `TurnStartCount` + `TurnStartsRange` + 每轮 `TurnHead`/`TurnSpanOf` | session_key/seq/role/text/timestamp/tool_name/char_count | 轮定义依赖完整 role 序列；每页 1–10 轮；正文只取 121 rune | `pkg/aisessions/sessionread.go:333-411`；`pkg/aisessions/sqlite_read.go:132-230` |
| `ReadTurn` | 轮定位 + `TurnSpanOf` + `IterateTurnMessages` | seq/role/text/timestamp/char_count | 单轮 chars 必填 ≤8000；按 char_count 预算，0 时回退 runeCount(text)；不返回 thinking/tool_name | `pkg/aisessions/sessionread.go:416-495`；`pkg/aisessions/sqlite_read.go:187-269` |
| 批注列表 | `Annotations` 使用前端传入 anchors 做重锚定；服务端不为此查消息表 | annotation.session_key/anchor_key/seq/role/hash | anchor_key 主匹配；seq 只是漂移兜底；未传 anchors 不把全部标 orphan | `pkg/service/aisessionsservice/aisessionsservice.go:1834-1855`；`pkg/aisessions/annotation_store.go:750-802` |
| 批注保存/机器批注 | seq≤0 时 `LoadAnnotationDetail`；机器入口总是先 Load detail | session_key + Message.ItemKey/Seq/Role/Text/Thinking + ToolCall.ItemKey/Name/Summary | 缓存无 ItemKey 时强制重读原文件；工具 seq 必须取镜像消息 seq | `pkg/service/aisessionsservice/aisessionsservice.go:1866-1926`；`pkg/aisessions/annotation_machine.go:111-145`；`pkg/aisessions/annotation_anchor_build.go:23-67`、`pkg/aisessions/annotation_anchor_build.go:124-182` |
| 批注 AI/Replace | `LoadAnnotationDetail` 构建 digest/anchors | ItemKey/Seq/Role/Text/Thinking + ToolCall | text 空白时 thinking 作为 hash/digest 文本；不得丢 thinking | `pkg/service/aisessionsservice/aisessionsservice.go:1991-2075`；`pkg/aisessions/annotation_assist.go:82-110` |
| Note/Tags/Mark | `resolveSessionForMetaWrite` → key 精确查 `ai_sessions` → meta/tags 表 | 只依赖 session_key（以及 key/id 解析） | 不依赖消息正文；写路径刻意跳过 mtime/size 强校验以避免活跃会话写超时 | `pkg/aisessions/manager.go:914-980`；`pkg/aisessions/manager.go:1734-1748`；`pkg/aisessions/sqlite_index.go:1147-1178` |
| Props 写入/应用 | key 精确解析 → `ai_session_props` merge | 只依赖 session_key | source=user 保护、built-in key 拒绝；不需消息表 | `pkg/aisessions/manager.go:986-1086`；`pkg/aisessions/sqlite_index.go:1209-1267` |
| Props/Title/Metadata AI 生成 | `Manager.Load` 后把 Messages 传给 prompt | role/text/tool_name；thinking 是否进入取决于生成器 | 当前共享 transcript 只用 text，tool 用 tool_name 作标签；不是存储依赖 | `pkg/service/aisessionsservice/aisessionsservice.go:1611-1639`、`pkg/service/aisessionsservice/aisessionsservice.go:1668-1755`；`pkg/aisessions/metagenerate.go:125-152` |
| `LiveSessionState` / `CurrentModelState` | 先 live registry；再 bounded tail；miss 后 full Load 倒序找 `Message.Model` | session key/file + Message.Model/role | SQLite 缓存不存 Model，所以 full Load 的缓存兜底拿不到模型；pi/codex 有 bounded tail，claude/opencode 无该接口实现 | `pkg/service/aisessionsservice/chatcontrol.go:93-145`；`pkg/aisessions/types.go:241-276`；`pkg/aisessions/provider_codex.go:462-464`；`pkg/aisessions/provider_pi.go:709-711` |
| 彻底删除会话 | 一个事务删除 messages/tags/props/annotations/meta/session/file/audit | session_key/file_path | 新正文表/映射表必须加入同一删除事务，否则留下孤儿 | `pkg/aisessions/sqlite_index.go:1331-1380` |
| 全量建索引 `IndexAll` | summary 扫描后逐会话 `GetMessages`，miss 则 provider + `SaveMessages` | 全部消息字段 | 显式全量入口；正常 Refresh 只扫 summary，不等于重建正文 | `pkg/aisessions/sqlite_index.go:1753-1790`；`pkg/aisessions/manager.go:672-685` |

### 2.2 字段级依赖

| 字段 | 必需保持的含义 | 主要消费者 | 迁移红线 |
|---|---|---|---|
| `session_key` | `StableKey(source,id,filePath)`，外部稳定身份；不是可随意替换的显示字段 | 所有消息查询、meta/tags/props/annotations、origin 合并、remote 路由 | 可新增整数内部键，但必须保留 key→fk 映射和外部 key；fk 只能在单个 origin/connection DB 内有意义。证据：`pkg/aisessions/types.go:447-450`、`pkg/service/aisessionsservice/origins_all.go:68-76`、`pkg/service/aisessionsservice/aisessionsservice.go:596-639` |
| `seq` | provider 规范化后的消息顺序；同一文件内稳定，但文件重写/分支展开可能整体重排 | PK、排序、游标、轮边界、批注漂移、前端 delta 去重 | 必须保持 `(session,seq)` 唯一且升序语义；不能改成全局 seq；不能拿 ToolCall.seq 代替消息 seq。证据：`pkg/aisessions/sqlite_index.go:157-167`、`pkg/aisessions/provider_pi.go:392-396`、`frontend/app/view/aisessions/session-timeline-sync.ts:28-35`、`pkg/aisessions/annotation_anchor_build.go:25-32` |
| `role` | user/assistant/tool/system/未知原值；决定轮边界、可读计数、user 过滤、批注 role | `ComputeTurns`、`turnStartsSQL`、UserRows、Outline、metadata transcript | 不能只保留 user/assistant；任何非 user 都是 reply 侧。证据：`pkg/aisessions/turns.go:7-62`、`pkg/aisessions/sqlite_read.go:132-137`、`pkg/aisessions/util.go:744-775` |
| `text` | 完整正文，也是工具结果正文、搜索对象、批注 hash 首选文本 | Detail、Search、ReadTurn、UserRows、TurnSpan fallback、AI prompt | 禁止截断/压缩后不可逆丢失；预览列只能作为附加投影。证据：`pkg/aisessions/sqlite_index.go:1524-1525`、`pkg/aisessions/sqlite_index.go:1983-1988`、`pkg/aisessions/annotation_anchor_build.go:178-182` |
| `thinking` | 完整思考正文；text 为空时可成为批注节点文本 | Detail、ThinkingDisclosure、批注 hash/digest、LoadAll 帧预算 | 禁止截断；当前全文搜索不包含它，不能借优化顺带改变搜索范围。证据：`pkg/aisessions/sqlite_index.go:1524-1541`、`frontend/app/view/aisessions/session-message.tsx:414-418`、`pkg/aisessions/annotation_anchor_build.go:178-182` |
| `timestamp` | 毫秒时间戳；同一 pi entry 拆出的多个消息共享时间 | ReadInfo LastMessageAt、TurnSpan、日期分页/批注时间桶、详情展示 | 保留 NULL/0 的现有扫描语义；不能改用 updated_at 代替。证据：`pkg/aisessions/sqlite_read.go:73-79`、`pkg/aisessions/sqlite_read.go:187-214`、`.trellis/spec/snorkeling-docs/backend/aisessions-message-timestamps-contract.md:18-42` |
| `tool_name` | 工具结果/工具锚点的工具名；与 ToolCall.Name 是不同数据面 | Detail 工具标签、metadata transcript、ReadUsers/TurnHead 的 Message 投影 | 不能因正文拆表而丢；不能据此重建完整 ToolCall。证据：`pkg/aisessions/provider_codex.go:144-175`、`pkg/aisessions/provider_pi.go:516-550`、`pkg/aisessions/metagenerate.go:137-146` |
| `char_count` | 当前 provider 对 text 的 rune 计数（工具锚点 ASCII 用 len） | ReadTurn 预算、TurnSpan chars、部分 delta 预算 | 必须保持 rune 语义；旧行 0 时现有逻辑回退 `length(text)`，迁移时要保留该回退。证据：`pkg/aisessions/provider_pi.go:539-550`、`pkg/aisessions/sqlite_read.go:185-199`、`pkg/aisessions/sessionread.go:469-480` |
| `entry_id/item_key/model`（当前表缺失） | provider 稳定锚点/模型信息 | 批注、子代理配对、复制上下文、LiveSessionState 模型兜底 | 若新增，必须整会话 backfill 后再切换锚点，或为旧 `seq:n` 建 alias；逐行混用会产生同节点双锚点。证据：`pkg/aisessions/types.go:110-127`、`pkg/aisessions/annotation_anchor_build.go:124-142`、`frontend/app/view/aisessions/annotation-model.ts:35-44` |

---

## 3. `SaveMessages` 的频率与性能风险

### 3.1 实现成本

`SaveMessages` 在一个事务中先 `DELETE WHERE session_key=?`，再逐行 `INSERT` 所有消息，最后更新 summary 和 file marker：`pkg/aisessions/sqlite_index.go:1547-1582`。

对 N 条消息，当前写入涉及：

- 消息表数据页；
- 复合主键自动索引；
- 显式 `(session_key,seq)` 重复索引；
- `(session_key,role,seq)` 全角色索引。

依据：`pkg/aisessions/sqlite_index.go:157-167`、`pkg/aisessions/sqlite_index.go:240-246`。因此成本是 **O(该会话正文字节 + N×长 session_key×索引份数)**，不是单纯元数据更新。SQLite 可复用 freelist，实际 WAL 增量不能简单按「数据库大小×2」估算，必须在副本上测。

连接层每个 `SQLiteIndex` handle 单连接，busy timeout 5s：`pkg/aisessions/sqlite_index.go:60-68`。不同 RPC 会各开 handle，长写事务仍可能与其他连接争写锁；这是代码层风险，实际排队需实测。

### 3.2 三个生产调用点及触发频率

| 调用点 | 触发条件 | 正常频率 | 风险 |
|---|---|---|---|
| `Manager.populateMessageCounts`：`pkg/aisessions/manager.go:613-646` | 非 refresh；summary.MessageCount≤0；缓存/旧 JSON 索引均未命中；provider 解析成功 | 列表发现文件变化后，summary 会把 count 重置为 0；随后在 128MiB/5s 预算内补多少就写多少 | 预算检查在会话开始前，单个大会话可让一次 List 超预算；`usedBytes` 在 Save 之后累加，无法限制写放大。证据：`pkg/aisessions/manager.go:596-650`、`pkg/aisessions/sqlite_index.go:2102-2105`、`pkg/aisessions/scancoordinator.go:126-148` |
| `Manager.loadMessages`：`pkg/aisessions/manager.go:1424-1493` | 非 refresh 且缓存 stale/miss，或显式 refresh；provider 解析成功 | Detail 首次打开、手动刷新、resetRequired、批注重解析，以及 **每个 loadAll continuation 帧** | 显式 refresh 即使内容不变也全量重写；loadAll continuation 因缺 mtime/size 变成每帧必写。证据：`pkg/aisessions/manager.go:1449-1493`、`pkg/service/aisessionsservice/aisessionsservice.go:1268-1283` |
| `SQLiteIndex.IndexAll`：`pkg/aisessions/sqlite_index.go:1753-1790` | 显式全量建索引；某会话 `GetMessages` miss | 批量重建时每会话一次 | 若大量会话 miss，会连续长时间持有写事务并生成大量 WAL。正常 `Refresh` 只扫 summary，不走这里。证据：`pkg/aisessions/manager.go:672-685` |

**明确不触发 `SaveMessages` 的路径：**

- `Summary` 本身：`pkg/aisessions/manager.go:860-878`；
- 字节模式 `DetailDelta`：`pkg/aisessions/manager.go:768-803`；
- Note/Tags/Mark/Props 写入：`pkg/aisessions/manager.go:914-1086`；
- 批注列表本身：`pkg/service/aisessionsservice/aisessionsservice.go:1834-1855`。

### 3.3 loadAll 的放大公式与新鲜度破坏

设会话有 N 条消息，正文/thinking 字节和为 B，帧预算默认 512KiB，每消息 envelope 96B：`pkg/aisessions/util.go:27-34`。帧数 F 由 `frameLoadAllMessages` 决定，单条超大消息至少占一帧：`pkg/aisessions/util.go:213-232`。

当前 Agent/Subagent continuation 每次：

1. summary 的 `MTime=Size=0`：`pkg/service/aisessionsservice/aisessionsservice.go:1268-1274`；
2. `GetMessages` 必 miss：`pkg/aisessions/sqlite_index.go:1503-1512`；
3. provider 整文件解析：`pkg/aisessions/manager.go:1472-1484`；
4. `SaveMessages` 全会话 delete+insert：`pkg/aisessions/sqlite_index.go:1558-1573`；
5. `saveSummaryTx` 把 0 写回 `ai_sessions/ai_files`：`pkg/aisessions/sqlite_index.go:2090-2140`；
6. 后续 Detail 的 current 校验看到磁盘 mtime/size≠0，再次回退全量 summary 扫描：`pkg/aisessions/manager.go:1786-1811`、`pkg/aisessions/manager.go:1584-1595`；
7. 后续 List 的 `ChangedFiles` 也把该会话视为变化，count 被清零后再次补索引：`pkg/aisessions/sqlite_index.go:1687-1714`、`pkg/aisessions/sqlite_index.go:2102-2105`。

因此最坏不是「F 倍网络流量」，而是 **F 倍 provider 解析 + F 倍工具文件扫描 + F 倍消息表重写 + 新鲜度归零造成的后续重复扫描/重写**。实际 F、发生次数和耗时需实测；当前未发现针对 `DetailDelta(loadAll)` 缓存命中/写入次数的测试。

---

## 4. 候选结构的功能影响评估

| 候选 | 预期收益 | 受影响功能 | 兼容性/迁移约束 | 建议 |
|---|---|---|---|---|
| 删除 `idx_ai_session_messages_session` | 去掉与 PK 自动索引完全重复的长键 B-tree，减少写放大和空间 | 所有按 session_key 的查询仍可由 PK 自动索引承担 | 当前查询不依赖索引名；但旧二进制打开时 `CREATE IF NOT EXISTS` 会重建。当前测试 `TestSessionMessagesUserIndexExists` 还断言它存在 | 低风险第一步，但要在旧版本共存期接受被重建；实现时同步改测试。证据：`pkg/aisessions/sqlite_index.go:157-167`、`pkg/aisessions/sqlite_index.go:240-246`、`pkg/aisessions/sqlite_read.go:65-70`、`pkg/aisessions/sessionread_test.go:615-641` |
| 部分 user 索引 `(session_fk,seq) WHERE role='user'` | 只索引约 6.45 万 user 行，而不是 117 万全角色行 | SessionUsers、UserOutline、CountUserMessages | 不能服务 TurnStarts 的 `LAG(role)`，因为窗口需要所有角色；当前 user 索引名虽叫 user，实际没有 WHERE 条件 | 与窄元数据表一起做；不要用它替代全角色 seq 索引。证据：`pkg/aisessions/sqlite_read.go:59-61`、`pkg/aisessions/sqlite_read.go:82-137`、`pkg/aisessions/sqlite_index.go:243-246` |
| 窄元数据表 | 列表/轮次/计数不再读 2.53GB 宽表正文页；长键只存一次映射 | GetMessages 需 join 正文；Search/ReadTurn/Detail 需 join；UserRows/TurnHead 需预览/非空投影 | 至少保留 fk/seq/role/timestamp/tool_name/char_count；为精确保留 Unicode 空白语义，应存 `text_nonblank`；为 120 rune 预览可存 `text_preview`，但正文仍完整存另一表。旧 char_count=0 的 fallback 不能丢 | **核心方案**。证据：`pkg/aisessions/sqlite_read.go:18-27`、`pkg/aisessions/sqlite_read.go:82-230`、`pkg/aisessions/sessionread.go:169-188` |
| 独立正文表 `(session_fk,seq,text,thinking)` | 元数据扫描与正文 I/O 分离；长 session_key 不再随每条正文重复 | Detail、ReadTurn、Search、AI 生成、批注 hash | 全文不得截断；`GetMessages` join 必须按 seq 升序且行数一致；超大单行仍允许独立 overflow pages；建议 `(session_fk,seq)` 主键，正文行与元数据行同事务提交 | **核心方案**。收益需与「全详情 join 两次 B-tree 查找可能比当前宽表顺序扫更慢」做对比实测。证据：`pkg/aisessions/sqlite_index.go:1524-1544`、`pkg/aisessions/sqlite_read.go:234-269` |
| 整数 `session_fk` | 每条消息/索引不再重复约 170B 的 key；join 比较更便宜 | 所有消息查询；tags/props/annotations 若也改会波及 RPC | 最安全是只用于新消息表，保留 `ai_sessions.key TEXT UNIQUE` 和单独映射；低容量 meta/tags/props/annotations 继续用 string key。fk 必须 per-origin/per-connection，不能跨库；当前未启用 `PRAGMA foreign_keys`，不能假设声明 FK 会自动 enforce | **推荐内部化，不替换外部身份**。证据：`pkg/aisessions/types.go:447-450`、`pkg/aisessions/origin.go:74-84`、`pkg/service/aisessionsservice/aisessionsservice.go:843-850`、`pkg/aisessions/sqlite_index.go:112-128` |
| 覆盖索引 | 让 user/turn 元数据查询只走索引，不碰正文 | SessionUsers、UserOutline、ReadTurns、ReadInfo | SQLite 无 PostgreSQL `INCLUDE`；把 text/thinking 放进索引会复制大正文，违背瘦身目标。只能覆盖窄字段/预览/非空标记 | 仅在 query plan 证明有效时加；优先让窄元数据表自身按 PK 聚簇。证据：`pkg/aisessions/sqlite_read.go:59-230` |
| 部分 `thinking<>''` 索引 | 理论上可服务「有 thinking」过滤 | 当前没有此过滤入口 | 当前详情需要完整 thinking，Search 又不查 thinking；不能为不存在的查询付写入成本 | 不做。证据：`pkg/aisessions/sqlite_index.go:1524-1541`、`pkg/aisessions/sqlite_index.go:1983-1988` |
| 搜索归一化列/函数 | 避免把每个会话全部 text 拉进 Go；可提前 `LIMIT 1` | Agent Control 全文搜索 | 必须保持 `strings.ToLower(strings.TrimSpace(query))` 后对 `strings.ToLower(text)` 的 byte substring；SQLite 内建 `lower/LIKE` 默认只做 ASCII，不能直接替代 Unicode Go 行为。可存 Go 生成的 `search_text`，或注册与 Go 一致的确定性 lower 函数；仍需实测 I/O | 搜索改造应独立灰度，不能直接上分词 FTS。证据：`pkg/aisessions/sqlite_index.go:1951-1992`、`pkg/aisessions/index.go:534-560` |
| 增量 upsert 替代整会话重写 | 避免每帧/每次变化重写全部历史 | SaveMessages、Detail、List、loadAll | provider 当前返回完整规范化列表；pi 分支展开可能重排 seq，codex tool anchor 也可能改变位置。不能简单「按最大 seq append」，必须先 diff/验证 canonical prefix，整会话替换仍需原子事务 | 先修 loadAll 新鲜度，再考虑 generation/diff；不能把增量写入当零风险优化。证据：`pkg/aisessions/manager.go:1472-1493`、`pkg/aisessions/provider_pi.go:392-396`、`pkg/aisessions/sqlite_index.go:1547-1582` |
| 缓存增加 `item_key/entry_id/model` | 消除批注和模型兜底的重复原文件解析 | 批注、子代理、复制上下文、LiveSessionState | 旧行没有 provider key，不能伪造；部分回填会导致 `seq:n` 与 provider key 同时指同节点。必须整会话完成后切换，或保留 alias 解析 | 可作为窄元数据表后续能力，不是首阶段必需。证据：`pkg/aisessions/types.go:110-127`、`pkg/aisessions/annotation_anchor_build.go:124-142`、`frontend/app/view/aisessions/annotation-model.ts:35-44` |

---

## 5. 零功能回退的迁移约束

### 5.1 身份、origin 与 remote

- 外部 `SessionSummary.Key` 继续使用 `StableKey`，RPC/前端不可见地改成整数会造成 origin 合并去重和 remote key 解析失败：`pkg/aisessions/types.go:447-450`、`pkg/service/aisessionsservice/origins_all.go:19-22`、`pkg/service/aisessionsservice/aisessionsservice.go:596-612`。
- 每个 external origin 有独立 SQLite 路径；每个 remote connection 也有独立本地缓存路径。整数 fk 的作用域只能是单个 DB：`pkg/aisessions/origin.go:74-84`、`pkg/service/aisessionsservice/aisessionsservice.go:633-639`、`pkg/service/aisessionsservice/aisessionsservice.go:843-850`。
- `Origin="__all__"` 是内存合并视图，不建共享索引；合并后 `Summary.Origin` 必须继续用于后续读写路由：`pkg/service/aisessionsservice/origins_all.go:14-22`、`pkg/service/aisessionsservice/origins_all.go:68-76`、`pkg/service/aisessionsservice/origins.go:195-207`。
- remote 文件路径使用 `remote:<source>:<base64 connection>:<path>`，不能 normalize 成本地路径：`pkg/aisessions/remote_provider.go:346-356`。
- remote 当前 full read 上限 16MiB，超过会显式错误；这是既有能力边界，迁移不能假装通过缓存绕过而不验证：`pkg/aisessions/remote_provider.go:20`、`pkg/aisessions/remote_provider.go:112-114`、`pkg/aisessions/remote_provider.go:185-199`。

### 5.2 stale 与新鲜度

- `Summary` 允许 stale；`Load/LoadDelta/Path/删除/元数据写入` 需要 current 的既有分工不能一刀切：`pkg/aisessions/manager.go:1557-1581`、`.trellis/spec/snorkeling-docs/backend/aisessions-scan-contract.md:31-45`。
- 消息缓存唯一可信信号仍是 `ai_files` 的 `mtime/size/message_indexed` 三重检查；新表必须沿用同一 generation，或提供等价且可机器验证的标记：`pkg/aisessions/sqlite_read.go:31-55`。
- `message_indexed=1` 只能在元数据行、正文行、summary/file marker 全部提交后出现；不能出现「窄表已新、正文表旧」却标 fresh 的窗口。
- 严禁把缺省 0 的 summary 写入 `ai_sessions/ai_files`。当前 loadAll continuation 已证明会走到该问题：`pkg/service/aisessionsservice/aisessionsservice.go:1268-1274`、`pkg/aisessions/sqlite_index.go:2090-2140`。
- 文件 mtime/size 不变但内容变化的既有盲区不能靠新 schema 假装解决；`content_hash` 已存在，但是否用于消息 freshness 需单独设计：`pkg/aisessions/sqlite_index.go:523-540`、`pkg/aisessions/sqlite_read.go:40-54`。

### 5.3 轮定义与分页

- 一轮 = 连续 user 段 + 其后到下一 user 段前的全部非 user；只有 user 紧跟非 user 才开新轮；preface 不占轮号：`pkg/aisessions/turns.go:7-62`。
- SQL `LAG(role)` 与 Go `ComputeTurns` 必须继续逐条一致；窄表/部分索引不能过滤掉非 user 行后再算轮边界：`pkg/aisessions/sqlite_read.go:132-137`、`pkg/aisessions/turns.go:31-62`。
- `SessionTurns` 的 limit 必填 1–10、`SessionTurn` chars 必填 ≤8000 是硬门禁，不能为性能改成服务端有状态：`pkg/aisessions/sessionread.go:25-45`、`pkg/aisessions/sessionread.go:333-347`、`pkg/aisessions/sessionread.go:416-425`。
- `TurnSpanOf` 的 tool_count/chars/min/max 必须保持；char_count=0 时 `length(text)` fallback 不能丢：`pkg/aisessions/sqlite_read.go:180-214`。

### 5.4 批注锚点

- 主匹配是 `anchor_key=Message.ItemKey`；seq 不是主键/唯一键，只是 drift fallback：`pkg/aisessions/annotation_store.go:149-150`、`pkg/aisessions/annotation_rules.go:78-110`。
- 工具锚点必须使用镜像消息的 seq，不能用 `ToolCall.Seq`：`pkg/aisessions/annotation_anchor_build.go:23-67`。
- hash 是节点文本 `strings.Fields` 归一后的 FNV-1a 64；text 空白时用 thinking：`pkg/aisessions/annotation_rules.go:57-70`、`pkg/aisessions/annotation_anchor_build.go:178-182`。
- drift 只在同 role、seq±3 内重锚，hash 精确匹配优先；失败保留 orphan 数据不删除：`pkg/aisessions/annotation_rules.go:78-126`、`pkg/aisessions/annotation_store.go:776-800`。
- 当前缓存消息没有 ItemKey，前端用 `seq:<n>` 合成键；新增 ItemKey 时必须让旧 `seq:n` 与新 key 指向同一节点，否则历史批注会突然 orphan 或出现重复 rail 项：`frontend/app/view/aisessions/annotation-model.ts:35-54`、`frontend/app/view/aisessions/timeline-virtual.ts:164-186`。
- 批注覆盖保护 `source=user` 或 `user_edited=1` 不可被 AI 覆盖，迁移不能重建/重排 annotation 行而破坏该语义：`pkg/aisessions/annotation_rules.go:43-51`、`pkg/aisessions/annotation_store.go:334-400`。

### 5.5 全文搜索子串语义

必须分别保持三条路径，不能统称为「搜索」：

1. **GUI List query**：只匹配 summary/meta 字段，不碰消息正文：`pkg/aisessions/sqlite_index.go:1908-1932`、`pkg/aisessions/index.go:534-560`。
2. **Agent Control 全文搜索**：metadata 先匹配；未命中则对每个候选会话拉全部 `text`，Go lowercase 后 substring；不包含 thinking：`pkg/aisessions/sqlite_index.go:1951-1992`。
3. **详情内搜索**：前端对已加载 readable messages 的 `message.text` 做 lowercase substring：`frontend/app/view/aisessions/session-detail.tsx:687-695`、`frontend/app/view/aisessions/session-message.tsx:364-370`。

额外兼容坑：旧 JSON 索引搜索会把超过 4000 rune 的 tool text 截到 4000，而当前 SQLite Search 没有截断：`pkg/aisessions/index.go:391-410`、`pkg/aisessions/index.go:562-571`。回滚到旧索引会改变大工具结果的可搜索性，必须在方案中明确「当前 SQLite 语义」为准。

### 5.6 delta、详情与前端身份

- 字节 delta 的 cursor rewind 会 reset；前端按 seq 去重，因此 seq 重排不能静默发生：`frontend/app/view/aisessions/session-timeline-sync.ts:20-36`。
- loadAll 是 canonical message index 分帧，不是 byte cursor；continuation 的 `MessageOffset` 必须继续指同一 canonical 列表：`pkg/aisessions/manager.go:805-844`、`pkg/service/aisessionsservice/aisessionsservice.go:306-320`。
- `frameLoadAllMessages` 按 `len(text)+len(thinking)+96B` 估算 wire 大小，单条超大消息不能被丢；Performance 优化不能改帧边界语义：`pkg/aisessions/util.go:213-232`。
- 前端消息/工具/子代理 key 优先 ItemKey、缺省 seq；迁移要保持身份稳定，不能只按数组下标：`frontend/app/view/aisessions/subagent-card.tsx:375-399`、`frontend/app/view/aisessions/timeline-virtual.ts:164-186`。

### 5.7 Schema 与旧版本共存

- 当前打开 SQLite 不是只读：会执行 WAL/busy_timeout、`CREATE TABLE/INDEX IF NOT EXISTS`、多个 `ALTER TABLE` 守卫和迁移：`pkg/aisessions/sqlite_index.go:36-70`、`pkg/aisessions/sqlite_index.go:112-320`。
- 初始消息表就有 `char_count`；thinking 是后加列，旧 schema<3 会在打开时删除全部消息缓存并重置 marker：`pkg/aisessions/sqlite_index.go:506-521`、`pkg/aisessions/sqlite_index.go:543-559`。
- parent/kind 是后加非空列；加列时会 invalidate summary scan marker，否则旧会话树不会回填：`pkg/aisessions/sqlite_index.go:346-399`。
- annotations/props 都是增量表/增量列，不是建一个完整新库就能自动得到：`pkg/aisessions/sqlite_index.go:194-246`、`pkg/aisessions/sqlite_index.go:323-343`、`pkg/aisessions/annotation_store.go:26-51`。
- `schema_version` 当前恒写 4，即使后续功能没有 bump；旧 v4 二进制也会把更高版本号写回 4。新迁移必须用独立 sentinel（例如 `message_layout_v2`）和显式 capability 检测：`pkg/aisessions/sqlite_index.go:24-26`、`pkg/aisessions/sqlite_index.go:316-320`。
- **混合版本写风险**：旧二进制只写旧宽表，不知道新窄表/正文表；仅靠 mtime/size 无法发现新侧表未同步。零回退期要么禁止混写，要么新侧表带独立 generation/count/hash，并能识别旧 binary 写入后失效。
- 直接 DROP/改名旧 `ai_session_messages`、把 `session_key` 换成 integer、删除 text/thinking，都会让旧二进制 SQL 报错；旧代码大量使用显式列名和原 PK：`pkg/aisessions/sqlite_index.go:1524-1525`、`pkg/aisessions/sqlite_index.go:1561-1572`、`pkg/aisessions/sqlite_read.go:59-270`。
- 最安全的兼容形态是 **additive sidecar + dual-read/dual-write + 独立开关 + 可丢弃重建**；旧表在回滚窗口内保留，切段成功后由后台重建/回收，而不是在线 DROP。
- 现有迁移备份使用 `VACUUM INTO`，但备份命名/清理只覆盖 tags/meta 等特定模式，不能直接当新方案完整回滚机制：`pkg/aisessions/sqlite_index.go:638-647`、`pkg/aisessions/backups.go:144-153`。

---

## 6. 实施前必须补的机器判据

本报告没有执行测试或基准；以下是从现有契约推出的最小验收集。

1. **loadAll 写放大回归**：构造 >2 帧的会话，第一次 Detail 后记录 `SaveMessages` 次数、provider `LoadMessages/LoadToolCalls` 次数；每个 continuation 期望新增写次数为 0，`ai_sessions/ai_files.mtime/size` 保持真实值。当前缺口对应 `pkg/aisessions/manager.go:805-844`、`pkg/service/aisessionsservice/aisessionsservice.go:1268-1283`。
2. **轮次 parity**：继续运行 `TestSQLTurnStartsMatchComputeTurns`，并覆盖 preface、连续 user、tool/thinking、developer/未知 role；依据 `pkg/aisessions/turns.go:31-62`、`pkg/aisessions/sqlite_read.go:132-137`。
3. **stale parity**：继续运行 `TestReadLayersReportStale`，新表 fresh marker 在 mtime 或 size 变化后必须为 false，且 users/turns 返回空 + stale：`pkg/aisessions/sessionread_test.go:455-498`。
4. **消息逐字段 parity**：对 pi/codex/claude/opencode/remote 各取 fixture，对 `seq/role/text/thinking/timestamp/tool_name/char_count` 做 byte/rune 级对比；完整正文哈希一致。provider 差异见 `pkg/aisessions/provider_pi.go:499-550`、`pkg/aisessions/provider_codex.go:132-175`、`pkg/aisessions/provider_claude.go:95-122`、`pkg/aisessions/provider_opencode.go:486-500`。
5. **搜索 parity**：ASCII 大小写、Unicode 大小写、CJK、标点、跨 token、超 4000 rune tool text、text 为空 thinking 非空；期望与当前 SQLite Search 完全一致。依据 `pkg/aisessions/sqlite_index.go:1951-1992`。
6. **批注 parity**：旧 `seq:n` 锚点、provider ItemKey、工具镜像 seq、seq±3/hash 重锚、orphan 保留、AI/user 覆盖保护。依据 `pkg/aisessions/annotation_rules.go:43-126`、`pkg/aisessions/annotation_store.go:750-802`。
7. **origin/remote parity**：local + 两个 dump 的 `__all__` 去重与 Origin 路由；两个 connection 的同名 session 不串fk；remote 16MiB 上下的既有成功/失败边界。依据 `pkg/service/aisessionsservice/origins_all.go:46-80`、`pkg/service/aisessionsservice/aisessionsservice.go:843-850`、`pkg/aisessions/remote_provider.go:112-114`。
8. **旧版本兼容/回滚**：新库由旧二进制打开后，旧 List/Detail/Search/Annotations 仍可读；新二进制重新打开后能识别旧二进制写入并重建侧表；回滚不得丢 note/tags/props/annotations。
9. **查询计划与 I/O**：在 `tmp/` 一致性副本上对当前/候选结构分别记录 `EXPLAIN QUERY PLAN`、scan 行数、读页数、返回字节、P50/P95；尤其验证「窄表查询不碰正文 overflow pages」和「详情 join 不比当前宽表显著退化」。本子任务未执行该项。

---

## 7. 证据边界

- **代码证实**：消费者、SQL、调用链、缺字段、loadAll 每帧必 miss、SaveMessages delete+insert、schema 初始化行为。
- **需实测**：当前生产中 loadAll continuation 的实际调用次数、SaveMessages 实际耗时/WAL 大小、写锁争用、各候选结构 P50/P95、窄表/正文 join 是否净收益。
- **未修改**：生产代码、前端、spec、当前 SQLite/WAL/SHM、任何 provider JSONL；唯一写入是本报告文件。
