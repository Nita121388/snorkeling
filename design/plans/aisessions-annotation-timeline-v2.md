# 批注时间线 v2 — 时间桶分页 / UI 美化 / 外部 Agent 写入

> 状态：▲ 设计活跃（未实现）
> 镜像源：`frontend/app/view/aisessions/annotation-rail.tsx`、`annotation-card.tsx`、`annotation-model.ts`、`annotation-store.ts`、`timeline-virtual.ts`、`pkg/service/aisessionsservice/`、`cmd/wsh/cmd/wshcmd-agent-card.go`
> 关联：`design/plans/agent-control-surface.md`、`.trellis/tasks/10-25-aisessions-annotation-timeline/`、`.trellis/tasks/11-01-agent-control-surface/`
> 日期：2026-11-11
> 版本：v1 草案（待评审）
> 原型：`design/prototypes/aisessions/aisessions-timeline-v2/`

---

## 1. 需求拆解

用户要求（2026-11-11）：

> ai sessions 时间线优化：1. 根据时间线分页 2. UI 美化 3. 外部 agent 可以操作 snorkeling，给其会话创建时间线信息

| # | 能力 | 一句话 |
|---|---|---|
| R1 | 时间桶分页 | 批注时间线按时间分段（桶）加载与导航，不再一次性拉全量 |
| R2 | UI 美化 | 时间线整体视觉升级：日期分段头、批注卡类型图标、来源徽章、密度可读性 |
| R3 | 外部 Agent 写入 | 本地 / 外部 agent 通过 `wsh` / MCP 给自己的会话写批注，成为时间线信息 |

三项是一个闭环：**R3 让批注从「人偶尔手写几条」变成「agent 每会话自动写一组」，条目量级的上升直接倒逼 R1 的分页和 R2 的可读性**。反过来，R1/R2 不先定型，R3 写进来的数据没有好去处。

## 2. 现状盘点（全部已存在，v2 是增量）

| 层 | 文件 | 现状 |
|---|---|---|
| rail | `annotation-rail.tsx` | 44px 展开竖向圆点 rail：accepted 实心 / draft 空心环 / orphan 警告色，2px 竖轴，playhead，少节点等比铺满、多节点 28px 槽 + 内部滚动 |
| 悬浮卡 | `annotation-card.tsx` | 320px 卡：节点原文 + 全部批注（kind label + 标题 + 正文 + 标签 + 来源），Jump / Edit / pinned |
| 纯逻辑 | `annotation-model.ts` | `buildRailItems` / `clusterRailItems` / `sortAnnotations`，锚点 `ItemKey` + `seq:<n>` 合成锚 |
| store | `annotation-store.ts` | 模块级缓存 + `service.Annotations({sessionKey})` **全量拉取**，锚点漂移重锚定 |
| RPC | `pkg/service/aisessionsservice` | `Annotations / AnnotationSave / AnnotationDelete / AnnotationSessions`，`source: user|ai`，无分页参数 |
| 时间分布 | `timeline-virtual.ts` | `buildTimePositions` / `relaxTimelinePositions`（rail 圆点按真实时间戳分布） |
| ACS | `wshcmd-agent-card.go`、`wshcmd-mcp.go` | `wsh agent card get/set`：flag → RPC → `agentdata.Patch`（备份 + 审计 + 前置 hash） |

**缺口**：① `Annotations` 无游标，全量返回；② rail / 消息流没有日期分段视觉；③ `source` 只有 `user|ai`，外部 agent 写入无通道、无徽章、无审计。

## 3. D1 时间桶分页（R1）

### 3.1 数据层：Annotations 加游标（向后兼容）

```go
// Annotations lists annotations of one session, ordered by seq then id.
// cursor omitted / zero = latest page (most recent limit rows).
Annotations(req{
    sessionKey, connection?,
    cursor?: { beforeSeq int, beforeId int }, // 复合游标，避免同 seq 错乱
    limit?: int,                             // 默认 100，夹取 [20, 500]
}) → { annotations []AnnotationView, hasMore bool }
```

- 前端 `annotation-store.ts` 增量维护 `timelineWindow`：`entries + oldestCursor + hasMore`；
  首屏只拉最新一页（现状路径不变），向上「加载更早」时带 cursor 前插。
- **不做**按 `created_at` 游标：排序键已经是 `(seq, id)`，锚定 seq 与消息流一致。
- 兼容：`refreshAnnotations`（AI 重新生成后强刷）走全量重置；游标分页只服务「回看历史」。

### 3.2 桶结构（纯函数，进 `annotation-model.ts`）

```ts
type TimeBucket = {
    dateKey: string;        // "2026-11-11"（本地时区）
    label: string;          // 今天 / 昨天 / 11-08 …
    items: AnnotationRailItem[];   // 复用现有 buildRailItems 产物
    gapDaysBefore?: number; // 与前一桶间隔 >1 天时的稀疏折叠数
};
buildTimeBuckets(items, seqToTimestamp, opts): TimeBucket[]
```

- 桶 = **渲染与加载的统一单位**：rail 圆点、消息流日期分隔头、分页边界都用同一个桶。
- 稀疏折叠：桶间隔 ≥2 天时，rail 轴上画 `···` 缩记，消息流画「… 跳过 N 天 …」占位行。

### 3.3 交互规则

| 操作 | 行为 |
|---|---|
| 初始 | 只加载最近一页（≈最新 1–2 个桶），rail 圆点 = 已加载窗口内的时间分布（`buildTimePositions` 输入改为窗口内 clusters） |
| 顶部「加载更早」 | 拉上一页、前插桶；**滚动锚定**（prepend 前记录 scrollHeight，补偿 scrollTop，复用 `10-27-aisessions-virtual-row-stability` 的锚定手段，不另造） |
| 日期跳转 | 下拉列出全部桶（由 `AnnotationSessions` 元数据或首个全量 `seq` 范围提供）；跳到未加载桶 → 以该桶为锚向前向后各拉一页 |
| 「回到最新」 | 浮动 pill，重置窗口到最新页 + 滚到底部 |
| 筛选变化 | 窗口重置（filter hash 变化即视为新查询），与 `10-29-aisessions-filter-state-persist` 的筛选恢复联动：恢复筛选时直接回到最新页，不静默恢复旧窗口 |
| 外部写入到达 | 不强制跳走；视口外新批注 → rail 头部「N 条新批注 ↓」pill（见 §5.4） |

### 3.4 为什么不做显式页码

rail 是纵向时间体，用户的心智模型是「更早 / 更新」而不是「第 3 页」。显式页码唯一价值是精确回溯，已由「日期跳转」覆盖且更贴合时间线语义。**结论：懒加载 + 日期跳转 + 回到最新，无页码控件。**

## 4. D2 UI 美化（R2）

视觉语言全部复用现有 token（`theme.scss` 语义色、`11-06-monochrome-degloom` 的压深提彩），不另起一套。

### 4.1 消息流：日期分段头（新增）

- 每桶一条 sticky 分段头：`今天 · 6 条批注` + 右侧该桶批注密度微条（每格 = 一条，颜色按 kind）。
- 分段头与批注桶一一对应（§3.2），是「分页」在视觉上的显性表达。

### 4.2 rail（增量微调）

- 圆点三态不动（accepted 实心 / draft 空心环 / orphan 警告）；**新增第四信号**：含外部 agent 批注的 cluster，圆点右上角 4px agent 角标（用 `AgentIcon` 主色），不改变圆点本体。
- 桶边界：轴上桶间画 3px 刻度短横；稀疏间隔画 `···`。
- playhead、折叠态 16px、等比铺满逻辑全部不变。

### 4.3 悬浮卡（`annotation-card.tsx` 增量）

- 卡内批注列表按 kind 加**类型图标**（note 📝 / milestone 🚩 / decision ⚖ / question ?，对齐 `KindLabel`）。
- 来源徽章三档：`You`（中性）/ `AI`（accent 现有）/ `🤖 pi`（agent 名 + `AgentIcon`，见 §5.4）。
- 卡头节点身份行沿用 `aisessions-annotation-card-ux` 原型已定的「类型图标 + #seq + HH:MM」，不重复设计。

### 4.4 明确不做

- 不改 rail 宽度（44px 展开是已定稿的视觉重构结论，塞日期标签必然溢出）；
- 不做滚动反向高亮（父任务 PRD 已定单向耦合）；
- 不加动效装饰；桶前插用既有滚动锚定，不引入 FLIP。

## 5. D3 外部 Agent 写入（R3）

挂靠 **ACS**（`design/plans/agent-control-surface.md`），复用其 `wsh → RPC → agentdata.Patch` 的全部纪律（备份 / 审计 / 前置条件），不新开鉴权体系。

### 5.1 通道

| 通道 | 形态 | 状态 |
|---|---|---|
| Block 内本地 agent | `wsh annotation add/get/list`（对齐 `wsh agent card` 的 flag 风格） | 本设计 |
| App 外 agent | MCP tool `annotation_append` / `annotation_list`（挂 `wshcmd-mcp.go` 门面） | 本设计 |
| 鉴权 | Block 内 = 既有 wsh 权限；App 外 = ACS P1.5 scoped token，**token scope 必须含目标 sessionKey 白名单** | 依赖 ACS P1.5 |

### 5.2 写入契约

```
AnnotationAppend(req{
    sessionKey, connection?,
    anchorKey,               // ItemKey 或 seq:<n>；无锚点时允许 anchorKey="session"（会话级批注）
    kind: note|milestone|decision|question,
    title, body, tags[],
    agentName,               // 写入者标识，进审计
    idempotencyKey?,         // agent 生成的 uuid，重复写幂等返回原条目
}) → { annotation, deduplicated bool }
```

约束（不变量，全部要单测）：

1. **append-only**：外部通道只能新增，不能修改 / 删除任何条目（含其他 agent 写的）；改走人审后的 `AnnotationSave`。
2. `source = "agent"` 新枚举 + `author` 列存 agent 名；`user` / `ai` 语义不变，覆盖规则（`user_edited=1` 永不被覆盖）对外部通道同样生效——外部写入直接落 `accepted` 但 `author != ''`，不参与 AI 重新生成的替换集。
3. 幂等：`idempotencyKey` 命中即返回原条目 + `deduplicated=true`，不产生第二条。
4. 所有写入走 `agentdata` patch 路径 → 自动获得备份 + 审计（对齐 ACS 既有验收「无第二套写路径」）。

### 5.3 schema 增量

```sql
-- ai_session_annotations 增列（ensureAnnotationColumns 风格 ALTER）：
author           TEXT NOT NULL DEFAULT '',   -- 'pi' / 'codex' / ''(人或AI)
idempotency_key  TEXT NOT NULL DEFAULT '',   -- agent 写入幂等键
-- UNIQUE(session_key, idempotency_key) WHERE idempotency_key != ''
```

### 5.4 前端呈现

- **来源徽章**：`🤖 <agentName> · 14:32`，agent 图标复用 `AgentIcon`（`10-29-agent-avatar-text-badge`），人写无徽章、AI 保持现有 ✨ 语义。
- **新批注 pill**：视口外有外部写入时，rail 头部 / 流顶显示「N 条新批注 ↓」，点击加载其桶并跳转；不自动打断滚动位置（与 §3.3 外部写入规则一致）。
- **审计可见性**：卡片徽章 title 显示 `via wsh annotation add · <时间>`；后台来源明细进 AI Audit（`10-27-aiaudit-ui-overhaul`），不在时间线里展开。

### 5.5 落地批次

| 批 | 内容 | 依赖 |
|---|---|---|
| B1 | 时间桶纯函数 + Annotations 游标 + 加载更早 / 日期跳转 / 回到最新 + 日期分段头 + 卡内类型图标 | 无（纯前端 + 一个 RPC 参数） |
| B2 | `AnnotationAppend` RPC + schema 增列 + `wsh annotation add` + 前端 agent 徽章 / 新批注 pill | B1 |
| B3 | MCP tool + scoped token session 白名单 + Audit 接入 | ACS P1.5 |

## 6. 验收标准

- [ ] 500+ 批注的会话：打开详情只拉最新一页；「加载更早」前插桶且滚动位置不跳（无视觉跳动）
- [ ] 日期跳转直达任意桶；「回到最新」一键回底
- [ ] 桶间隔 ≥2 天显示稀疏折叠，不画空桶
- [ ] 筛选变化后窗口重置，不残留旧游标
- [ ] `wsh annotation add` 写入后 3s 内 rail 出现圆点 + agent 角标，卡内显示 `🤖 <name>` 徽章；重复同 `idempotencyKey` 不产生第二条
- [ ] 外部写入发生在视口外时只出「N 条新批注」pill，不劫持滚动
- [ ] 外部通道对已存在批目的任何修改 / 删除请求被 RPC 拒绝（有单测）
- [ ] `npx vitest run frontend/app/view/aisessions` 全绿；Go 侧新增表列有迁移测试

## 7. 风险与不做的事

- **风险：外部写入量失控**（agent 每轮都写）→ B2 起带每会话写入频率上限（默认 200 条 / 会话，超限返回明确错误），不静默丢弃。
- **风险：token 白名单粒度** → 复用 ACS P1.5 的 scope 设计，若其未落地，B2 先只开 Block 内 wsh 通道（本地 agent），App 外通道等 P1.5。
- **不做**：agent 写入自动触发 AI 生成（方向反了，AI 生成通道已有）；跨会话批量写（一次一条，循环由 agent 自己做）；批注的分享 / 同步（父任务已明确不做）。
