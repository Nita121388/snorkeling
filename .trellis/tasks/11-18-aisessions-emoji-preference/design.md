# 技术设计：AISessions emoji 后端化 + AI 推荐

> 来源：2026-11-19 阶段一分析（只读）。设计总账见 `design/plans/session-kernel-design-20261118.md` §5；
> 本文件是**实现层设计**：现状解剖、数据模型、接口、算法、Picker、风险。需求与验收口径见 `prd.md`。
> 开工入口见 `implement.md`。

## 0. 一句话结论

emoji 从「纯前端 localStorage 字符串」升级为「`ai_session_props.emoji`（带 source）+ `ai_emoji_prefs` 偏好 + 五信号推荐 + 7 天缓存」，
读取接口对前端**保持不变**（`getSessionEmojiSnapshot()`），写入面按「UI=user / agent=ai」双通道拆分，`source=user` 在任何通道都不被覆盖。

---

## 1. 现状解剖

### 1.1 三层解析链（`frontend/app/view/term/agent-logo.tsx:113` `getAgentIcon`）

```
L2 session  → localStorage "snorkeling:agent-session-emojis"（session-persona-store.ts，按 sessionId 键）
L0 block(旧) → block meta "agent:emoji"（legacy，AgentEmojiMetaKey，兼容读取保留）
L1 provider → localStorage "snorkeling:agent-personas"（persona-store.ts，按 provider 键）
兜底        → 品牌 logo（ClaudeLogo / PiLogo / …）
```

- store 形态：plain external store + `useSyncExternalStore`（稳定 snapshot + `storage` 事件跨窗口同步）。
- 消费面（全部经 `getSessionEmojiSnapshot()` 单一入口）：`agent-logo.tsx`、`inlinetab-dropdown.tsx`、`tab-info-card.tsx`、`agent-hover-card.tsx`、`session-overview.tsx`、`aisessions/session-row.tsx`、`term-model.ts#viewIcon`。
- **设计要义：只有这一个入口需要换成后端读穿，其余消费面零改动。**
- 校验：`normalizeAgentEmoji()`（单 grapheme / ZWJ 复合合法 / 必须 pictographic 渲染）。**只有 TS 版，Go 无对应物**（`rivo/uniseg` 已在依赖缓存可用）。

### 1.2 写路径（`agent-emoji-picker.tsx#applyEmoji`）

| 范围 | 落点 |
|---|---|
| session | `setSessionEmoji()` → localStorage |
| block | `RpcApi.SetMetaCommand`（块 meta `agent:emoji`） |
| provider | `setAgentPersona()` → localStorage（L1，**本方案永不改**，R10） |

scope 归并逻辑在 `frontend/app/agent-persona/persona-scope.ts`（无从 session id 时坍缩到 block，不静默写 provider）。

### 1.3 后端已有能力

| 能力 | 位置 | 状态 |
|---|---|---|
| `ai_session_props` 表（PK `session_key,prop_key`；`source`/`prop_type`/`prop_name`/`prop_order`） | `pkg/aisessions/sqlite_index.go:188`，索引 `:199` | ✅ 可直接用；`emoji` 不在 reserved keys |
| 属性写（用户面）`SetProps`（merge、source 缺省 user） | `AISessionsService.SetProps` → `Manager.SetProps`（`pkg/aisessions/manager.go:986`） | ✅ |
| 属性写（agent 面）`wsh agent card set --prop` | `agentcontrol.SetAgentCard` → `agentdata.ApplyPatch`（op `session_prop.update`，`pkg/agentdata/patch.go:703`）→ `Manager.ApplyAIProperties` | ✅ 有 audit + 备份 + expectedHash + `source=user` 跳过；❗ 但 **source 恒为 ai**、**无 if-absent** |
| 单会话 props 读 | `ApplyMeta` 已挂 `SessionSummary.Props`（`sqlite_index.go:816/841`） | ✅ |
| 批量 props 读 | `batchMetaMaps`（`sqlite_index.go:~870`）只批量取 marked/note/title/tags | ❗ **不取 props** → 列表页拿不到后端 emoji |
| `wsh session` 子命令 | `cmd/wsh/cmd/wshcmd-session.go`：live/get/list/for-block/info/users/turns/turn/annotate | ❗ 无 `emoji` |
| MCP 工具 | `pkg/agentmcp/tools.go`（18 个，含 `snorkeling_agent_card_get/set`、`snorkeling_session_*`） | ❗ 无 emoji |
| 推荐信号数据源 | `ai_session_tags`；`ai_session_annotations`（kind/title/body/tags_json/status/source）；`props.hero`（`deriveHeroProps`） | ✅ 都在库，一次查表 |
| 偏好 / 推荐 / 缓存 | — | ❗ 全新 |

### 1.4 缺口 → 本设计对应章节

| §5 要求 | 缺口 | 落点 |
|---|---|---|
| 存储后端化（带 source） | 无 prop 约定、无 Go 校验、列表读不到 | §2.1、§3.3 |
| get/set（`--if-absent`，user 槽拒绝覆盖） | 无命令、无 if-absent、source 恒 ai | §3.1、§3.2 |
| 推荐接口（五信号、top5、理由） | 无 | §4 |
| Picker 改造（推荐区、AI 标注） | 无 | §5 |
| 存量迁移（一律 source=user） | 无 | §2.4 |

---

## 2. 数据模型

### 2.1 `ai_session_props` 的 emoji 约定

| 项 | 约定 |
|---|---|
| `prop_key` | `emoji`（非 reserved；不新增属性类型，`prop_type` 用 `text`，避免碰属性类型/选项机制） |
| `value_json` | 单个 emoji 字符串（JSON string）；写入前过 **Go 版 `NormalizeEmoji`**（uniseg 实现，与 TS `normalizeAgentEmoji` 共用测试向量） |
| `source` | `user`（UI / 迁移）/ `ai`（hero / card set）。emoji 不用 `system` |
| UI 展示 | `property-model.ts` 把 `emoji` 虚拟映射为内置属性：**不出现在自定义属性列表**（Picker 是唯一编辑入口）；`propertygenerate` 的 AI 建议跳过 `emoji` key |

> 为什么不用新表：`ai_session_props` 天生带 source / updated_at / merge 语义 / patch 管线 / audit / 备份；
> 独立 `ai_session_emoji` 表会把「属性」和「属性」拆成两套读写路径，且 upsert 冲突语义要重写一遍。

### 2.2 `ai_emoji_prefs`（新）

```sql
CREATE TABLE IF NOT EXISTS ai_emoji_prefs (
    dim        TEXT NOT NULL,            -- 'project' | 'persona' | 'global'
    dim_key    TEXT NOT NULL,            -- project=规范化项目绝对路径; persona=hero id; global=''
    emoji      TEXT NOT NULL,
    count      INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,         -- UnixMilli
    PRIMARY KEY (dim, dim_key, emoji)
);
CREATE INDEX IF NOT EXISTS idx_emoji_prefs_dim ON ai_emoji_prefs(dim, dim_key, count DESC);
```

- **形成**：一次 Picker 手选（session 范围）= 最多 3 条 `INSERT … ON CONFLICT DO UPDATE SET count=count+1, updated_at=now`：
  `global` +1；`project` +1（`summary.projectPath` 规范化：`filepath.Clean` + 正斜杠，Windows 大小写归一小写）；`persona` +1（`props.hero` 非空才记）。
- **清空 = 负信号**（PRD R3）：对当前值 emoji 的三条 dim 记录 `count = max(count-1, 0)`，不删记录。
- **只增不删**：项目搬家导致 dim_key 变化时旧记录自然老化。
- 写入入口收在 `AISessionsService.RecordEmojiPick`（UI 唯一入口）：同一事务里 props(user)+prefs+缓存版本号 +1。

### 2.3 推荐缓存（新）

```sql
CREATE TABLE IF NOT EXISTS ai_emoji_recommend_cache (
    session_key  TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    pref_version INTEGER NOT NULL,   -- 计算时的偏好全局版本
    computed_at  INTEGER NOT NULL
);
```

- 偏好全局版本：复用 `ai_schema_meta` 或专用 `ai_kv(key='emoji_pref_version', int)`，每次 `RecordEmojiPick` +1。
- 失效：TTL 7 天 / `session.updated_at > computed_at` / `pref_version` 变化 / 显式 `--refresh`。
- 「同一会话未变更不重算」由此表保证；hero 的并发 ≤2 约束在缓存命中后归零成本。

### 2.4 存量 localStorage 迁移（一次性、幂等、一律 source=user）

流程：
1. 前端启动（app init，非渲染路径）读取 `snorkeling:agent-session-emojis` 全量 map；
2. 调新 RPC `AISessionsService.MigrateSessionEmojis { map: {sessionId: emoji} }`；
3. 后端逐条：`resolveSessionForMetaWrite`（精确 id 解析，`11-18-aisessions-resolve-exact-id` 已收紧）→ `NormalizeEmoji` → 仅当该会话 emoji 槽为空时 `SetProps(source=user)` → 记 3 条偏好；
4. 返回 `{migrated, skipped:[{sessionId, reason}]}`；**失败/部分失败保留 localStorage key**，下次启动重试（幂等：if-absent 使重复迁移是 no-op；偏好只因首次成功 +1）；
5. 成功（含仅有 skipped）后前端删除 localStorage key。

多窗口：localStorage 同 profile 共享，看到 key 已删即跳过。

---

## 3. 接口设计

### 3.1 CLI（`cmd/wsh/cmd/wshcmd-session.go` 新增 `emoji` 组）

```text
wsh session emoji get       <sessionKey|sessionId|this> [--json]
wsh session emoji set       <sessionKey|sessionId|this> --emoji <e>
        [--source ai]        # CLI 是 agent 通道：只接受 ai（默认 ai）；user 只由 UI 写
        [--if-absent]        # 已有任何值（不论 source）→ 幂等跳过
        [--force]            # 显式覆盖（连 user 也覆盖）；仅供人手工兜底，hero 禁用
        [--dry-run(默认)] [--yes] [--expected-hash <h>]
wsh session emoji recommend <sessionKey|sessionId|this> [--json] [--refresh]
```

- `get` 输出 `{emoji, source, updatedAt}`；无值时 `emoji: -`（JSON `{"emoji":""}`）。
- `set` **落点**：复用 `agentcard` 全链（`AgentCardSetRequest.Props["emoji"]` → `session_prop.update`）。
  白拿 audit / sqlite 备份 / dry-run / expectedHash / `user 槽跳过`，与 `agent card set` 行为一致。
- **hash 纪律**：`--if-absent` 下 if-absent 本身就是「绝不覆盖」前置条件，允许免 `--expected-hash` 直接 `--yes`
  （playbook 命令形态即 `set --emoji … --if-absent --source ai`）；不带 `--if-absent` 时维持现状必须带 hash。
- `recommend` 输出见 §4.4。

### 3.2 MCP 对称（`pkg/agentmcp/tools.go`）

- `snorkeling_session_emoji_get(id)`
- `snorkeling_session_emoji_set(id, emoji, if_absent, source="ai")`——写类默认 dry-run，与 CLI 同一 handler
- `snorkeling_session_emoji_recommend(id, refresh)`

### 3.3 RPC / patch 落点

| 面 | 落点 | 改动 |
|---|---|---|
| 读（列表批量） | `sqlite_index.go#batchMetaMaps` 增加 `SELECT session_key, value_json, source FROM ai_session_props WHERE prop_key='emoji' AND session_key IN (?)`，挂进 `summary.Props["emoji"]` | 走既有 `idx_ai_session_props_session` |
| 读（单会话） | `ApplyMeta` 已有 | 无 |
| 写（UI） | `SetProps`（已有）+ 新 `RecordEmojiPick`（props + prefs + 版本号 + 缓存失效，单事务） | 新增 RPC |
| 写（agent） | `AgentCardPropPatch`/`PropPatch` 增加 `ifabsent bool`；`applySessionProps`/`previewSessionProps` 支持 | ⚠️ 与 T2 批次同文件 |
| data apply patch | PRD 要求 `session_emoji.update` op → **内部降级为 `session_prop.update{emoji, ifAbsent:true}`**，不新增第二套 apply 分支 | 少量 |
| 迁移 | `AISessionsService.MigrateSessionEmojis` | 新增 RPC |
| 前端 store | `session-persona-store.ts` 导出签名不变；snapshot 来源 = sessions store 的 props 映射 + localStorage 残值兜底；`setSessionEmoji` 改乐观更新 + `RecordEmojiPick`，失败回滚 | 内部重写 |

### 3.4 错误码（沿用现有 `E_NOT_FOUND` 风格，JSON 里 `error.code`）

| code | 场景 | CLI 表现 |
|---|---|---|
| `E_NOT_FOUND` | 会话解析不到 | exit 1 |
| `E_INVALID_EMOJI` | 值不过 Go grapheme 校验 | exit 1 |
| `E_CONFLICT_SOURCE_USER` | 目标槽 source=user 且无 `--force` | 默认 exit 0 + `skipped:["emoji: user-authored value"]`；`--strict` 升 exit 1 |
| `E_CONFLICT_EXISTS` | `--if-absent` 命中已有值 | 同上，`skipped:["emoji: exists (--if-absent)"]` |
| `E_INVALID_DIM` | 偏好 dim 不在 project/persona/global | exit 1 |

> 选择「跳过而非报错」的理由：hero 巡检要求幂等 + 一轮 ≤10 预算，冲突应是可解释的 no-op，不是中断。

---

## 4. 推荐算法

### 4.1 五信号取数（纯查表，不调 LLM，毫秒级）

| # | 信号 | 分 | 取数 |
|---|---|---|---|
| 1 | 项目偏好命中 | 100 | `ai_emoji_prefs WHERE dim='project' AND dim_key=<规范化 projectPath>` |
| 2 | 会话 tag 命中 | 70 | `ai_session_tags` + 内置 tag→emoji 规则表（bug/卡住→🐛、部署→🚀、验证→🧪、性能→⚡、文档→📝、设计→🎨、安全→🛡；zh/en 双语常量表） |
| 3 | 时间线内容命中 | 50 | 该会话最新 `accepted` 的 milestone/stage 注解（`ai_session_annotations`，读 title+tags_json）过同一规则表；表就绪前允许空 |
| 4 | 标题/项目名关键词 | 30 | `title` + 项目目录名过规则表 |
| 5 | 全局偏好命中 | 60 | `dim='global'` 候选 |

### 4.2 打分与排序

- 聚合：`emoji → Σ(命中信号分)`；`reasons[]` 每信号一句人话（「你在本项目选过 3 次 🛡」「标签含 bug」「当前阶段『验证』」）。
- 同分裁决：取信号层优先级更高者（1>2>3>4>5；分值只管加总，裁决按优先级序）。
- 输出 top5；全 miss 时降级为规则表兜底候选，**永不空列表、永不阻塞**。
- `autosetEligible`：**仅当 top1 分值含 1 号信号贡献**（项目层偏好命中）才为 true。persona(60)+global(60)=120 也不够格。

### 4.3 自动写资格（与 Hero 对接的唯一闸门）

```
recommend top1.autosetEligible == true
  → wsh session emoji set <id> --emoji <top1> --if-absent --source ai --yes
  → 二次 recommend 缓存命中（age>0），确认写入生效
```

纯规则命中（30/70/50）只进摘要与推荐区，永不自动写。

### 4.4 recommend 输出（JSON）

```json
{
  "session": "…", "emoji": "🛡", "source": "ai",
  "autosetEligible": true,
  "candidates": [
    {"emoji":"🛡","score":100,"signals":[1],"reasons":["你在本项目选过 3 次 🛡"]},
    {"emoji":"🐛","score":70,"signals":[2],"reasons":["标签含 bug"]}
  ],
  "cache": {"hit": true, "ageSeconds": 42, "prefVersion": 7}
}
```

---

## 5. Picker 改造（`agent-emoji-picker.tsx`）

按 §5.4 时序：

1. **同步渲染**：打开即读 store 快照（后端 props 值 + localStorage 残值兜底），当前值区不变；
2. **推荐区**：先渲染本地兜底候选，显示「生成中…」；
3. **异步补候选**：`requestIdleCallback` → `RecommendSessionEmoji`（缓存优先，≤2 并发），Picker 仍打开才增量刷新；失败静默留兜底；
4. **来源标注**：`source=ai` → 值旁「AI 设置 · 点击修改」；`source=user` → 「你设置」；
5. **一键改回**：清空或另选 → `RecordEmojiPick`（source=user，负信号/正信号），此后 hero 只读不写；
6. **三重闸防覆盖**：UI 写入恒 user；patch 管线 user 槽 skip；`--force` 仅 CLI 人工通道且 hero 纪律禁用；
7. 从推荐区选 = 与手选同路径（记偏好 + 失效该会话缓存）。

---

## 6. 与 Hero 巡检对接（另一仓 playbook §六）

| playbook 要求 | 本方案支撑 |
|---|---|
| `wsh session emoji recommend <key>` 缓存优先 | §3.1 + §2.3 |
| 命中偏好才 `set --if-absent --source ai` | `autosetEligible`（仅项目层偏好）+ if-absent 幂等 |
| 推荐只进摘要；纯规则命中不自动写 | 输出 `autosetEligible` 区分 |
| 一轮 ≤10 | hero 侧预算纪律不变 |
| R10：user 永不覆盖、L1 provider 永不改 | 本方案不触碰 L1（persona-store / block meta 均不动） |

文档同步：`wsh session --help`、MCP 工具清单（`pkg/agentguide/agentguide.go` 若有）、hero playbook 命令核对。

---

## 7. 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| T2 批次并发改 `wshcmd-agent-card.go` / `patch.go` / `card*.go` / `wshrpctypes.go` | P2 严格排后；`loop/queue.mjs run --dry-run` 白名单校验 | — |
| TS/Go grapheme 校验漂移 | 共享测试向量 JSON，两侧同一套用例 | 后端只拒写不崩读 |
| 批量读 props 性能 | 只查 `prop_key='emoji'`，IN 批量，走既有索引 | batchMeta 加开关（列表不带，详情单拉） |
| 迁移撞上正在写的会话 | if-absent + 失败保留 key 重试 + 乐观更新回滚 | localStorage key 不删即完全回退 |
| 推荐误写 | 自动写仅项目偏好；hero ≤10 + R10 | pref/缓存表无人读时纯冗余 |
| 整体回退 | P4 之前 localStorage 一直保留 | revert store 提交即回纯 localStorage |

---

## 8. 待拍板（开工前定）

1. **persona 维度键**：严格 `props.hero`，还是无 hero 时退化记 `provider:<name>`？（建议：退化，前缀区分）
2. **`--if-absent` 免 `--expected-hash`** 是否接受？（建议：接受；否则 hero 命令要先 `card get` 取 hash）
3. **emoji prop 在属性卡片可见性**：隐藏（建议）还是只读展示。
4. **偏好是否加 `provider` 第四维**（建议不加，保持 §5.3 三维）。
