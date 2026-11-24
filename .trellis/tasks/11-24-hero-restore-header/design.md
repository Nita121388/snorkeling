# 技术设计：恢复时补盖章 hero 身份 meta

> 包 `N-1124-hero-restore-header`。实现前先读 `prd.md`（含非目标：方案 B 不做）。
> 设计原则：**hero 身份只在恢复 meta 里补一章，显示端一行不改**；解析规则与登场/派生保持同一口径。

## 1. 数据流（改动后）

```
GUI: AISessions.RestoreContext(id)
        └─ aisessionsservice.RestoreContext
             └─ agentcontrol.ResolveVendorRestoreContext(summary)   ← hero 解析唯一入口
                  └─ ResolveHeroForSummary(summary) → HeroID/HeroName/HeroEmoji
        └─ response{ sessionid, source, projectpath, ..., hero, heroname, heroemoji }
        └─ frontend restoreMetaForSession(context) → block meta 带 hero 键

CLI/MCP: wsh agent resume / snorkeling_agent_resume
        └─ agentcontrol.ResolveRestoreContext(summary)
             └─ ResolveVendorRestoreContext(summary)                ← 同一个解析入口
        └─ BuildResumeBlockMeta(restoreCtx, cwd) → block meta 带 hero 键

显示端（零改动）：block.tsx heroHeaderName / agent-logo.tsx getAgentIcon / term-model.ts cwd 芯片
```

## 2. 契约（字段逐一对应，parity 测试锁死）

### 2.1 `agentcontrol.RestoreContext`（`pkg/agentcontrol/restore.go` L56 附近）

新增三个字段，空串 = 不属于任何 hero：

```go
HeroID    string // hero id（= 据点目录名）；空 = 无 hero
HeroName  string // 纯名字（无 emoji 前缀；hero.json name 为空时回落 id）
HeroEmoji string // hero emoji；空 = 不写 agent:emoji
```

### 2.2 GUI RPC 响应（`pkg/service/aisessionsservice/aisessionsservice.go` L550）

```go
type AISessionsRestoreContextResponse struct {
    SessionID   string `json:"sessionid"`
    Source      string `json:"source"`
    ProjectPath string `json:"projectpath,omitempty"`
    VendorID    string `json:"vendorid,omitempty"`
    VendorName  string `json:"vendorname,omitempty"`
    ConfigDir   string `json:"configdir,omitempty"`
    Hero        string `json:"hero,omitempty"`       // 新增
    HeroName    string `json:"heroname,omitempty"`   // 新增
    HeroEmoji   string `json:"heroemoji,omitempty"`  // 新增
}
```

改完必须跑 `node scripts/run-task.mjs generate`（`cmd/generatets` 重生成 `frontend/types/gotypes.d.ts`），**不要手改 d.ts**。

### 2.3 block meta 键（与 `buildHeroLaunchBlockDef` 完全一致）

| 键 | 值 | 条件 |
|---|---|---|
| `hero` | hero id | 恒写（有 hero 时） |
| `hero:name` | 纯名字（无 emoji 前缀） | 名字或 id 非空时写 |
| `display:name` | 同 `hero:name` | 同上 |
| `agent:emoji` | hero emoji | 仅 emoji 非空时写 |

后端字符串常量：在 `restore.go` 定义 `heroMetaKeyHero = "hero"` / `heroMetaKeyName = "hero:name"` / `heroMetaKeyDisplayName = "display:name"` / `heroMetaKeyAgentEmoji = "agent:emoji"`（或复用已有常量，若无则本地定义并在注释指向 hero-launch.ts）。
前端必须复用导出常量：`AgentHeroIdMetaKey` / `AgentHeroNameMetaKey`（`frontend/app/workspace/hero-launch.ts`）、`AgentEmojiMetaKey`（`frontend/app/view/term/agent-logo.tsx`），不要写字面量。

## 3. hero 解析（唯一实现）

新文件 `pkg/agentcontrol/hero_resolve.go`：

```go
// ResolveHeroForSummary 返回会话所属 hero（零值 = 不属于任何 hero）。
// 规则与 aisessionsservice.deriveHeroProps / 前端 makeHeroPathMatcher 同口径。
func ResolveHeroForSummary(summary *aisessions.SessionSummary) hero.Hero
```

规则顺序：

1. **显式 `props.hero` 优先**：`summary.Props["hero"].Value` 为字符串且 trim 非空 → `hero.Get(root, id)`。
2. 否则 **cwd 派生**：`hero.MatchProjectPath(root, heroes, summary.ProjectPath)` 命中 id → `hero.Get(root, id)`。
3. 任何一步失败（root 不可解析 / hero.json 读不到 / 条目不存在）→ 返回零值，**绝不阻断恢复**（best-effort，日志走 `debugf`）。
4. root 来源：`hero.ResolveRoot(wconfig.GetWatcher().GetFullConfig().Settings.HeroRootDir)`（与 aisessionsservice.heroSettingsRoot 同口径；`hero.ResolveRoot` 已支持 `HERO_ROOT` 供测试）。
5. Name 回落：`hero.Name` 为空 → `hero.ID`；`hero.Emoji` 原样 trim。

### 3.1 新建 canonical matcher：`pkg/hero/match.go`

把段边界匹配收进 pkg/hero（纯 stdlib，符合该包约束）：

```go
// MatchProjectPath 返回 root 下游第一级目录名命中名册条目的 hero id；未命中返回 ""。
// 规则：段边界（root/id 或 root/id/…）、`/` 与 `\` 都认、大小写不敏感、
// Clean 处理 `..`/`.`、root 与路径同时规范化。
func MatchProjectPath(root string, heroes []Hero, projectPath string) string
```

`aisessionsservice.deriveHeroProps` 改为调用它（机械替换，**行为不变**，由现有 `persona_roster_test.go` 的 4 个用例锁）；`normalizeMatchPath` 若无其它调用点则删除。
**不要**改 `deriveHeroProps` 的「显式 props.hero 不覆盖 / 就地补带 PropertyCell{Source:"hero-derived"}」语义。

### 3.2 挂载点

- `agentcontrol.ResolveVendorRestoreContext`：构造完 base `restoreCtx`（L104-108）后、`if summary.Source != aisessions.SourceClaude` 早退（L109）**之前**调用 `ResolveHeroForSummary` 并填三字段。这样 GUI 与 CLI 一次覆盖，且 vendor 失败路径也不会丢 hero 字段（错误返回前已填好）。
- `BuildResumeBlockMeta`：有 `HeroID` 时按 §2.3 盖章。
- `aisessionsservice.RestoreContext`：从 `restoreCtx.HeroID/HeroName/HeroEmoji` 拷进 response（现有 vendor 分支之后，返回前统一拷）。
- 前端 `restoreMetaForSession`（`frontend/app/view/aisessions/utils.ts` L743）：有 `context.hero` / `context.heroname` / `context.heroemoji` 时按 §2.3 盖章。保持纯函数、不读 store。

## 4. 测试（G2：先写红再实现）

1. `pkg/hero/match_test.go`（新）：段边界（`backup` 不吃 `backup-guard`）、`\` vs `/`、大小写、`..` 清洗、root 本身不是 hero、空输入。
2. `pkg/agentcontrol/hero_resolve_test.go`（新）：显式 props.hero 优先（cwd 指向另一个 hero 时也赢）、cwd 派生、hero.json 名/emoji 带入、name 空回落 id、root 不可用返回零值不 panic（用 `HERO_ROOT` 指向 t.TempDir 里造的 hero 目录）。
3. `pkg/agentcontrol/restore_test.go`：fixtures 扩字段 `HeroID/HeroName/HeroEmoji` + 期望 meta 键；`TestBuildResumeBlockMetaParity` 增加断言：有 hero 时 4 个键齐、无 hero 时 4 个键都不出现、emoji 空时不写 `agent:emoji`、`hero:name` 不含 emoji 前缀。
4. `pkg/service/aisessionsservice/aisessionsservice_test.go`：RPC 层 response 带 hero 字段（可 mock manager 或复用现有 RestoreContext 用例）。
5. `frontend/app/view/aisessions/utils.test.ts`：`restoreMetaForSession` 带 hero context → 断言 4 个键；无 hero → 断言都不出现；`heroname` 与 `heroemoji` 组合正确。
6. 前端 source-contract（可选，与现有风格一致）：断言 `restoreMetaForSession` 用的是 `hero-launch.ts` 的常量而非字面量。

## 5. 风险与坑

- **parity 两端必须同一 commit 改完**：只改 Go 或只改 TS，`TestBuildResumeBlockMetaParity`/utils 测试会红（这是设计护栏，不是 bug）。
- `gotypes.d.ts` 必须生成而非手改；生成会顺带刷新别的类型，`git diff` 里只接受与本包相关的字段 diff。
- `pkg/agentcontrol/restore.go`、`restore_test.go`、`aisessionsservice.go`、`gotypes.d.ts` 同时在 **F-1121-agent-resume** 的 touch 白名单（该包 g6 expired 阻塞）。本包只动 hero 三字段与 meta 盖章，不动 resume 命令语义 / E_USAGE / tab 目标解析。
- `hero:name` 严禁带 emoji 前缀（N-1119 已定：emoji 只留 `agent:emoji`）。
- 零 hero 场景必须字节级保持今天的行为（无 hero 时 meta 与现状完全一致）—— 判据里要有一条 diff/键存在性断言守住。
- 真机验证：`node scripts/verify/index.mjs` 看是否有合适 area；没有则按 `scripts/verify/README.md` 建 `hero-restore-header` area 或走 G7 人工验收。
