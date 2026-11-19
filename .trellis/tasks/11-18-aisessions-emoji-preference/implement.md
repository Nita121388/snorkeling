# 执行计划：AISessions emoji 后端化 + AI 推荐

> 状态：**planning（未启动实现）**。方案见 `design.md`，需求见 `prd.md`。
> 晚上开工时：① 先定 `design.md` §8 四个待拍板 ② 按批次建 loop 工作项（每晚一包，白名单见下）③ `task.py start` 后按批次推进。

## 0. 开工前置（取件前必做）

- [ ] 拍板 `design.md` §8 的 4 项（persona 维度键 / if-absent 免 hash / emoji prop 可见性 / 是否加 provider 维）
- [ ] 确认 T2「属性新增选项」批次已落库：`git status` 里 `wshcmd-agent-card.go` / `pkg/agentdata/patch*.go` / `pkg/agentcontrol/card*.go` / `pkg/wshrpc/wshrpctypes.go` 干净
- [ ] 按批次建 loop 工作项（`bug/fix-small` 或 `feature` 门），每包 `touch` 白名单：
  - P0：`pkg/aisessions/**`、`schema`（新文件为主）
  - P1：`pkg/aisessions/sqlite_index.go`、`frontend/app/agent-persona/**`
  - P2：`cmd/wsh/cmd/wshcmd-session.go`、`pkg/agentmcp/tools.go`、`pkg/agentdata/**`、`pkg/agentcontrol/**`、`pkg/wshrpc/**`
  - P3：`frontend/app/view/term/agent-emoji-picker.tsx`、`frontend/app/view/aisessions/property/**`
  - P4：`pkg/service/aisessionsservice/**`、`frontend/app/agent-persona/**`、`frontend/app/app.tsx`
- [ ] `node loop/queue.mjs run --id X --dry-run` 过准入（门不清不许取件）

---

## 1. P0 后端地基（不改任何现有行为）

- [ ] Go 版 `NormalizeEmoji`（`pkg/aisessions/` 新文件，uniseg）：单 grapheme / ZWJ 复合合法 / pictographic 判定
- [ ] 两表建表 + 老库幂等迁移：`ai_emoji_prefs`、`ai_emoji_recommend_cache`（`sqlite_index.go` 建表串 + `ensure*` 兼容）
- [ ] 偏好 UPSERT / 负信号 API（`BumpEmojiPref(dim, dimKey, emoji, delta)`）
- [ ] 推荐器纯函数包：五信号打分 + 规则表（tag/title 双语常量）+ top5 + `autosetEligible`
- [ ] Go/TS 共享 grapheme 测试向量 JSON（`fixtures/emoji-grapheme-cases.json`）

**验收（命令 → 期望）**
- `go test ./pkg/aisessions/... -run Emoji` 全绿
- 老库启动后 `sqlite3 <index.db> ".tables"` 含 `ai_emoji_prefs`、`ai_emoji_recommend_cache`
- 打分表单测：单命中 / 多信号加总 / 同分裁决 / 空库兜底 / `autosetEligible` 仅 1 号信号

**回滚点 1**：纯新增文件 + 建表，无调用方 → revert 即无痕。

## 2. P1 读路径（后端 props 成为 emoji 真源，前端无感）

- [ ] `batchMetaMaps` 批量加载 `prop_key='emoji'` 并挂 `summary.Props`
- [ ] `session-persona-store.ts` 内部改造：快照 = 后端 props 映射 ∪ localStorage 残值；导出签名不变
- [ ] `setSessionEmoji` 仍先打 localStorage（P4 前保留），读优先级改为「后端 > 本地」
- [ ] 至少补一个 store 单测：后端值优先 / 本地残值兜底 / snapshot 引用稳定

**验收**
- 手写一条 `ai_session_props(emoji, source=user)` → 重启 app → 该 session 九面 emoji 均显示该值
- `pnpm vitest run frontend/app/agent-persona` 全绿
- `node scripts/verify/index.mjs` 现有 area 跑一遍：emoji 显示与改动前一致（无视觉回归）

**回滚点 2**：读优先级开关（常量），关掉回到纯 localStorage。

## 3. P2 写路径（CLI / MCP / patch）

- [ ] `PropPatch` / `AgentCardPropPatch` 增 `ifabsent`；apply/preview 支持「存在即跳过」
- [ ] `data apply` 新 op `session_emoji.update`（内部降级为 `session_prop.update{emoji, ifAbsent}`）
- [ ] `wsh session emoji get/set/recommend`（`wshcmd-session.go`，reuse agentcard 全链）
- [ ] MCP 三工具（`tools.go`，与 CLI 同 handler）
- [ ] 错误码：`E_NOT_FOUND` / `E_INVALID_EMOJI` / `E_CONFLICT_SOURCE_USER` / `E_CONFLICT_EXISTS`

**验收（命令 → 期望）**
| 命令 | 期望 |
|---|---|
| `wsh session emoji get <id>` | `{emoji, source, updatedAt}` |
| `… set <id> --emoji 🐛 --dry-run` | 预览 `changed:true`，不落库 |
| `… set <id> --emoji 🐛 --if-absent --source ai --yes` | 落库 `source=ai`；`prefs.count` 不变（agent 写不记偏好） |
| 重复上一条 | `changed:false`，`skipped:["emoji: exists (--if-absent)"]`，exit 0 |
| 对 `source=user` 值 set | `skipped:["emoji: user-authored value"]`，exit 0 |
| `… set <id> --emoji "xx"` | `E_INVALID_EMOJI`，exit 1 |
| `… recommend <id> --json` | top5 + `autosetEligible` + `cache` 段 |
| 带 `--if-absent` 且无 `--expected-hash`（拍板后） | 允许；不带 if-absent 则报「需 expectedHash」 |

- `go test ./pkg/agentdata/... -run Emoji\|IfAbsent` 全绿；CLI 表格驱动测试

**回滚点 3**：命令可整体下线（无调用方在 P5 前）；patch 字段为可选，旧调用不受影响。

## 4. P3 Picker + 偏好记录

- [ ] Picker 推荐区（同步兜底 → 异步 top5 增量刷新）
- [ ] `source` 标注：「AI 设置 · 点击修改」/「你设置」+ 一键改回
- [ ] `RecordEmojiPick` RPC：props(user)+3 条偏好+版本号+缓存失效（单事务）
- [ ] `property-model.ts` 隐藏 `emoji` 自定义行；`propertygenerate` 跳过 `emoji` key
- [ ] 清空 = 负信号（`count-1` 地板 0）

**验收**
- Picker 打开无等待（无缓存路径 <5ms 出兜底 UI，可用 CDP 计时）
- 手选一次后：`wsh session emoji get` 立即 `source=user`；`ai_emoji_prefs` 三行计数 +1
- 手选两次同一 emoji → `recommend` 该 emoji 置顶且理由含次数
- `source=ai` 的值显示「AI 设置 · 点击修改」；点改选后再次 `--if-absent` 写入被拒
- `node scripts/verify/index.mjs` + 新增/复用 picker area；verify-ledger 记一行

**回滚点 4**：Picker 推荐区开关（常量 `emojiRecommendEnabled`），关掉回到纯手选。

## 5. P4 存量迁移

- [ ] `AISessionsService.MigrateSessionEmojis`（后端逐条解析 + if-absent + 记偏好）
- [ ] 前端 app init 调迁移；成功删 localStorage key；失败保留
- [ ] 多窗口幂等（key 已删即跳过）

**验收**
- 预置 localStorage 旧值（含 1 个无效 sessionId）→ 启动 → 后端 `session emoji get` 逐条 `source=user`；无效 id 进 `skipped`
- 再启动一次：不重复 +1（idempotent 断言 count 不变）、localStorage key 已删
- `frontend/app/agent-persona` 单测：迁移成功/部分失败/重试

**回滚点 5**：迁移函数加开关；localStorage key 不删即完全回退。

## 6. P5 Hero 对接与文档

- [ ] `wsh session --help` / `agent guide` / MCP 工具清单同步
- [ ] hero 仓 playbook §六 命令核对（`--source` 有默认值可省）
- [ ] `docs/project/verify-ledger.md` 一行结论；必要时 `docs/project/` 实现事实

**验收**
- 手工模拟 hero 一轮：recommend → `autosetEligible` 才 set → 二次 recommend 缓存命中（`age>0`）
- 文档中的命令逐条实测可用

---

## 7. 测试用例清单（跨阶段）

**Go**
- `NormalizeEmoji`：`🦊` 合法；`🦊🦊`/`ab`/`42`/空白/孤立 ZWJ/双 ZWJ 拒绝；`👨‍👩‍👧`、`🏳️‍🌈` 合法
- 打分：项目偏好单命中 100；tag+title 加总；同分按优先级裁决；空库返回兜底候选非空
- `autosetEligible`：仅项目偏好 true；persona+global=120 仍 false
- 偏好 UPSERT：+1 / 负信号地板 0 / dim_key 规范化（Windows 大小写、`\`→`/`）
- patch：if-absent 三态（空槽写/已有值跳过/force 覆盖）；user 槽 skip
- 迁移：幂等、部分失败、未知 sessionId

**TS**
- store：后端优先 / 本地兜底 / 快照稳定 / 乐观更新回滚
- picker：推荐区异步到达、来源徽标、改回写 user、失败降级不报错
- property-model：`emoji` 不出现在自定义属性列表

**验证台**
- `frontend/app/agent-persona` 相关 area：九面 emoji 一致、Picker 打开耗时、AI 徽标像素

---

## 8. 交付顺序与依赖

```
P0 ──> P1 ──> P2 ──> P3 ──> P4 ──> P5
              └─ 依赖 T2 批次落库（共享文件）
                     P3 信号3 软依赖 11-18-aisessions-card-phase-timeline（未就绪时信号空跑）
```

每批次独立可 ship、独立可回滚；P1 完成后即使 P2/P3 停摆，功能与今天等价（后端只是一层镜像）。
