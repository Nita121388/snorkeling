# Agent Session — 把"工具人 session"凝固成可复用、上下文不增长的 agent 预设

> 顶部这一节是**评审 + 竞品调研之后的决议**（写于原 plan 之后），覆盖原 plan 的部分决定；原 plan 正文在下方保留为执行参考。**实施以本节"决议与砍法 v2"为准。**

## 决议：能做，但按砍法 v2 做（不是按下方原 plan 全量做）

### 一句话
**原 plan 方向正确**（fresh session + preset 注入 + 对话用完即弃），但**体积被砍**——MVP 只做"可手填预设 + fresh 启动带 prelude 注入"；AI 自动提取草稿、自愈快照、独立 Agents view 全部延后；上线自愈前必须配 Ruler 风格的撤销入口。

### 决策输入（来源交叉）
- **竞品调研否决了之前 PM 提的"session pin + fresh copy" MVP**：那版只是"重启换皮"，preset 注入零，没解决"上下文变长"根因。
- **Claude Code subagent 是声明式 preset（`.claude/agents/*.md` frontmatter），不是会话回放** —— 验证 Wave "凝固 = preset 注入、对话用完即弃"语义对齐主流。
- **Ruler（`intellectronica/ruler`，MIT，31 agents，v0.3.44）**给了"自愈污染"那票的标准答案：`ruler revert` + `.bak` + `--dry-run` + `--keep-backups` + per-agent 回滚 + **agent 永不写回、纯 build-time 人监督**。"能力越强 default 越收紧"是它的核心训教。
- **Wave 源码已确认的空白**：`AgentStatusHookProviders=['codex','claude']` 硬编码白名单；repo 内 grep 不到任何 `--system-prompt`/`--append-system-prompt` 或首条消息 prefill 实现 → provider-agnostic prompt 注入是**真空白**，必须新建抽象层而非复用 hook 路径（原 plan §15 选首条消息注入、4 provider 通用、与 CLAUDE.md "preset 即人读指令"心智一致 —— 维持）。
- **Wave 已有可复用范式**：`session.note` 单字符串 + inline `#tag` 正则就地抽取（`session-tags.ts`）+ CLAUDE.md 显式 `Boolean(session.note)≠has-content，须 stripSessionTagHashes().trim()>0 判 prose vs pure-tag 噪声`。**自愈产物必须带同款过滤器**，否则 agent-card 出现假阳性高亮。

### 砍法 v2（已经被内部评审推翻，见下方砍法 v3）

之前给的砍法 v2（"MVP 必含 Phase 1 + Phase 2 手填版 + Phase 3 prelude 注入，借 loader profile picker"）**被对抗式评审推翻**——评审发现砍法 v2 的承重梁 §15 prelude 注入路径基于一个全仓库 grep 零消费点的 meta 键 `cmd:initialinput`，且 plan 自提供的降级路径是伪保险（详见 §评审结论 → must_fix 第一条）。**实际最简 MVP 比 v2 还小**，见下方砍法 v3。

### 内部对抗式评审结论（24 agents，0 失败，8 条 verified）

**4 条 must_fix（实施前必修）：**

1. **§15 prelude 注入承重梁必须先 spike，证明 `cmd:initialinput` 真有消费点**——
   - 全仓库 grep `cmd:initialinput` 仅在 plan 自身命中，源码零消费。
   - `pkg/waveobj/metaconsts.go` 全部 `MetaKey_Cmd*` 常量里无此键。
   - 最近的 `cmd:initscript` 是 shell source 脚本，无 agent CLI 对话注入语义。
   - cmd controller 起跑只读 `cmd/args/cwd/shell/jwt/autoresume/provider`，没有"自动首条 user 消息"消费端。
   - **plan §15 给的降级方案是误读源码**：`term.tsx:472` 显式 `sessionId===''` 时 `setOutline(null)` 直接返回，`userOutlineMessages` 是纯渲染筛选函数（filter `role==='user'`），fresh block 启动时 `outline` 恒为 null——根本喂不进 prelude。
   - 两位 reviewer（long-term-maintainer confidence 高、user-researcher confidence 高）独立核实。
   - **fix**：在 plan 被批准前必须先实做 spike。降级路径应改为**合法路径**：block mount 后由前端 `onMount` 触发一次 `ControllerInputCommand` 自动喂 prelude（`blockcontroller.go:75` + `RpcApi.ControllerInputCommand`，loop 自启输入已有先例），**不靠 cmd controller 起跑读 meta key**。spike 不通过就把整个 prelude 注入砍掉、preset 退回 per-CLI flag 或干脆只做 launcher profile picker 换皮。

2. **§15 spike 失败时的降级路径必须写进 plan 决议章节而非脚注"待实现期确认"**——
   plan §15 脚注自标"待确认"，正文"实现时第一件事是确认这一点"——这正是用户原话"方案大半能因这一个点翻车"的位置，承重梁提前不验证是结构性风险。
   - **fix**：把降级路径（`ControllerInputCommand onMount` 自动喂入 / per-CLI flag 注入）显式写进决议章节主体，"§15 spike 必须做且结果合格"升级为 MVP 推进硬前置门。

3. **Phase 4 上线前必须修补 `SetBaseConfigValue` 跨 key 丢更新竞态**——
   - `SetBaseConfigValue`（`settingsconfig.go:911`）= read-whole → merge → write-whole，整 map 替换。
   - `configWriteLock`（`:30`）只在 `WriteWaveHomeConfigFile`（`:608-609`）内部加，`ReadWaveHomeConfigFile`（`:601-605`）无锁——read 与 write 之间有未受互斥锁保护的临界区。
   - 反例：writer A 在 T0 读到 M0，writer B 在 T1 完成 read-merge-write（写入 `ai:apitoken`），A 在 T2 才拿锁、写入 M0 + A 的 `agent:profiles`，覆盖掉 B 刚写入的 `ai:apitoken`——真实存在的跨 key 丢更新。
   - plan §19 的"包级 mutex + per-preset 30s 防抖"**无法缓解**：mutex 只覆盖写回 worker 调度，旁路 modal Save、Agents view Save、tab context menu、themepicker、webview、widgets 等十余处 `SetConfigCommand` 路径；30s 防抖只防同一 preset 高频自写。
   - Phase 4 把 `agent:profiles` 读改写频率从"用户偶尔改"抬到"agent 每跑完一次写一次"，量级跳一档，把存量缺陷显著放大。
   - **fix**：将 `SetBaseConfigValue` 的 read-merge-write 全程纳入 `configWriteLock`（函数起点 `Lock + defer Unlock`，移除 `WriteWaveHomeConfigFile` 内部那次重复加锁），同一进程内串行化所有写入者的读改写。这是 Phase 4 上线硬前置。

4. **§19 `recentEdits` 实施时必须与决议"带 diff/撤销/审计"对齐**——
   - §19 第二条明文把工具调用名 ∈ `{Edit,Write,MultiEdit,Bash,Read}` 全部当 `recentEdits` 候选，后文只描述"去重、按上限裁剪、字节 no-op、30s 防抖"——没有对 Undo/git restore/被后续 Edit 反掉的识别。
   - 反例：agent 顺序读 5 个、改 3 个、其中 1 个改完方向错又撤回、最后落地 1 个文件——§19 当前过滤无法区分"被撤回的 Edit"与"真正落地的 Edit"，下次 fresh 启动同一 preset 时第二个 agent 看到 4 个 Edit 路径（含被撤回的）当"最近改动"会重新纠结那条死路。
   - 这正是砍法删 `openTodos` 的理由（"agent 当时纠结但已解决的问题会被固化成待办"），同病只切了一半。
   - **fix**：§19 实施时补一条与决议"带 diff/撤销/审计"对齐的过滤——对被 Undo/被 git restore/被后续 Edit 反掉的 Edit 路径排除，或在工具调用相邻序列内被覆盖时只留最终落地项。

**3 条 strongly_advised（强烈建议）：**

- (中) **plan 提供"上下文变长 → 成本和延迟恶化"是真痛点的归因证据**——3 用户访谈或 restore→context growth telemetry，对照候选真痛点 (a) 恢复 session 慢/transcript 渲染瓶颈、(b) 找不回工具人、(c) 续接时旧结论当既定事实 hallucinate。归因偏了 Phase 3 prelude 入口不再应是 MVP 唯一承重点，应先做检索/恢复加速。
- (中) **Verification 章节补一行 fresh-agent block 与原生 restored session 首两轮行为对比验收**——确保体感对齐；加可量化 activation/engagement bar（% 用户 N 天内创 ≥1 preset、preset re-edit prelude 命中率、fresh-vs-resume 延迟 delta）绑定到 v3/v4 决策门，让 v1 上线后有明确 de-scope 依据，而非零观察窗口下赌不可回退 schema 是否有人用。
- (中) **§8/§11 文案补 2-3 句最低 token/429 处理**——token 缺失禁用按钮提示配 API key；429/timeout/非 200 降级到手填草稿并弹错误。v1 不含 AI 起草但手填版 Launch 也靠 API token，同样适用。

**5 条 observability（v1 上线后跟踪项，v3/v4 决策门依据）：**

- (中, pm) 创过 ≥1 preset 的用户比例 / preset fresh launch 次数 vs 同名 session resume 次数 / 3 用户访谈 restore→context growth 三类痛点归因。
- (中, long-term-maintainer) `agent:profiles` 写回频率 / 跨 key 丢更新重放次数 / Save 路径与自愈写回并发冲突次数——验证 §19 防抖+mutex 真拦住场景。
- (中, user-researcher) 3-5 真用户 vs 内部预设质量对比，fresh session vs 原生 resume 首两轮连续性体感是否对齐，是否出现"你忘了你刚才说的"式隔阂。
- (低, skill-maintainer) `recentEdits` 误读率——fresh 启动后 agent 提及后被发现是已撤销修改的"误读"发生率，≥5% 升级到 §19 加 Undo/git restore 过滤硬项。
- (中, user-researcher) preset prelude 真注入成功率——对齐 §15 spike 后的 CarrierInput OnMount 路径，命中率 <90% 把预设机制降级。

**4 条 can_skip（评审放过项）：**

- AI 起草 token 计费/429 退避独立设计（复用 aiusechat）。
- 自愈写回 worker 之外所有 SetConfig 路径逐个加锁审计（must_fix #3 修好后自动覆盖）。
- MVP 阶段承诺多设备 settings.json 一致性（Wave 存量问题，作 known limitation）。
- Preset 命名撞库/lifecycle 全套治理（复用 launcher profile picker 兜住 MVP）。

### 砍法 v3（评审综合后的最简 MVP）

**坚决不做**：sqlite v2→v3 schema 迁移（不可回退、零观察窗口下不该上）、自愈写回 worker（须先修 must_fix #3 跨 key 竞态）、AI 起草 DraftAgentFromSession、独立 Agents view、`recentEdits` 带撤销审计（前提 §19 文本对齐 v2）。

最简 MVP 只三件：

1. **先 spike §15**——一天内 grep 确认 `cmd:initialinput` 消费点并实做一次 fresh-block onMount 经 `ControllerInputCommand` 自动喂 prelude 的预研。**spike 不过就停在这里**，preset 载体退回 per-CLI flag 或干脆砍 prelude 注入改纯 launcher。
2. **MVP 1 = session pin**——只做 `SetAsAgentModal` 手填版 + `agent:profiles` 扩字段复用现有 launcher picker，不引入 fresh/prelude 行为分支，让用户能给一个 session 打钉子并下次快速回到它。
3. **MVP 2 = 选 fresh copy 起一次新调用**——modal 上加 fresh 复选框，fresh=true 时写 `agent:autoresume=false + agent:sessionid`。**确认 `cmd:initialinput` 真有消费点后**再把 prelude 串进首条消息，没有就停在"换皮的 launcher profile"这一档。

砍法 v3 本质是把方案三个承重建在未验证假设上，最简 MVP 就是只验证最承重那个（§15）+ 留一个手填入口给人观察一个月——验证通过再决定是否上 schema 迁移和 fresh+prelude，过不去就把这次决策封存为"preset 概念已探索、暂不上线"，避免不可回退 schema 上线后没用户用导致删除成本远超建造成本。

### 项目快照段重新决定（覆盖原 plan §4）

之前的 §4 快照 5 栏（topDirs/entrypoints/conventions/recentEdits/openTodos）**过度设计**：

- **静态知识全砍**（topDirs/entrypoints/conventions）→ 让 `CLAUDE.md` 兜。
- **`openTodos` 砍**——agent 当时纠结但已解决的问题会被固化成"待办"。
- **`recentEdits` 留，但 must_fix #4 规定带 Undo/git restore 过滤 + diff/撤销/审计，总量 ≤1KB**——且 §19 实施时必须与决议对齐。
- Phase 4 上线前，**must_fix #3 跨 key 竞态修复是硬前置**。

### 命名撞库（agent / preset 是 Wave 已有词）

`agent:profiles` 已经是 Wave 的 preset map 名；本方案**借这张表扩字段**，不另起名。新增字段 `systemprompt/projectpath/contextsnapshot` 与 profile 已有的 `cmd/args/model/modelflag` 并列。**不需要新概念名**。

---

## Context

**痛点**：你有一批 AI session 已经"驯化"——带着固定项目路径和固定处理流程，你靠"恢复 session"把它们当工具人反复用。问题是恢复会续接整段对话历史，**上下文随每次使用不断变长**，到后期单次成本和延迟都恶化。

**目标**：把这些已驯化的 session 沉淀成命名 agent。每次调用是 **fresh session**（上下文永不长），但 agent 的**预设**（项目路径 + 处理流程/系统提示 + 项目结构快照）持久化、可编辑、**可被 agent 自己在每次使用后增量更新**。本质是给 Wave 自己一套"per-agent 的 CLAUDE.md"机制——CLAUDE.md 正是 Wave 项目自身的"preset + 上下文快照"，agent 预设就是把这个能力下放到用户能定义的每一个 agent 上。

**已和用户确认的产品决策**：

1. 状态语义：fresh session + 注入预设 + 注入可增量更新的项目快照。对话历史用完即弃，永不写回；预设文本与快照各自增量演进。
2. agent 与项目路径：**一个 agent 绑定一个固定项目路径**（逼近原工具人 session）。
3. 来源：既支持从现有 session 由 AI 提取，也支持手写。
4. 入口：session 行级"设为 agent"按钮（AI 读 session 生成预设草稿）+ 独立的 Agents 浏览/编辑视图 + 每次用完按开关自更新预设。
5. 快照写入：**有条件、不无条件**——只写小骨架 JSON，绝不写文件内容、对话历史；总量 ≤4KB，限频。

---

## 关键发现（决定方案形状）

代码库里**已经存在成熟的 agent profile 系统**，本方案是"在其上扩两个字段 + 两条通路"，而不是造全新实体：

- `pkg/wconfig/settingsconfig.go:59-65` `AgentProfileConfigType{ Cmd, Args, Model, ModelFlag, CmdEnv }` + `SettingsType.AgentProfiles map[string]AgentProfileConfigType`（json `agent:profiles`）+ `AgentDefaultProfile`。**目前缺**：项目路径、系统提示、快照、auto-update、来源 session。本方案就补这些字段。
- `frontend/app/workspace/agent-launch.ts:939` `createAgentBlockDef(...)` **已经支持把 `context.cwd` 注入 fresh agent block**——"启动一个跑某 profile 的新 agent block"通路已存在，复用即可。无需新增 view type 用于启动。
- `pkg/aisessions/metastore.go:21-25` `sessionMeta{ Marked, Note, UpdatedAt }`——per-session JSON 边车，扩一个 `AgentOf` 字段最干净，和 `Marked` 同模式。
- **重要约束**：`wconfig.SetBaseConfigValue`（`settingsconfig.go:911`）对 `agent:profiles` 是**整 map 替换**而非深合并——所有"更新单个 profile"路径必须 read-modify-write 整个 map，并收口到一个 helper 防竞态。

---

## 实施方案

### Phase 1 — 后端 schema（Go 优先，再 `task generate`）

所有新字段 `omitempty`，**完全向后兼容**。

1. **`pkg/wconfig/settingsconfig.go`** — 扩 `AgentProfileConfigType`：

   ```go
   Description     string `json:"description,omitempty"`
   ProjectPath     string `json:"projectpath,omitempty"`
   SystemPrompt    string `json:"systemprompt,omitempty"`
   ContextSnapshot string `json:"contextsnapshot,omitempty"` // JSON 字符串，见 §3 schema
   AutoUpdate      bool   `json:"autoupdate,omitempty"`
   SourceSessionID string `json:"sourcesession,omitempty"`
   ```

2. **`pkg/aisessions/metastore.go`** — `sessionMeta` 加 `AgentOf string \`json:"agentOf,omitempty"\``；`Apply(summary)` 写回 `summary.AgentOf = meta.AgentOf`；新增 `SetAgentOf` 镜像 `SetMarked`。

3. **`pkg/aisessions/sqlite_index.go`** — schema 版本号 2→3；`ai_session_meta` 加列 `agent_of TEXT NOT NULL DEFAULT ''`（带"列已存在"幂等保护）；扩 `ApplyMeta`/`SetMarked`/`SetNote`/`SetNoteAndTags`/`setMeta`/`setMetaTx` 的列；新增 `func (idx *SQLiteIndex) SetAgentOf(ctx, key, agentOf string) error` 镜像 `SetMarked`，沿用"合并不覆盖未设字段"的现有模式。

4. **`pkg/aisessions/types.go:26`** — `SessionSummary` 加 `AgentOf string \`json:"agentOf,omitempty"\``。

5. **`pkg/aisessions/manager.go`** — 新增 `SetAgentOf(ctx, identifier, agentOf)` 与 `GetAgentOf(ctx, identifier)`，双写 sqlite + meta JSON，镜像 `Mark`/`Note`。

6. **`pkg/service/aisessionsservice/aisessionsservice.go`** — 新增 service method `SetAgentOf`（请求体 `{id, agentOf}`，返回 `SessionSummary`），镜像 `Mark`/`Note` handler。

7. **`task generate`** — 自动重生成 `frontend/app/store/services.ts`（含 `SetAgentOf`）和 `frontend/types/gotypes.d.ts`（含 `AgentProfileConfigType` 新字段、`SessionSummary.agentOf`）。**手改生成文件禁用**。

### Phase 2 — "设为 agent"提取流

8. **`frontend/app/view/aisessions/session-row.tsx`** — props 加 `onSetAsAgent`，在 line 207-334 的行级按钮簇中（Resume 之后）插一个"Set as Agent"按钮，沿用现有 `opacity-0 group-hover:opacity-100` hover 揭示样式。

9. **`frontend/app/view/aisessions/aisessions.tsx`** — 加 handler 打开新 modal `modalsModel.pushModal("SetAsAgentModal", { sessionId })`，仿照现有 `AISessionNoteModal` 注册。

10. **`frontend/app/modals/modalregistry.tsx`** — 注册 `SetAsAgentModal`。

11. **`frontend/app/modals/assetagentmodal.tsx`**（新文件）— 仿 `aisessionnotemodal.tsx` 形态。可编辑字段：name / description / project-path（默认 `session.projectPath`）/ system-prompt textarea / auto-update 开关（默认 on）。按钮："Draft from session with Claude" / Save / Cancel。

12. **`pkg/service/aisessionsservice/aisessionsservice_draft.go`**（新文件）— 新增 `DraftAgentFromSession(req) resp`：
    - `manager.Load(ctx, id, LoadOptions{IncludeTools:false})` 复用 `provider_claude.go` 的 LoadMessages 通路（与 `Detail` 同源，**不另起 agent**）。
    - 把消息压成 ≤8KB 紧凑 transcript（最后 N 条 user + assistant 摘要 + 可见工具调用摘要，**绝不带文件内容**）。
    - 复用后端已配置的 Claude HTTP 客户端（`wconfig.GetWatcher().GetFullConfig().Ai` 取 baseurl/token/model）调一次 `messages + system`，要求严格 JSON `{systemPrompt, description}`，`utilfn.DoMapStructure` 解析。
    - 项目路径取 `req.ProjectPath ?? detail.Summary.ProjectPath`；空则跳过快照生成。
    - 若有项目路径，调 §4 的 `buildInitialSnapshot(projectPath)`（仅 `os.ReadDir` 遍历，无文件内容）生成初版快照。
    - 返回草稿，modal 填字段供用户校对修正。

13. **保存**（modal 内）：读 `globalStore.get(atoms.fullConfigAtom)?.settings?.["agent:profiles"] ?? {}` → 克隆 → 设新 entry（含 `cmd/args/model/modelflag/env` 用 `BuiltinAgentProfiles["claude"]` 默认+ preset 字段）→ `RpcApi.SetConfigCommand(TabRpcClient, { "agent:profiles": fullMap })`（整 map 替换）。`BroadcastConfigUpdate` 触发后 `atoms.fullConfigAtom` 自动更新、新 agent 出现在 `getAgentProfileOptions`。

14. **回链**：保存成功后 `AISessionsServiceType.SetAgentOf({id: sessionKey, agentOf: name})`，写 sqlite + JSON。session row 可加一个 robot chip 标记 `session.agentOf`（与 CLAUDE.md "session.note semantics" 的 prose-stripe 装饰**互不干扰**——`AgentOf` chip 独立于 note prose 判定）。

### Phase 3 — fresh 启动 + 预设注入

15. **`frontend/app/workspace/agent-launch.ts`**：
    - 扩本地 `AgentProfileConfig` 类型加 `description?/projectpath?/systemprompt?/contextsnapshot?/autoupdate?/sourcesession?`，与生成器产物结构一致。
    - **系统提示注入方式选定为"首条 user 消息"而非 CLI flag**：repo 内 `--system-prompt`/`--append-system-prompt` 无任何现有消费点，`BuiltinAgentProfiles` 只设 `cmd/modelflag`。flag 方式需为 claude/codex/gemini/opencode 维护 per-CLI 映射表；首条消息方式四个 provider 统一生效，且与 CLAUDE.md 的"preset 即人读指令"心智一致。
    - `createAgentBlockDef` 在组装 meta 后，如 `profile.systemprompt` 或 `profile.contextsnapshot` 非空：

      ```ts
      const prelude = [profile.systemprompt?.trim(),
                       profile.contextsnapshot?.trim() ? `# Project snapshot\n${profile.contextsnapshot}` : ""]
                     .filter(Boolean).join("\n\n");
      if (prelude) blockMetaRecord["cmd:initialinput"] = prelude;
      blockMetaRecord["agent:presetname"] = profileName;       // 新增：供 §4 写回定位
      if (profile.systemprompt) blockMetaRecord["agent:autoresume"] = false; // fresh
      ```

    - **待实现期确认**：搜索 `pkg/wstore` / meta 常量确认 `cmd:initialinput`（或等价键）是 cmd controller 在会话起始读取的。若无现成"自动首条 user 消息"键，降级走 block-mount 时把 prelude 经 `frontend/app/view/term/term.tsx` 已有的 `userOutlineMessages` 通路喂入。**实现时第一件事是确认这一点**。
    - 新增 helper `createAgentBlockDefForAgent(presetName, settings)`：调 `getProfileConfig` 取 profile，`context = { cwd: profile.projectpath }`（不复用 workspace cwd），返回 `createAgentBlockDef(settings, context, presetName)` + prelude。

16. **`agent:autoresume` 对 preset 关闭**：上一步已在 `profile.systemprompt` 真时分枝设 `false`，确保对话历史不续接。

### Phase 4 — 用后自更新闭环

17. **快照 schema（精确、有上限）**——`agent:profiles.<name>.contextsnapshot` 存 JSON 字符串：

    ```json
    { "v":1, "projectPath":"/abs/path",
      "topDirs":["src","pkg","frontend/app","docs"],
      "entrypoints":["Taskfile.yml","frontend/app/app.tsx","pkg/aisessions/manager.go"],
      "conventions":["task generate 重生成 service 绑定","settings 整 map 替换"],
      "recentEdits":["pkg/wconfig/settingsconfig.go"],
      "openTodos":[] }
    ```

    Go 端写回前硬限：总长 ≤4KB；`topDirs≤12/entrypoints≤12/conventions≤16/recentEdits≤16/openTodos≤8`；每项 ≤256 字符溢出截 `…`；**绝不**含文件内容、对话历史、完整消息文本。

18. **挂载点**：`pkg/wshrpc/wshserver/wshserver.go::AgentStatusCommand`（line 87-112）是 agent 块状态上报入口。`agentstatus.Report` 返回 `changed=true` 且 `report.State` 处于 `{StateRelease (claude SessionEnd, hookinstall.go:350), StateIdle (codex Stop, :346)}` 时：
    - 通过 `wstore.DBMustGet[*waveobj.Block]` 解析 block，读其 meta 的 `agent:presetname`（Phase 3 已写）+ 最近 `agent:sessionid`。
    - 读 `wconfig.GetWatcher().GetFullConfig().Settings["agent:profiles"]`，若该 profile 不存在或 `autoupdate==false` → no-op。
    - schedule 一个写回 goroutine（per-preset 防抖，见 §19）。

19. **写回 worker** — `pkg/service/aisessionsservice/aisessionsservice_writeback.go`（新文件）+ service method `RefreshAgentSnapshot(req)` 供 UI "立即更新"按钮调用：
    - 读 preset + `manager.Load(ctx, sessionId, LoadOptions{IncludeTools:true})` 取本次调用的消息和工具调用摘要。
    - 候选 diff：`recentEdits` 取工具调用名 ∈ `{Edit,Write,MultiEdit,Bash,Read}` 中提到的路径；`conventions` 取 assistant 文中 ```` ```lang ``` ```` 语言标 + `Note:` 模式；`openTodos` 取 `TODO|FIXME|next:` 标记。
    - 与现有快照去重合并、按上限裁剪；`json.Marshal` 后若字节等同现有快照则 no-op 不写。
    - 写入：read-modify-write **整个 `agent:profiles` map**（§ 关键约束），调 `wconfig.SetBaseConfigValue`，触发 broadcast。
    - 防抖：包级 mutex + `map[presetName]time.Time`，上次写入 <30s 跳过（用户手动 "立即更新" 走旁路不避开）。

20. **`task generate`**（再次，因 phase 19 加了 `RefreshAgentSnapshot` 方法）。

### Phase 5 — Agents 浏览/编辑视图（独立 view）

21. **理由**：sessions 列表的行是不可变 transcript，agent preset 是活的、可变、被 `agent:profiles` map 持久化的状态——两个状态空间不应压进同一面。给 agents 独立 view 与 `waveconfig`/`processviewer` 各自占 BlockRegistry 一格的做法一致，复用现有 dispatcher 零额外成本。

22. **新增文件**：
    - `frontend/app/view/agents/agents.tsx` — `AgentsViewModel implements ViewModel`，仿 `frontend/app/view/waveconfig/waveconfig-model.ts`（遍历 `agent:profiles` + 编辑面板 + `RpcApi.SetConfigCommand` 持久化）。
    - `frontend/app/view/agents/agent-card.tsx` — 单 card：description / project-path（文本输入）/ system-prompt textarea / context-snapshot 只读 JSON 视图 + "Edit raw" 切换 textarea / auto-update 复选 / 折叠的 advanced（cmd/args/model/modelflag/env）。按钮 `Save` / `Launch fresh now`（调 `createAgentBlockDefForAgent(name, settings)` + `replaceBlock`，传 `{cwd: profile.projectpath}`） / `Delete` / `Update snapshot now`（调 §19 service）。
    - `frontend/app/view/agents/agent-snapshot-viewer.tsx` — 快照 JSON 只读渲染。

23. **`frontend/app/block/blockregistry.ts`**（line 44 `aisessions` 之后）— `BlockRegistry.set("agents", AgentsViewModel)`。

24. **`pkg/wconfig/defaultconfig/widgets.json`**（line 38 `defwidget@sessions` 之后）— 加 `defwidget@agents`，`blockdef.meta.view="agents"`、icon `robot-outline`、order -1.8。

25. **launcher 顺手免改**：现有 `defwidget@agent` launcher 的 profile picker 已经枚举整张 `agent:profiles`——保存的 agent 自动出现在那里；选中经 `launchAgentTarget` 调 `createAgentBlockDefForProfile` 也会触发 Phase 3 的 prelude 注入。**唯一行为差异**：launcher 路径继承 workspace cwd，agents view 的 "Launch fresh now" 显式传 `profile.projectpath`——分工清晰，launcher 给临时用、agents view 给专用 launch。

### Phase 6 — 测试（仿现有）

26. `pkg/service/aisessionsservice/aisessionsservice_test.go` — 用例 `SetAgentOf` / `DraftAgentFromSession` / `RefreshAgentSnapshot`（mock Claude 客户端）。
27. `frontend/app/view/aisessions/session-row.test.tsx` — `onSetAsAgent` 交互用例。

---

## 实施顺序清单

1. `settingsconfig.go`（§1）→ 2. `metastore.go`（§2）→ 3. `sqlite_index.go`（§3）→ 4. `types.go`（§4）→ 5. `manager.go`（§5）→ 6. `aisessionsservice.go` SetAgentOf（§6）→ 7. `task generate` → 8. `session-row.tsx` 按钮 → 9. `aisessions.tsx` handler → 10. `modalregistry.tsx` 注册 → 11. `assetagentmodal.tsx`（新）→ 12. `aisessionsservice_draft.go`（新）→ 13. modal 保存/回链逻辑 → 15. `agent-launch.ts` 扩类型+prelude+`agent:presetname`+关 autoresume → 18-19. `wshserver.go` AgentStatusCommand dispatch + `aisessionsservice_writeback.go`（新）→ 20. `task generate` → 22. `view/agents/*` 三个新文件 → 23. `blockregistry.ts` → 24. `widgets.json` → 26-27. 测试。

---

## Verification（端到端）

所有命令在 `E:\primary\projects\snorkeling-light-theme` 根目录执行。

**构建/类型**：`task build`；每次 Go RPC/type 改动后 `task generate`，diff 审 `services.ts` 与 `gotypes.d.ts`。

**带 CDP 起应用**：`npm run dev:cdp`（profile `cdp`，Vite 51742，CDP 9222）。`curl.exe http://127.0.0.1:9222/json/version` 验活，挑标题为 `Wave Terminal - T<id>` 的 page 目标。

**提取→保存**：

- `node scripts/inspect-electron-ui.mjs elements --limit 80` 确认 session 行有 "Set as Agent" 按钮。
- 用 `inspect-electron-ui.mjs click <x> <y>` 点按钮 → modal 弹出 → 点 "Draft from session with Claude" → 字段被 AI 草稿填充，`ProjectPath` 与该 session 一致。
- 填 name `fixbuild`、勾 auto-update、Save。
- 校验 `wsh getconfig agent:profiles` 含 `fixbuild` 且带 `projectpath/systemprompt/contextsnapshot/autoupdate/sourcesession`。
- 校验 `sqlite3 <wave-config>/aisessions-index-v2.sqlite "SELECT session_key,agent_of FROM ai_session_meta WHERE agent_of!=''"` 返回源 session 行。

**fresh 启动**：

- launcher 打开 Agents 视图，`fixbuild` card 出现 → "Launch fresh now"。
- `inspect-electron-ui.mjs elements` + `screenshot` 确认新 agent block 的 `cmd:cwd=fixbuild.projectpath`、block 首条 user 消息为组装的 prelude（system prompt + `# Project snapshot\n{...}`）、**无历史续接**（`agent:autoresume=false`、`agent:presetname=fixbuild`）。

**用完→写回→下次看到更新**：

- 在 fresh agent 里让它编辑一个文件（如 "Add a comment to Taskfile.yml"），跑完触发 Claude `SessionEnd` → `AgentStatusCommand` 收到 `StateRelease`。
- ~5s 内重读 `agent:profiles.fixbuild.contextsnapshot`，`recentEdits` 应含该路径；`entrypoints/topDirs` 不超 cap；总长仍 ≤4KB。
- 开第二个同 preset 的 agent block，确认 prelude **包含**更新后的快照。

**auto-update 开关**：Agents view 取消 `fixbuild.auto-update`、Save，再跑一次让 agent 改文件 → 快照不变 → 点 "Update snapshot now" → 快照更新（手动旁路不被开关阻断）。

**视觉/布局校验**：每步 `inspect-electron-ui.mjs screenshot`；`style "Set as Agent"` / `style "fixbuild"` 抓计算样式（overflow/flex/hover），与 `session-row.tsx:207-216` 风格契约一致；确认 `AgentOf` chip 不破坏 CLAUDE.md 中 pure-tag-note 的 prose-stripe 行为。

**回归**：`go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/... ./pkg/wshrpc/...` 与 `cd frontend && npm test -- session-row`。

---

## 待 vault 接通后迁移说明

CLAUDE.md 规定 user-triggered 开发细节沉淀到 `E:\File\NitaFile\Obsidians\Obsidian\My Projects\Snorkling\开发细节\<业务模块>\`，但当前环境下 `E:\File` 不可访问，故临时存于本仓库 `docs/project/agent-session-plan.md`。迁移时：

- Vault 不存在 `agent session` 概念，但该功能横跨 `Sessions 与列表`（session 行级入口、Agents 视图）和 `Agent 状态与识别`（agent preset、autoresume 关闭、写回 hook）两个模块——按 vault README 复核后定单文件还是双落。
- 迁去后，本仓库这份 `docs/project/agent-session-plan.md` 可保留作为执行式 checklist，或删除留 vault 一份。
