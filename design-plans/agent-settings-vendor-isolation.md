# Claude Vendor 隔离：恢复 Hooks、AI Sessions 与只读诊断

Written against: `73cd16d80ce0eb298d171f76cf134b9c5518e6cb`

## Evidence chain

- Surface: `frontend/app/workspace/widgets.tsx` 的 `AgentTargetFloatingWindow` 齿轮入口，以及它实际打开的 `frontend/app/modals/agenthooksettingsmodal.tsx`。
- Root problem A: `pkg/ccswitch/reader.go` 的 `settingsConfigShape` 和 `materializeClaudeConfigDir` 只保留 `env`；vendor block 通过 `CLAUDE_CONFIG_DIR` 读取隔离 `settings.json` 后看不到全局 Claude hooks，因此不会发送 agent-status 事件。
- Root problem B: `pkg/aisessions/paths.go:71-84` 只扫描进程级 `CLAUDE_CONFIG_DIR` 和全局 `~/.claude/projects`，而 vendor 路径只注入单个 block 的 `cmd:env`；真实会话写在 `<WaveDataDir>/claude-vendors/<vendorID>/projects/`，所以 AI Sessions 永远扫不到。
- Data-loss risk: `pkg/ccswitch/reader.go:304-331` 的 `gcVendors` 对 orphan vendor 直接 `os.RemoveAll`。vendor 目录已包含 Claude 写入的 `projects/`、`sessions/` 等数据，删除 cc-switch vendor 可能连历史会话一起删除。
- Product evidence: `E:/primary/Obsidian/My Projects/Snorkling/方案/Agent状态与识别/25-Vendor 隔离 Claude 丢失 Hooks 致 agent-status 不显示 — 根因与修复方案.md` 已确定默认策略为“vendor env + 全局 hooks”；`E:/primary/Obsidian/My Projects/Snorkling/开发细节/Sessions与列表/Claude Vendor 隔离下 Sessions 与 Agent-Status 失效-根因分析.md` 记录了 vendor Sessions 的实际写盘路径、扫描缺口和 Resume 风险。
- Design evidence: `docs/design-system.md`、`.mockup/new-agent-panel/prototype.html`、`.mockup/new-agent-panel/README.md` 和当前 `AgentHookSettingsModal`。
- Rendered evidence: Playwright 在 `1440x900` 的 Details 状态测得 shell 高 `923.75px`、底部 `1028.75px`，footer 已在首屏外；在 `700x600` 时 footer 底部为 `1045.75px`。截图见 `design-plans/agent-panel-1440x900-details.png` 与 `design-plans/agent-panel-700x600-details.png`。
- Repository state: GitNexus 索引停在 `8ceaaa06`（2026-07-18），落后当前提交 `73cd16d8`；当前会话没有 GitNexus MCP，本地也没有 `.gitnexus/run.cjs` 或已安装 CLI，因此旧索引不能作为当前 blast-radius 证据。
- Existing parallel work: `.claude/worktrees/ccswitch-vendor-isolation` 是干净的 `feat/ccswitch-vendor-isolation`，提交 `01611a96` 只实现了最初 vendor 隔离，不包含本次 hooks 修复，不应合并或重复规划。
- Scope and affected surfaces: Claude vendor 物化与 GC、AI Sessions 扫描/索引/Detail/Stat/Resume、Sessions vendor 标识、New Agent 齿轮、Agent Settings Modal、按需读取的 vendor 隔离诊断。Codex 只做回归验证。
- Uncertainty: `permissions`、`outputStyle`、`enabledPlugins` 当前没有已验证的真实使用需求；在有用户证据前不为它们建立持久化配置层。

## Design language

- Audited surface: New Agent 齿轮打开的 Agent Settings Modal。
- Design sources: `docs/design-system.md`、当前 `AgentHookSettingsModal`、原型运行态截图。
- Documented decisions: Modal 使用 header、可滚动 content、固定 footer；使用语义 token；原生控件优先；主操作使用 action token；深色、浅色、monochrome 等价。
- Governing owners and consumers: `AgentTargetFloatingWindow`、`AgentHookSettingsModal`、`Modal`、`Button`、`Toggle`、`pkg/ccswitch`、`WshRpcInterface` / `WshServer`。
- Explicit exceptions: None documented.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | 原型的 `Basics` 是占位，会丢掉齿轮入口当前已有的 Agent Hooks 检查与修复功能 | `widgets.tsx:683-684` 打开 `AgentHookSettingsModal`；该 Modal 当前完整承载 Check/Install/Update/Repair | Tab 改为 `Agent Hooks / Details`；只有第三批获批后再增加 `Inheritance`，默认仍打开 `Agent Hooks` | 设置 Modal | High |
| 2 | Details 长内容让整个 shell 超出视口，footer 不固定 | 运行态 `1440x900` footer bottom=`1028.75`；`700x600` footer bottom=`1045.75`；设计规范要求固定 footer | 在 feature-local shell 上设置 viewport max-height，只有 Tab body `overflow-y-auto`，不修改共享 `modal.scss` | 设置 Modal 布局 | High |
| 3 | 原型继承开关是无语义的 `div.toggle-check`，不能通过键盘操作 | 原型 DOM 没有对应 `input[type=checkbox]`；`docs/design-system.md` 要求原生 checkbox 语义，仓库已有 `Toggle` | 第三批若落地继承编辑器，必须复用 `Toggle`，并由真实 `disabled` 表示全局源不存在 | Inheritance Tab | High |

## Improve first

先处理 Finding 1，并把功能拆批。根因修复不应等待设置面板；只读 Details 也不应被尚无需求证据的继承偏好存储拖住。

## Design decision

按四个独立批次交付：

1. P0-A：修复 Claude vendor 默认继承全局 hooks，恢复隔离 block 的 agent-status。
2. P0-B：让 AI Sessions 扫描、索引、读取并标识所有 Claude vendor 会话，同时禁止 GC 删除会话数据。
3. P0-C：Resume 必须带回原 vendor 上下文；vendor 已删除或配置不可用时明确阻止恢复，不能静默回退全局 Claude。
4. P1：把现有 Modal 扩为 `Agent Hooks / Details`，Details 只读、按需加载、全程脱敏。可编辑 `Inheritance` 继续 Deferred。

原型中的 `Target` 删除，因为物化状态不按 tab/target 存储。`Reinstall global hooks` 不在 Details 重复实现；异常状态提供 `Go to Agent Hooks`。`Reveal` 与原始 `Copy JSON` 删除，后端只返回脱敏预览，按钮文案为 `Copy redacted JSON`。

## Reuse

- `frontend/app/modals/modal.tsx` 的 `Modal`，但不修改共享 `modal.scss`。
- `frontend/app/element/button.tsx` 的 `Button`。
- `frontend/app/element/toggle.tsx` 的 `Toggle`，仅第三批使用。
- `frontend/util/clipboard.ts` 的 `copyText`。
- `getApi().openNativePath`，无需新增 Electron IPC。
- `frontend/app/workspace/ccswitch-vendors.ts` 的 `loadCcSwitchVendors`。
- `BlockServiceType.CheckAgentStatusHooks` / `InstallAgentStatusHooks` 继续是 hooks 检查与修复的唯一 owner。

不新增依赖，不创建通用 UI primitive，不写 cc-switch DB。

## Changes

1. 执行前门禁：刷新 GitNexus 并保护脏工作树
   - Change: 先使用仓库规定方式补齐/运行 GitNexus 分析，再对 `listVendors`、`materializeClaudeConfigDir`、`AgentTargetFloatingWindow`、`AgentHookSettingsModal`、`WshRpcInterface` 和相关 server command 做 upstream impact。
   - Preserve: 当前所有用户改动，尤其 agent-status、session overview、theme、Common Text、`package-lock.json` 和原型。
   - Verify: 记录 direct callers、processes 和风险等级；任一 HIGH/CRITICAL 先报告，不进入对应批次。

2. P0：`pkg/ccswitch/reader.go` 修复 Claude hooks 物化
   - Change: 用命名 document shape 表达 `env` 与可选 `hooks`；每次 `listVendors` 在循环外读取一次真实全局 `~/.claude/settings.json`，只提取顶层 `hooks`。
   - Change: `materializeClaudeConfigDir` 接收 hooks；最终 `MarshalIndent` 输出仍按完整文件 bytes 比较以保持幂等。只保证 hooks 的 JSON 语义，不声称保留源文件空白格式。
   - Change: vendor ID 进入 `filepath.Join` 前验证为单个安全路径段；空值、`.`、路径分隔符或清理后变化均拒绝物化。
   - Preserve: vendor `env` 仍来自 cc-switch DB；DB 行内 hooks 与其它键继续忽略；全局文件缺失、无效或无 hooks 时仍生成旧版仅 env 形状；Codex、GC、official fallback 和软失败契约不变。
   - Verify: 新建 `pkg/ccswitch/reader_test.go`，覆盖继承 hooks、无 hooks legacy shape、hooks 更新后重物化、未变化幂等、非 env DB 键不渗入、非法 vendor ID 不逃逸根目录。

3. P0：端到端恢复验证
   - Change: 选择一个 Claude vendor 新建 block；验证隔离 `settings.json` 有 hooks，且日志持续出现该 block 的 `[agentstatus] recv`。
   - Preserve: 已运行 block 不承诺热恢复，明确要求重启。
   - Verify: 连续两次 `listVendors` 输出 bytes 相同；修改全局 hooks 后再次触发会更新隔离文件。

4. P0-B：AI Sessions 纳入所有 Claude vendor roots
   - Change: 由 `pkg/ccswitch` 暴露只读的 Claude vendor root 枚举，`pkg/aisessions/paths.go` 将每个 `<WaveDataDir>/claude-vendors/<vendorID>/projects` 增量加入 `DefaultClaudeProjectDirs()`；保留全局 `~/.claude/projects`、进程级 override 和非 Windows cache root，并继续用 `uniqueStrings` 去重。
   - Change: 目录枚举以磁盘上已存在的 vendor root 为准，而不是只看 cc-switch 当前 live rows，确保 vendor 被删除后保留下来的历史会话仍可见；忽略文件、空路径和逃逸 root 的条目。
   - Change: `ClaudeProvider` 解析 summary 时，从已验证的 vendor root 写入 `vendorid` 与 `configdir` provenance；给 `SessionSummary` 和 SQLite `ai_sessions` 增加对应字段与幂等 schema migration，JSON tags 使用全小写且无下划线。
   - Change: `pkg/service/aisessionsservice/isKnownAISessionFilePath` 继续复用扩展后的 `DefaultClaudeProjectDirs()`，因此 List、Summary、Detail、DetailDelta、UserOutline、UserLines 和 Stat 使用同一 allow-list，不另建平行路径规则。
   - Change: AI Sessions 列表行和详情元数据显示 `Vendor <short id>`；若能从当前 vendor 列表解析名称则显示名称，否则保留 ID，避免 vendor 删除后标签消失。
   - Preserve: StableKey 仍是 `source + id + filepath`，不迁移或复制 jsonl；subagent jsonl 继续按现有规则排除；远程 provider 不受本地 WaveDataDir 影响。
   - Verify: 在全局和两个 vendor roots 放置同 ID/不同 FilePath 的 fixtures，确认全部唯一出现、Detail/Stat 可读、SQLite 重开后 provenance 不丢、列表筛选和排序不回归。

5. P0-B：收紧 `gcVendors`，历史会话不可被递归删除
   - Change: 禁止对整个 vendor 目录调用 `os.RemoveAll`。orphan 时只删除 Wave 明确拥有的物化凭据/配置文件：Claude 的 `settings.json`，Codex 的 `auth.json`、`config.toml`、`hooks.json`、`cc-switch-model-catalog.json`；随后只用 `os.Remove` 尝试删除空目录。
   - Change: `projects/`、`sessions/`、`plugins/`、`skills/`、未知文件和非空子目录一律保留，并记录不含敏感值的 orphan-retained 日志。
   - Preserve: live vendor 的幂等重物化不变；不得因为保留历史会话而继续使用已删除 vendor 的凭据。
   - Verify: fixture 含 `settings.json + projects/session.jsonl` 时 GC 只删除 settings、保留 jsonl 和目录；纯 Wave-owned 空 orphan 可以清理；任何测试失败都不得留下真实 token。

6. P0-C：AI Sessions Resume 恢复原 vendor 上下文
   - Change: 在 `AISessionsService` 增加 `RestoreContext`：按 session key/id 重新加载 summary，由后端验证 `configdir` 位于当前 WaveDataDir 的 `claude-vendors/<vendorID>` 下、目录与 `settings.json` 存在，并通过强刷后的 cc-switch Claude vendor 列表确认 vendor 仍为 live；返回经过验证的 `configdir`、`vendorid`、`vendorname` 与 session id。不能让前端用字符串猜测或缓存代替信任边界校验。
   - Change: `frontend/app/view/aisessions/aisessions.tsx` 的 `restoreSession` 先调用 `RestoreContext`；Claude vendor summary 写入 `cmd:env.CLAUDE_CONFIG_DIR=configdir`、`agent:claudevendorid=vendorid`、`agent:claudevendorname=vendorname` 和原 `agent:sessionid` 后再创建 block。全局 session 返回空 vendor context，沿用现状。
   - Change: vendor 配置不可用时服务返回稳定错误 `Vendor configuration is no longer available`，前端不创建 block，也不回退全局 `~/.claude`。`restoreCommandForSession` 仅在拿到有效 restore context 后为 vendor session 生成设置 `CLAUDE_CONFIG_DIR` 的平台正确命令；不能只给 `claude --resume <id>`。
   - Preserve: 全局 Claude session 与 Codex 的现有恢复行为不变。
   - Verify: 服务拒绝伪造/逃逸 configdir 和 stale vendor；vendor Resume 创建的 block meta/env 指向原 vendor；全局 session 不增加 config dir；已删除 vendor 明确失败；Windows 路径含空格时命令引用正确。

7. P1：新增只读、按需诊断 RPC
   - Change: 在 `pkg/ccswitch` 增加一个 feature-local status 聚合 owner，并新增 `CcSwitchGetVendorIsolationStatusCommand`；输入只含 `apptype` / `vendorid`，JSON tags 全小写无下划线。
   - Change: 返回 vendor 身份、config dir、物化文件名/存在状态、top-level keys、env 数量、hooks 事件数量、继承来源状态和脱敏预览；不得返回原始 token、secret、password、key、auth 值。
   - Change: 只读取一个已由当前 cc-switch live 列表确认的 vendor；official/no-config、DB 缺失、文件缺失、JSON 损坏分别返回可渲染状态，不把设置页故障传播到 New Agent 启动链路。
   - Preserve: list RPC 保持轻量且继续服务启动流程；不把诊断大 payload 或预览塞进 `VendorList`。
   - Verify: 表驱动测试覆盖 redaction、未知 vendor、路径边界、损坏文件、Claude/Codex 文件差异和无敏感字段泄漏。

8. P1：扩展 `AgentHookSettingsModal`
   - Change: 齿轮传入当前 app/vendor 作为初始上下文；Modal 可见标题改为 `Agent Settings`，Tab 为 `Agent Hooks / Details`，默认 `Agent Hooks`。
   - Change: 原样保留现有 hook 表格的 loading、empty、版本、status、reason、Install/Update/Repair、Retry、notice 和错误恢复。Claude hook 修复成功后强刷 Claude vendors，并使 Details 失效重取。
   - Change: Details 顶部只显示 `App` / `Vendor`；不显示 `Target`。展示路径、文件/键计数、hooks 诊断、脱敏 ENV 和脱敏物化预览；支持 `Open isolation dir`、`Copy redacted JSON`、`Go to Agent Hooks`。
   - Change: 本地 shell 维持 `600px` 宽，并设置 viewport max-height；header/tab/footer 固定，只有 Tab body 滚动。footer 在只读版本只放 `Close`，没有无效 `Apply`。
   - Preserve: New Agent 主浮层的 profile/vendor/target/launch 行为和尺寸不变；共享 Modal owner 不改。
   - Verify: dark/light/monochrome、`900px` 与 `600px` 高度、长路径/长 JSON、keyboard focus、loading/empty/error/official 状态。

9. Deferred：按证据决定是否实现 Inheritance
   - Change: 先收集至少一个 `permissions`、`outputStyle` 或 `enabledPlugins` 的真实 per-vendor 场景；没有证据则停止，保留默认 `env + hooks`。
   - Change: 若获批，再单独设计 Wave 私有偏好 schema、原子写入、Get/Set RPC、四键白名单、dirty draft/Apply 和运行 block 重启提示；复用 `Toggle`。
   - Preserve: 不支持任意键、不编辑物化文件、不写 cc-switch DB，Codex 固定继承只读。
   - Verify: 作为独立计划、独立 impact、独立测试批次执行，不与 P0/P1 同一提交。

## Scope

- Inherit: 通过 New Agent 齿轮进入设置的用户、cc-switch Claude vendor block，以及 AI Sessions 中现存和未来产生的 Claude vendor 会话。
- Verify: AI Sessions List/Detail/Stat/Resume/Delete/Note/Tags、SQLite 索引、Codex vendor、全局 Agent Hooks 和 New Agent 启动均不回归。
- Exclude: 重做 New Agent 主浮层、按 target/tab 存设置、写 cc-switch DB、手动编辑物化 JSON、修改共享 Modal 样式、立即实现三种低使用率继承键。

## Validation

- Repository setup: `npm run setup`。
- Go P0: `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/ccswitch/..."`。
- Go Sessions: `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/..."`。
- Go P1: `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/ccswitch/... ./pkg/wshrpc/wshserver/..."`。
- Vet: `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go vet ./pkg/ccswitch/... ./pkg/wshrpc/wshserver/..."`；不运行项目禁止的 `go build`。
- Generate: `node scripts/run-task.mjs generate`，只改 Go source 后生成 bindings，不手改生成文件。
- Frontend: `npm test -- --run frontend/app/view/aisessions/utils.test.ts frontend/app/modals/agenthooksettingsmodal.test.ts frontend/app/modals/agentvendorisolationsettings.test.ts`。
- Build: `npm run build:prod`。
- Electron: `npm run dev:cdp` 后使用 `node scripts/inspect-electron-ui.mjs`；先验证 vendor session 在 AI Sessions 列表可见、详情可读、vendor badge 正确、Resume 回到原 vendor，再检查设置 Modal 的三个主题、两种高度、footer、focus 和错误态。
- GitNexus: 提交前运行 `detect_changes({scope: "compare", base_ref: "main"})`，只允许预期的 ccswitch、RPC/generated bindings、Agent Settings 和测试 flows。

## Stop conditions

- 任一必改符号的 upstream impact 为 HIGH/CRITICAL。
- 修复要求改共享 `Modal` / `FlexiModal`；该 owner 已在设计规范中标为 CRITICAL。
- 当前分支在实施前已出现另一套 Claude hooks 来源或物化契约。
- `DefaultClaudeProjectDirs` 或 `SessionSummary` impact 为 HIGH/CRITICAL，或 SQLite migration 不能做到现有索引无损升级。
- 任何方案仍允许 `gcVendors` 递归删除包含 Claude 生成数据的目录。
- Resume 无法在创建 block 前确认 vendor config 仍然有效；此时宁可禁用恢复，不得静默切到全局 provider。
- 诊断 RPC 只能通过返回未脱敏 secrets 才能实现。
- P1 被要求同时加入可编辑 inheritance；先完成 P0/P1，再单独确认第三批数据模型。

## Design documentation

- P1 验证通过后更新 `.mockup/new-agent-panel/README.md`：承载关系改为 New Agent 齿轮打开的 Agent Settings Modal，记录 `Agent Hooks / Details`、无 `Target`、只读脱敏和固定 footer。
- 第三批获批前，原型的 `Inheritance` 明确标为 future concept，不作为当前实现验收标准。
