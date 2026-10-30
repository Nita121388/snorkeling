# origin 抽象层后端：外部根配置 + provider 注册 + Origins RPC + 白名单修复

## Goal

让 AI Sessions 支持"扫描根 = origin"概念：本机默认目录是一个 origin，用户声明的外部目录（如 `~/Primary/MyData/pi`，来自另一台机器网盘下载）是额外的只读 origin。P1 交付后端能力，前端可用。

## Requirements

### R1 外部根配置

- settings.json 新增配置键 `ai:sessions:externalorigins`（JSON 数组），每项结构：
  ```json
  { "label": "Win-ChemClin", "path": "~/Primary/MyData/pi", "source": "pi", "readOnly": true }
  ```
  - `label` 必填（展示名）；`path` 必填（支持 `~` 展开）；`source` 可选，缺省 `pi`；
  - `readOnly` 缺省 `true`（外部 dump 视为只读，禁止删除/改写）。
- env 兜底 `WAVETERM_AI_SESSIONS_EXTRA_ROOTS`（`:` 分隔的路径列表，label 用 basename）。
- 路径不存在 / 非目录 → 跳过该 origin（不报错，不阻塞其它 origin）。
- 配置非法（非数组 / 项缺 path）→ 跳过该项，不 panic。

### R2 provider 注册

- `DefaultProviders()` 保持现状（本机默认根）。
- 新增 `ExternalProviders()`（或等价函数）为每个对外根生成 provider（P1 只支持 Pi 格式）。
- 外部根每个 origin 独立 sqlite/meta 路径，避免与本机索引冲突：
  `<dataDir>/origins/<safe-id>-index-v2.sqlite` 与 `-meta.json`。

### R3 Origins RPC

- 新增 `AISessionsService.Origins(ctx, req)` 返回：
  ```go
  type AISessionsOrigin struct {
      ID        string // "local" 或外部根稳定 id（path 派生）
      Label     string
      Path      string // local 为 ""
      Kind      string // "local" | "dump"
      Source    string // "pi" | ...
      ReadOnly  bool
      Count     int    // 会话数（可懒加载/缓存，失败返回 0 不阻塞）
  }
  ```
- 前端 `services.ts` 暴露 `Origins`。

### R4 List/Detail/Stat 按 origin 路由

- `AISessionsListRequest` / Detail / Stat 请求新增 `Origin string` 字段（空 = local，向后兼容）。
- `managerForRequest` 增加 origin 解析：origin 为空/local → `newLocalManager()`；否则 → 该 origin 的 manager（外部根 provider + 独立 index/meta）。
- 未知 origin id → 明确错误（不静默退回 local，避免误读数据）。

### R5 路径白名单修复

- `isKnownAISessionFilePath()` 当前只允许 codex + claude 根。改为：
  1. 纳入本机 Pi 根（`DefaultPiSessionsDir()`）；
  2. 纳入所有已配置外部根。
- 保持"路径必须在已声明根内"的安全语义，不放开任意路径。

## Constraints

- 不改动本机默认行为（origin 为空时完全等价现状）。
- 遵守 `aisessions-scan-contract.md`：不得直接调 `ScanSummaries`；外部根有独立 scanKey（SQLitePath 不同），天然隔离。
- 只读 origin 的写操作（Delete/Mark/Note/Tags/AutoGenerate 等）返回明确错误，不改文件。
- 不向前端泄漏未经声明的任意文件系统路径。

## Acceptance Criteria

- [ ] 配置 `ai:sessions:externalorigins` 指向 `~/Primary/MyData/pi` 后，`Origins` RPC 返回 local + 该 dump（Kind=dump, ReadOnly=true, Count>0）。
- [ ] `List({origin:"<dump-id>"})` 返回该 dump 的会话（pi jsonl 可解析）。
- [ ] `Detail({origin, id})` / `Stat({origin, id})` 能读到外部根文件（白名单放行）。
- [ ] 未知 origin id 返回错误；origin 空 = 本机行为完全不变（现有测试全绿）。
- [ ] 外部根配置非法/路径不存在时被跳过，不 panic、不阻塞本机 origin。
- [ ] `go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...` 全绿，含新增 origin 用例。
- [ ] `go build ./...` 通过。

## Notes

- P1 只做 Pi 格式；codex/claude 多格式探测留给后续。
- 只读定义先聚焦"写文件类操作"；UI 层的禁用按钮由 P2 负责（本任务返回错误即可）。
