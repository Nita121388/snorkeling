> **Confirmed: 2026-11-24 @nita**

# 索引徽标的 agent 发现面：`wsh block refresh` + agent guide 能力条目

## Goal

让 agent 不需要记住 meta 键名就能用「文件夹索引徽标」：一条语义化命令刷新 Files block 的装饰，
并把这条能力写进 `wsh agent guide`（同一张表自动生成 `wsh agent install-skill` 写出的 skill），
使外部 agent 一进 app 就能自我发现、直接使用。

## Requirements

### 做什么

1. **`wsh block refresh <block|this>`**：解析目标 block（复用 `resolveBlockArg`），写 meta
   `preview:idxrefresh=<ms>`（默认键；`--key` 可改，`--value` 可指定，默认当前毫秒），
   `--json` 输出 `{blockid, key, value}`。写 meta 走既有 `SetMetaCommand`，不新增 RPC/事件。
2. **agent guide 能力条目**：`pkg/agentguide/agentguide.go` 的 `Commands()` 加 `block refresh`
   （scope `navigate`），Notes 说明：Files/preview block 刷新后重读 `index.md` 与 `.index/badges.js`；
   功能默认关，开启方式 `wsh setmeta -b this preview:idxbadges=on`。
3. **skill 自动同步**：`wsh agent install-skill` 与 guide 共用同一张表 → 无需单独维护 skill 文件；不改全局 skill。
4. **单测**：`pkg/agentguide` 表含 `block refresh` 条目（命令/scope/notes 稳定）。

### 不做什么

- 不加 MCP 工具（`pkg/agentmcp` 不动）；不改前端；不改 `snorkeling-control` 全局 skill。
- 不新增 RPC / 事件类型（刷新只写 meta）。
- 不改 `wsh setmeta` 既有行为。

## 验收判据

1. `go build -o tmp/wsh-check.exe ./cmd/wsh && echo WSH_BUILD_OK` → `WSH_BUILD_OK`
2. `tmp/wsh-check.exe block refresh --help >nul 2>&1 && echo BLOCK_REFRESH_OK` → `BLOCK_REFRESH_OK`
3. `tmp/wsh-check.exe agent guide --json | findstr /C:"block refresh"` → 含 `block refresh`
4. `go test ./pkg/agentguide/... ./cmd/wsh/cmd/... && echo GO_TESTS_OK` → `GO_TESTS_OK`

红证：`loop/red/N-1124-idxbadges-agent-surface.txt`（实现前 `wsh block refresh` 为 unknown command）。

## G1 签字

2026-11-24 @nita：确认（会话「ok go on」）。范围 = 语义化 CLI + guide 条目，零新 RPC；MCP 与前端留给 A 包/后续。
