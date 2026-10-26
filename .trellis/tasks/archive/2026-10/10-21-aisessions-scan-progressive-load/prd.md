# AI 会话扫描内存治理与渐进式加载

## Goal

让 AI Sessions 面板在**大历史数据**（本机实测：`~/.pi/agent/sessions` 2.7GB / 1547 个 jsonl，单文件最大 63MB；`~/.codex/sessions` 1.4GB / 3524 个会话）下：

1. **不再把 wavesrv 打崩**（当前会走到 `fatal error: out of memory`，前端表现为"AI sessions 加载失败"）
2. 列表**先出已有数据**，再后台补齐；补齐过程用骨架行表示，不阻塞、不冻结
3. **最新优先**：最近用过的会话先可见，老会话延后扫

## 现场证据（2026-10-21）

- `~/AppData/Local/snorkeling/Data/logs/waveapp.42.log:175097`：`VirtualAlloc ... failed errno=1455` + `fatal error: out of memory`，崩栈为 `ScanSummaries → PiProvider.List → parseSummaryFile → scanTitle`，同时另一路 `CodexProvider.List`
- 同日另一次 OOM 发生在**新建 tab**时（`Data/waveapp.log:3687`）→ 说明系统提交额度已接近上限（当时已提交 30.77GB / 上限 34.5GB，页面文件在 E: 且仅剩 4.7GB）
- SQLite 索引 `index-v2.sqlite` 1.7GB，`ai_session_messages` 68.1 万行、正文 1.35GB；另有两个 ~170MB 索引
- `pkg/aisessions/manager.go:1086` `resolveSession` 在缓存行 mtime/size 不匹配时**同步全量重扫**；overview 每 15s 按 session 轮询 `Summary`（`session-overview.tsx:408`），并发 4 → 多个全量扫描并行
- `populateMessageCounts`（`manager.go:369`）对 limit 内每条 summary 逐条 `LoadMessages`（缓存未命中时解析整文件）
- `PiProvider.scanTitle`（`provider_pi.go:176`）在拿不到 name / 首条有效 user 消息时会**顺序读完整文件**

## Requirements

### R1 内存止血（P0）

- 同一时刻**最多一个**全量 summary 扫描在跑；并发请求复用它（singleflight），不允许 N 路全量扫描并行
- `resolveSession` 遇到"缓存行存在但文件已变（mtime/size 不一致）"时：**立即返回旧缓存行**并后台刷新，不得同步全量扫描
- 只有"SQLite 中完全没有该会话"时才允许走全量扫描，且必须走 singleflight
- `populateMessageCounts` 单次调用有**总字节/条数预算**；超预算的会话保留已有的 `MessageCount`，不解析完整正文
- 单文件解析有大小闸门：超阈值文件不做全文 title 扫描，退化为"头部 + project basename"
- 扫描路径不得无界读内存：单行上限、单文件上限、单次扫描时间预算三者均可配置

### R2 最新优先（P0）

- 扫描文件顺序按 **mtime 倒序**，最近改动的会话先入库、先可见
- 单次同步扫描有**时间预算**（默认 ≤ 8s），超预算返回已有部分结果并标记"未完成"，余下交给后台
- 列表查询在无额外过滤（无 query / 无 tag / 无 project）且已达 `limit` 时可提前结束扫描

### R3 渐进式列表（P1）

- `List` RPC 在"索引尚未完成一次全量扫描"时**立刻返回 SQLite 中已有行**，并带 `scanning` 标记与进度（已扫/总数）
- 前端在 `scanning` 时：已有行正常渲染，其后追加骨架行占位 + 一条"正在同步 n/N"进度条
- 后端扫描进度通过 wps 事件推送，前端收到后**防抖**重取列表（不轮询打满）
- 扫描完成后骨架行平滑消失，最终列表与一次性扫描结果一致

### R4 详情帧复用（P2，可选）

- `LoadAll` / `loadAllDelta` 分帧时不再每帧重新解析整会话；同一会话的解析结果在**有界 LRU**（条数 + 字节上限）内复用
- 超大会话首屏默认展示**最新**内容（配合已有 `LoadAll` 分帧）

## Non-Goals

- 不改 pi / codex 写入的会话 JSONL 文件（只读）
- 不删除本地会话、不迁移 `~/.snorkeling/ai-sessions` 数据
- 不改 pi-subagents 上游 npm 包
- 不做"删除会话"能力（已在父任务中搁置）
- 不改动 `frontend/app/session-overview` 的轮询策略本身（只让它不再触发全量扫描）

## Constraints

1. **绝对不写、不删、不移动** `~/.pi`、`~/.codex`、`~/.snorkeling/ai-sessions` 下的任何用户数据文件；只读取
2. 本任务只改仓库代码 + 测试；不执行任何清理/迁移命令
3. 仓库当前有他人未提交改动（`frontend/app/workspace/widgets.tsx`、`package-lock.json`），**不得**把它们卷进本任务的 commit
4. 提交前必须跑 `detect_changes` 等价检查（无 GitNexus MCP 时：`git diff --stat` + 逐包 `go test`）
5. 前端改动遵循 `.trellis/spec/snorkeling-docs/frontend/`（hooks / state / component / type-safety）

## Acceptance Criteria

- [ ] 在 1547 个 pi 会话 + 3524 个 codex 会话的本机数据下，连续触发 5 次列表刷新 + 5 次并发 `Summary`，wavesrv RSS 峰值 < 1.5GB，不出现 OOM
- [ ] 冷缓存首次打开列表：≤300ms 内返回结果（可能为空），骨架行 + 进度条出现；扫描完成后列表自动补齐
- [ ] 热缓存打开列表：≤150ms 返回，无全量扫描发生（日志可见 scan 跳过）
- [ ] 新建/正在写入的会话，其实时 `Summary` 请求不再触发同步全量扫描（返回旧行 + 后台刷新）
- [ ] 超过大小闸门的单文件不再触发全文 title 扫描，列表仍能显示该项目名
- [ ] 无 query/无过滤 + limit 命中时，同步扫描提前结束
- [ ] `go test ./pkg/aisessions/...` 全绿；新增测试覆盖 singleflight、stale-cache 快返回、预算截断、mtime 倒序
- [ ] `go vet ./pkg/aisessions/... ./pkg/service/aisessionsservice/...` 通过
- [ ] 前端 `vitest` 相关用例全绿，`node scripts/run-task.mjs generate` 生成的类型无未预期 diff
