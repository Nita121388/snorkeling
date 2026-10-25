# 技术设计：节点批注时间线 + AI 生成

实现位置：
- 后端 `pkg/aisessions/`（表、CRUD、worker）、`pkg/service/aisessionsservice/`（RPC）
- 前端 `frontend/app/view/aisessions/`（rail、编辑器、状态）、`frontend/app/view/`（批注 Block）

---

## 1. 数据模型（SQLite schema v4）

在 `pkg/aisessions/sqlite_index.go` 的建表列表里追加，并补一个 `ensureAnnotationColumns` 做旧库 ALTER（仿 `ensureMessageThinkingColumn`）。

```sql
CREATE TABLE IF NOT EXISTS ai_session_annotations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key    TEXT    NOT NULL,
  anchor_key     TEXT    NOT NULL,                -- Message.ItemKey
  seq            INTEGER NOT NULL DEFAULT -1,     -- 漂移兜底 + 排序
  kind           TEXT    NOT NULL DEFAULT 'note', -- note|milestone|decision|question
  title          TEXT    NOT NULL DEFAULT '',
  body           TEXT    NOT NULL DEFAULT '',
  tags_json      TEXT    NOT NULL DEFAULT '[]',
  status         TEXT    NOT NULL DEFAULT 'accepted', -- draft|accepted
  source         TEXT    NOT NULL DEFAULT 'user',     -- user|ai
  user_edited    INTEGER NOT NULL DEFAULT 0,          -- 1 = 永不被 AI 覆盖
  ai_model       TEXT    NOT NULL DEFAULT '',
  anchor_hash    TEXT    NOT NULL DEFAULT '',          -- 节点文本 fnv，检测漂移
  anchor_preview TEXT    NOT NULL DEFAULT '',          -- 漂移时给用户看的原文快照
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_session ON ai_session_annotations(session_key, seq);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ann_anchor ON ai_session_annotations(session_key, anchor_key, id);
```

### 字段语义（唯一真相）

| 字段 | 取值 | 含义 |
|---|---|---|
| `status` | `draft` | AI 刚产出，未采纳。UI 虚线框，不计入角标，不参与导出 |
| | `accepted` | 已生效。手动创建的直接是 accepted |
| `source` | `user` | 人写的（手动创建，或从 AI 转正） |
| | `ai` | AI 产出。`source` 只表示**来源**，不决定能否覆盖 |
| `user_edited` | `0/1` | **是否被人改过**。1 = 任何 AI 通道不得修改/删除 |

**覆盖规则（不变量，必须单测）**

```
可被重新生成替换 := status = 'draft' OR (source = 'ai' AND user_edited = 0)
永不替换         := source = 'user' OR user_edited = 1
```

注意 `source='ai' AND user_edited=1` 的条目是「AI 起草、人改过」，必须保护。仅用 `source` 判断是错的。

### AI 幂等表（M3 预埋，M1 只写不读）

```sql
CREATE TABLE IF NOT EXISTS ai_session_annotation_ai_state (
  session_key        TEXT PRIMARY KEY,
  last_message_count INTEGER NOT NULL DEFAULT 0,
  last_max_seq       INTEGER NOT NULL DEFAULT 0,
  request_hash       TEXT NOT NULL DEFAULT '',
  model              TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT '',
  updated_at         INTEGER NOT NULL
);
```

### 锚点漂移处理

打开详情页时：
1. 按 `anchor_key` 精确匹配 message / toolCall 的 `ItemKey`。
2. 未命中 → 用 `seq` 邻近（±3）内、`role` 相同、`anchor_hash` 最接近的节点重锚定，成功后回写 `anchor_key/seq/anchor_hash`。
3. 仍失败 → 返回 `orphaned=true`（**不删库**），UI 显示黄条 + 「重新指定 / 删除」。

`anchor_hash` = 节点纯文本（`text` 或 `thinking` 或 tool `summary`）的 FNV-1a 64 位十进制串，纯函数、可单测。

---

## 2. RPC 契约

`pkg/service/aisessionsservice/aisessionsservice.go` 追加（命名延续现有风格，`_Meta` 必须有注释，注释会进前端 JSDoc）：

```go
// Annotations lists every annotation of one session, ordered by seq then id.
Annotations(req{ sessionKey, connection? }) → { annotations: []AnnotationView }

// AnnotationSave creates or updates one annotation. Saving a row that was
// AI-generated marks it user_edited=1.
AnnotationSave(req{ id?, sessionKey, anchorKey, seq?, kind?, title, body, tags[], status?, source? }) → AnnotationView

// AnnotationDelete removes one annotation permanently.
AnnotationDelete(id int) → error

// AnnotationSessions lists sessions that have at least one accepted annotation.
AnnotationSessions(req{ page?, pageSize?, tagFilters?, projectPrefixes?, query? }) → { sessions: []AnnotatedSession, total }
```

`AnnotationView`（前后端共享，`tsgen` 生成）：

```go
type AnnotationView struct {
    ID            int64    `json:"id"`
    SessionKey    string   `json:"sessionKey"`
    AnchorKey     string   `json:"anchorKey"`
    Seq           int      `json:"seq"`
    Kind          string   `json:"kind"`
    Title         string   `json:"title"`
    Body          string   `json:"body"`
    Tags          []string `json:"tags"`
    Status        string   `json:"status"`
    Source        string   `json:"source"`
    UserEdited    bool     `json:"userEdited"`
    AIModel       string   `json:"aiModel,omitempty"`
    AnchorPreview string   `json:"anchorPreview,omitempty"`
    Orphaned      bool     `json:"orphaned,omitempty"`
    CreatedAt     int64    `json:"createdAt"`
    UpdatedAt     int64    `json:"updatedAt"`
}
```

`AnnotationSessions` 的聚合 SQL（一条，不要 N+1）：

```sql
SELECT s.key, s.title, s.source, s.project_path, s.updated_at,
       COUNT(a.id) AS annotation_count,
       MAX(a.updated_at) AS last_annotation_at
FROM ai_sessions s
JOIN ai_session_annotations a
  ON a.session_key = s.key AND a.status = 'accepted'
WHERE s.missing = 0
GROUP BY s.key
ORDER BY last_annotation_at DESC
```

---

## 3. AI 生成：统一契约

### 3.1 prompt feature

`pkg/aisessions/promptregistry.go` 追加：

```go
PromptFeatureSessionAnnotations = "session-annotations"
```

`aiprompts.json` 增加对应段（`maxAnnotations` 夹取 [1, 30]，`maxBodyChars` 夹取 [40, 2000]，`maxTags` 夹取 [1, 5]），并把 `ListPromptFeatures()` / `ResolvePrompt()` / `PromptEnabled()` 的分支补上。这是 `ai-prompt-config-contract.md` 的既有扩展点，不需要新文件。

### 3.2 一个 RPC 覆盖所有 ✨

```go
// AnnotationAssist generates annotation text for one manual input point.
// It never writes to the database: the caller decides whether to keep the draft.
AnnotationAssist(req{
    SessionKey string
    Scope      string   // timeline | entry-title | entry-body | entry-tags（session-note 由 ai-gen 任务承载）
    AnchorKey  string   // required for entry-* scopes
    Draft      *AnnotationView  // current editor content, used as context
    MaxEntries int
    Model      string   // "" = user default
}) → { drafts: []AnnotationDraft, aiModel: string }
```

| scope | 输入 | 输出 |
|---|---|---|
| `timeline` | 本会话压缩后的锚点清单 | `[{anchorKey,kind,title,body,tags}]`，最多 `maxAnnotations` 条 |
| `entry-title` | 锚点节点原文（截断 4000 字）+ 当前 body | 一个 `title` |
| `entry-body` | 锚点节点原文 + 当前 title | 一个 `body` |
| `entry-tags` | title + body + 现有标签词表 | 3–5 个 tag |
| `session-note` | 会话摘要 | 一个 note。**不本任务实现**：接 `10-25-aisessions-ai-gen` 的 AutoGenerate 通道 |

### 3.3 prompt 硬约束（防幻觉）

1. 锚点只能从后端给的清单里选，模型不得凭空造 `anchorKey`；**服务端落库前二次校验清单里存在，非法条目丢弃并计入丢弃数**。
2. 强制 JSON 输出；`kind` 只允许枚举。解析失败重试 1 次（同 prompt + 低温度），仍失败返回错误，不写半成品。
3. 只产出 `draft`。采纳是用户动作。
4. 不返回需要的外部事实（模型不许在批注里断言"这个函数在 X 行"，只描述节点内容本身）。

### 3.4 异步执行

```
前端 ✨ 点击
  → AnnotationAssist（RPC 立即返回 jobId，不等结果）
  → annotationAssistQueue.enqueue(job)   // O(1) 内存 map + capacity-1 channel
  → 后台 goroutine 串行 drain（单条超时 90s，context 可取消）
  → 进度/完成经 wps 事件推送（新增 aisessions:annotationassist）
  → 前端按 jobId 把结果填进对应字段（草稿态）
```

仿 `titleautogen.go` 的 `autoTitleWorkers` 注册表：per-index-path 单例，避免每次 RPC 新建 Manager 时起一堆 worker。

**失败不自动重试**：只允许用户手动再点，避免烧钱。

---

## 4. 前端结构

### 4.1 文件划分

```
frontend/app/view/aisessions/
  annotation-model.ts          # 纯函数：覆盖规则、排序、分组、anchorHash 比较、orphan 判定
  annotation-model.test.ts
  annotation-store.ts          # 模块级缓存 + 事件订阅（仿 message-queue-store.ts）
  annotation-assist.ts         # ✨ 状态机（idle/running/error），字段级
  annotation-rail.tsx          # 左时间线（折叠/展开/dock 放大）
  annotation-card.tsx          # 悬浮卡
  annotation-editor.tsx        # 备注编辑器（四个 ✨）
  annotation-timeline-panel.tsx# 时间线列表面板 + 生成/采纳/丢弃操作条
  session-detail.tsx           # 接入 rail 与跳转（改动点）
frontend/app/view/annotation-block/   # M2：跨会话批注 Block
```

纯逻辑必须先落到 `annotation-model.ts` 并单测，组件只做渲染与事件。这与 `timeline-virtual.ts` 的既有做法一致。

### 4.2 左 rail 几何

```tsx
const RailCollapsedWidth = 16;   // 视觉 12 + padding
const RailExpandedWidth  = 36;
const RailSlotHeight     = 8;
const PillIdle   = { w: 10, h: 2 };
const PillActive = { w: 26, h: 3 };
const HoverDelayMs = 150;
const FlashMs = 1200;
```

- 刻度 = `annotation → seq` 去重后的节点，**只画有批注的节点**（PRD 决定），无批注节点不画
- 簇聚合：节点数 > 40 时按时间窗分簇，簇内 hover 仍可定位单条
- dock 放大沿用 `session-outline-rail.tsx` 的 `tickMagnification`（`(1+cos(πd/3))/2`，半径 3，140ms ease-out），**直接复用同一函数**，不要再写一套

### 4.3 跳转

```
rail 点击 → seqToIndex(seq) → virtualizer.scrollToIndex({index, align:"start"})
         → 若目标在折叠区（subagent / details）先展开
         → flash(seq)：给该行加 .ann-flash 1200ms，结束后移除
         → rail 该刻度置 active
```

虚拟化容器内不存在目标 DOM 时，`scrollToIndex` 的 `initialOffset` 兜底 + 下一帧校正（与 `10-21-aisessions-detail-virtual-scroll` 的实现一致，不要另造）。

### 4.4 rail 与消息流是单向耦合

只做 `rail → 消息流`。不做滚动反向高亮 rail，避免虚拟滚动双向抖动。唯一允许的反向信号是「视口上方还有 N 条批注」的计数提示。

### 4.5 ✨ 字段级规范（统一实现，只写一次）

组件 `<AIAssistButton field onResult>`：

- 只填当前字段，**不覆盖其他已填字段**，不自动保存
- 结果带 `AI · 未保存` 角标 + 「撤销 AI 结果」
- 运行中：按钮 `⟳` + 字段只读骨架；再点 = `context.Cancel`
- 错误：字段下方内联一行，不清空用户已有内容
- 未配置模型：置灰 + tooltip「未配置 AI 模型，前往设置」

---

## 5. 生成 → 草稿 → 采纳 状态机

```
              [✨ 生成]
   (none) ──────────────▶ draft
                            │  ▲
                [编辑并保存] │  │ [重新生成]
                            ▼  │
                 accepted(source=user, user_edited=1)   ← 永久保护
                            
   draft ──[采纳]──▶ accepted(source=ai, user_edited=0)
                          │
                [用户编辑] ▼
                   accepted(source=ai, user_edited=1)   ← 此后不再被替换

   任意态 ──[丢弃]──▶ 删除
```

草稿**持久化到表**（不是前端内存），关掉详情页再回来还在。

### 「重新生成」确认弹层

```
重新生成会替换 5 条 AI 草稿，保留 3 条手写。
☑ 保留我编辑过的条目（3）
☐ 同时清除未采纳的草稿（2）
                                  [取消]  [确认重新生成]
```

替换在**单个事务**内完成：`DELETE ... WHERE 可替换` + `INSERT ...`，任一失败整体回滚。

---

## 6. 导出（M2，子任务 `annotation-export`）

渲染器写成**纯函数** `annotation_export.go`（无 IO，可单测），worker 只负责读库 → 调它 → 流式写盘。

```markdown
---
title: "会话标题"
session_id: "..."
session_key: "..."
project: "snorkeling"
cwd: "E:/code/snorkeling"
model: "claude-sonnet-4.5"
source: "pi"
started: "2026-10-25T10:12:00Z"
annotation_count: 7
exported_at: "2026-10-25T21:40:00Z"
tags:
  - ai-session
  - annotation/架构
---

# 会话标题

> 📝 会话笔记（ai_session_meta.note）

## 👤 用户 · 21:12
<a id="m-12"></a>
正文（正文内标题降级 2 级）

> [!annotation] 时间线 rail 的层级设计
> 只画有批注的节点，避免与消息密度耦合。
> `#annotation/UI` `#annotation/时间线`
```

- 只有 `status='accepted'` 的条目进导出；草稿永不导出
- 文末追加 `## 🧭 批注时间线`：`- [[#m-12|21:12 · 标题]]`
- 工具输出走 `<details>` + `maxToolOutputChars` 截断
- 文件名 `{project}/{date}_{time}_{title}.md`，各段做 Windows 保留名 / 尾部点空格清洗（`sanitizeSegment` 逻辑从参考项目移植并单测）

### 不阻塞主程序

- 渲染/写盘在 worker（`annotation_export_jobs.go` + goroutine 池，并发 1–2）
- **逐条 message 追加写 `bufio.Writer`**，不做全量 `strings.Join`（60MB 会话是已知踩坑）
- 进度经 wps 事件推送到前端队列面板；取消走 `context`
- 主界面只做两件事：显示进度、完成后给打开路径

---

## 7. 迁移与兼容

| 风险 | 处理 |
|---|---|
| 旧库无新表 | `CREATE TABLE IF NOT EXISTS` + `ensureAnnotationColumns` ALTER |
| schema version bump | 有 `ai_schema_meta.schema_version`，按现有迁移序列 +1 |
| 旧前端读新后端 | 新增 RPC 全是加法，无破坏性变更 |
| 会话被重新扫描导致 `entryId` 变（provider 升级） | `anchor_hash` + seq 兜底 + orphan 标记，**绝不静默删库** |
| 批注写并发 | 走既有 index 写队列串行化；批量落库单事务、每 50 条一批 |
| 与未提交的 `markdown.tsx` 改动冲突 | 编辑器正文用现有 `wysiwyg-editor.tsx`，不改 markdown 渲染核心 |

---

## 8. 测试策略

| 层 | 内容 |
|---|---|
| Go 单测 | 覆盖规则矩阵（status × source × user_edited 全组合）、anchorHash、漂移重锚定、聚合 SQL、JSON 解析与非法锚点丢弃、导出渲染快照 |
| TS 单测 | `annotation-model.ts` 全函数、簇聚合、`AIAssistButton` 状态机、rail 命中测试 |
| 手工验收 | 大会话（>2000 消息）下 rail 不卡、跳转准确、AI 生成可取消、导出 60MB 会话时 UI 可交互 |

**覆盖规则的组合测试必须穷举 8 种组合**，这是本任务最容易写错、且写错会静默丢用户数据的点。
