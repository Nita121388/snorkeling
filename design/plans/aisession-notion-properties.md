# AISession / Agent 属性系统（Notion 化）设计

> 状态：▲ 设计中 · P0/P1 已落地（`feat/aisession-notion-properties`），P2/P3 待 §8 开放问题拍板
> 日期：2026-10-29
> 原型：`design/prototypes/notion-property-agent-card/`（像素级 Notion 参照）
> 开发环境：本仓库的 worktree `../snorkeling-notion-properties`（分支 `feat/aisession-notion-properties`），主工作树 `../snorkeling` 保持 `main` 干净；首次开发前在该 worktree 跑 `npm run setup`。
> 镜像源：`frontend/app/element/info-card/session-note-section.tsx`、`frontend/app/view/aisessions/session-row.tsx`、
> `frontend/app/view/term/agent-hover-card.tsx`、`frontend/app/block/session-detail-info-card.tsx`、
> `frontend/app/view/preview/plugins/md-properties/frontmatter-block.ts`、`pkg/aisessions/types.go`、
> `pkg/aisessions/metagenerate.go`、`10-24-agent-emoji-persona/design.md`、`10-25-aisessions-ai-gen/prd.md`

---

## 0. 一句话结论

把「Note + Tags 两个硬编码字段」升级为 **Notion 式「属性 schema + 属性值 map + 类型化渲染」三层**：

- **属性定义（schema）** 决定有哪些属性、什么类型、哪些由 AI 托管；
- **属性值（values）** 存在会话上，用户与后台 AI 都能写，带 `source` 与撤销；
- **Agent Card** 按 schema 顺序渲染属性行，排版/交互 1:1 对齐 Notion 页面属性区。

Note / Tags 不删除，降级为两个**内置属性**（`note` = Text，`tags` = Multi-select），保证旧入口与旧数据零迁移。

Icon 问题的结论：**emoji 与品牌 Logo 不是二选一，而是「页面图标」的分层覆盖**——用户/AI 设了 emoji 就显示 emoji，否则回退品牌 Logo；图标是 Notion 的 *page icon*，不属于属性列表。

---

## 1. 需求与现有能力盘点

### 1.1 用户诉求（原始）

> 「Note 和标签已经不能满足我的需求了。希望像 Notion 那样：用户和后台 AI 自动设置属性 / 属性类型，并在 Agent Card 上显示。目前只是设计阶段。另外 Agent 的 icon 到底显示品牌 logo 还是 emoji？」

拆成三条可设计的需求：

| # | 需求 | 关键点 |
|---|---|---|
| R1 | 任意属性 + 属性类型 | 不再局限于 note/tags；类型决定渲染与编辑方式 |
| R2 | 用户 + 后台 AI 双向写入 | 两个写者；要能区分来源、能不打架、能撤销 |
| R3 | Agent Card 展示 | 卡片空间有限，要有排序/折叠；视觉像 Notion |

### 1.2 今天的事实（代码级）

| 层 | 现状 | 与本设计的关系 |
|---|---|---|
| 数据模型 | `SessionSummary.note string` / `tags []string` / `marked bool` / `title` / `titleSource`（`pkg/aisessions/types.go:26`） | 新增 `props map` 与之并存；旧字段映射为内置属性 |
| 后端 AI | `GenerateSessionMetadata` 已生成 note+tags（`pkg/aisessions/metagenerate.go`），worker 串行 + 限流 + 至多一次 | 扩展为「按 schema 生成属性」，复用 worker/重试/事件 |
| 前端写入口 | 行内编辑器、Note 弹窗、Session Detail 头栏、`SessionNoteSection`（悬浮卡/信息卡）共 4 处，各自维护 draft | 属性系统统一为单一编辑器，减少 4 份漂移 |
| 属性基础设施 | `inferPropertyType()`（Obsidian 对齐，text/number/boolean/date/datetime/tag/tags/list/link/json）已存在（`frontmatter-block.ts:137`） | 直接复用类型推断，不另造轮子 |
| 属性编辑器设计 | `property-editor-wolai-style.md` / `property-editor-markdown-first.md` 已有 Wolai 实测交互 + Obsidian 语义 | 本设计复用其浮层规格，但改为 Notion 的视觉语言 |
| Agent 图标 | 品牌 Logo registry + `10-24-agent-emoji-persona` 的 emoji 两级作用域（block pololicy → provider → logo） | icon 作为 page icon 接入，不做成属性 |
| 卡片面 | `SessionNoteSection` 被 `AgentHoverCard` 与 `SessionDetailInfoCard` 共用；`Agent ID Card` 原型已含 Note/Tags/Sessions 方块 | 把 Note/Tags 区替换为通用属性列表 |

**结论**：不是从零造属性系统，而是把已有的「Obsidian 类型推断 + Wolai 浮层 + AI metadata worker + Agent icon registry」收口成一套 Notion 式属性层。

---

## 2. Notion 属性系统拆解（像素级参照）

> 本节是原型的依据。原型 `design/prototypes/notion-property-agent-card/` 逐条实现这些规格。

### 2.1 页面图标 ≠ 属性

Notion 页面的结构是：

```
[page icon]        ← emoji / 图片，独立于属性
Title              ← 40px 粗体
──────────────────
Status        In progress      ┐
Assignee      @Nita            │  属性行（name + value）
Date          Oct 29, 2026     │
Tags          #design #ai      ┘
+ Add a property
──────────────────
正文…
```

- **page icon** 是身份/情绪的视觉锚点，可以随时换 emoji 或上传图；
- **properties** 是结构化字段，一行一个 key→value；
- 两者在数据与交互上完全解耦。

→ 直接回答 icon 问题：Agent 的 logo/emoji 属于 page icon 层，不进属性列表。见 §6。

### 2.2 属性类型全表（Notion 2025）

| 分组 | 类型 | 说明 | 本设计 |
|---|---|---|---|
| Basic | Text | 单行/多行文本 | ✅ v1 |
| | Number | 数字，可格式化 | ✅ v1 |
| | Select | 单选，彩色选项 | ✅ v1 |
| | Multi-select | 多选，彩色 chip | ✅ v1 |
| | Status | 带分组（To-do / In progress / Complete）的 select | ✅ v1 |
| | Date | 日期 / 日期时间 / 范围 | ✅ v1 |
| | Person | 人员 | ✅ v1（映射 owner/agent） |
| | Files & media | 文件 | ⏸ 延后 |
| | Checkbox | 勾选 | ✅ v1 |
| | URL | 链接 | ✅ v1 |
| | Email / Phone | 联系 | ⏸ 延后 |
| Advanced | Formula | 公式（只读派生） | ✅ v1（只读派生：消息数/耗时/费用） |
| | Relation | 关联另一条记录 | ✅ v1（父/子会话、相关会话） |
| | Rollup | 关系聚合 | ⏸ 延后 |
| Database | ID / Created time / Created by / Last edited time / Last edited by / Button | 系统属性 | 🔸 部分：Created/Updated 只读系统属性 |

**取舍原则**：v1 只做「会话天然拥有 + 卡片上真正有用」的类型；Rollup/Files/Button 需要额外的 schema 计算与存储，明确不做。

### 2.3 交互规格（实测/对齐 Notion）

| 交互 | 规格 |
|---|---|
| 属性行 | 高 32px；`name` 列固定宽（原型 168px）+ `value` 列 1fr；hover 时左侧页边出现 `⋮⋮` 拖拽手柄 |
| 空值 | 灰色占位 `Empty`（#9b9b9b），点击即进入编辑 |
| 点值 | 打开对应类型的浮层编辑器；无模态遮罩，点外关闭，Esc 关闭 |
| 属性菜单 | 点 `⋮⋮` → 菜单：Rename / Change type / Duplicate / Delete；Change type 打开类型选择器 |
| + Add a property | 行尾灰色 `+ Add a property`；点开 320px 类型选择浮层（Search + 分组 + 图标 + 行高 30px） |
| Select / Multi-select | 浮层：顶部搜索输入 + 已选 chip + 选项列表（彩色 pill）；输入不匹配时出现 `Create "xxx"` |
| Date | 浮层：月历（‹ Month Year ›）+ 星期表头 + 7×6 日格 + Today/Tomorrow/Next week 快捷 + 时间开关 |
| Checkbox | 16px 方形，点击切换；无浮层 |
| Number / Text | 原地 inline 编辑，Enter 提交、Esc 取消 |
| 系统属性 | 只读，hover 显示来源/计算说明 |
| 颜色 | 12 色系；chip = 浅色底 + 深色字（见 §2.4） |

### 2.4 视觉 token（原型取色）

| Token | 值 |
|---|---|
| 正文 | `#37352f` |
| 次要文字 | `#787774` |
| 占位/空值 | `#9b9b9b` |
| 页面背景 | `#ffffff` |
| 侧栏背景 | `#f7f7f5` |
| hover 底 | `rgba(55,53,47,0.06)` |
| 分隔线 | `rgba(55,53,47,0.09)` |
| 链接/选中 | `#2383e2` |
| 字体 | `ui-sans-serif, -apple-system, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif` |
| 标题 | 40px / 700 / 1.2 |
| 属性行 | 14px / 行高 20px / 行高 32px |
| chip | 高 20px、圆角 3px、padding 0 6px、字号 12px |
| 浮层 | 宽 320px、圆角 8px、`0 0 0 1px rgba(15,15,15,.05), 0 3px 6px rgba(15,15,15,.1), 0 9px 24px rgba(15,15,15,.2)` |

select 调色板（浅底/深字）：

| 色 | 背景 | 文字 |
|---|---|---|
| gray | `#e3e2e0` | `#32302c` |
| brown | `#eee0da` | `#603b2c` |
| orange | `#fadec9` | `#854a2e` |
| yellow | `#fdecc8` | `#6b4e11` |
| green | `#dbeddb` | `#1c3829` |
| blue | `#d3e5ef` | `#183347` |
| purple | `#e8deee` | `#412454` |
| pink | `#f5e0e9` | `#4c2337` |
| red | `#ffe2dd` | `#5d1715` |

---

## 3. 数据模型设计

### 3.1 三层结构

```
PropertySchema（有哪些属性、什么类型、谁托管）
        │
        ▼
SessionSummary.props map[key]PropertyValue（每个会话的值）
        │
        ▼
PropertyRenderer（按 type 渲染 + 编辑）
```

### 3.2 属性定义（PropertyDef）

```ts
type PropertyType =
    | "text" | "number" | "select" | "multi_select" | "status"
    | "date" | "person" | "checkbox" | "url"
    | "formula" | "relation" | "created_time" | "updated_time";

type PropertyDef = {
    key: string;                 // 稳定 id，如 "tech_stack"
    name: string;                // 显示名，如 "Tech Stack"
    type: PropertyType;
    options?: SelectOption[];    // select / multi_select / status
    order: number;               // 渲染顺序
    scope: "session" | "agent";  // 会话级 or 跨会话的 agent 级
    builtin?: boolean;           // note/tags/marked/title 等内置
    aiManaged?: boolean;         // 允许后台 AI 自动写
    aiInstruction?: string;      // 给模型的填写指令（可选）
    readOnly?: boolean;          // 系统属性 / formula
    formula?: { kind: "message_count" | "duration" | "cost" | "subagent_count" };
};

type SelectOption = { id: string; name: string; color: ColorToken };

type PropertyValue =
    | string | number | boolean
    | { type: "date"; start: number; end?: number; hasTime?: boolean }
    | string[]                         // multi_select / person / relation
    | null;

type PropertyCell = {
    value: PropertyValue;
    source: "user" | "ai" | "system";  // 写者
    updatedAt: number;
};
```

`SessionSummary` 新增（Go：`Props map[string]any`，前端 `props?: Record<string, PropertyCell>`）：

```go
type SessionSummary struct {
    // ... 现有字段保持不动
    Props map[string]PropertyCell `json:"props,omitempty"`
}
```

> 兼容策略：**不迁移旧数据**。读取时把 `note` → `props.note`（text）、`tags` → `props.tags`（multi_select）、
> `marked` → `props.starred`（checkbox）、`titleSource` → `props.title_source`（select, readonly）做一层虚拟映射；
> 写入时若目标是内置 key，仍走旧字段/旧 RPC，保证老版本与其它 surface 不炸。

### 3.3 Schema 存哪里

| 方案 | 位置 | 评价 |
|---|---|---|
| A. `wconfig` 全局 schema | `pkg/wconfig/settingsconfig.go` + `settings.json` | 跨设备/跨会话共享，适合「我的属性模板」；改动要 `task generate` 重生成类型 |
| B. 工作区级 sidecar | `.snorkeling/properties.json` | 随仓库走，适合项目级属性 |
| C. 远端会话库 | 与会话索引同库 | 适合「AI 自动长出来的属性」 |

**推荐 A + C**：用户自定义的稳定属性进 `wconfig`（`agent:propertySchema`）；AI 自动提议的新属性写入会话库的 schema 表（可提升为 wconfig）。
理由：schema 是低频写、高频读的配置；值是高频繁写的会话数据，两者生命周期不同。

### 3.4 类型推断

- 用户新建属性时显式选类型；
- AI 提议新属性时：模型给 `{key, type, value}`，**后端必须校验 type ∈ 白名单**，非法则用 `inferPropertyType(key, value)` 兜底；
- 前端 `inferPropertyType` 已有 Obsidian 对齐实现，直接复用（补一个 `select/multi_select` 的映射：已知 key 带 options → multi_select）。

---

## 4. 用户 × AI 双写模型

### 4.1 写路径

```
用户编辑 ──► setSessionProp(key, value)  ──► source="user"
后台 AI  ──► GenerateProperties RPC ──► worker ──► 写 props，source="ai"
系统派生 ──► formula / created_time ──► 读时计算，不落库
```

### 4.2 AI 生成契约

复用 `pkg/aisessions/metagenerate.go` + `titleautogen.go` 的 worker 骨架，新增：

```go
// GenerateSessionProperties 让模型按 schema 生成属性值。
type GeneratePropertiesRequest struct {
    Key        string   `json:"key"`
    Connection string   `json:"connection"`
    OnlyKeys   []string `json:"onlyKeys,omitempty"` // 只填这些；空=所有 aiManaged
    Force      bool     `json:"force,omitempty"`    // 覆盖 source=user 的值
}

type GeneratedProperty struct {
    Key   string `json:"key"`
    Type  string `json:"type,omitempty"`  // 新属性时给出
    Value any    `json:"value"`
}
```

- **Prompt 由 schema 生成**：只把 `aiManaged` 的属性（name/type/options/aiInstruction）列给模型，要求返回严格 JSON；
- **新属性**：返回未知 key → 若 `AllowNewProperties` 打开，写入 schema（`source=ai`，类型按 §3.4 校验/推断）；
- **冲突**：`source=user` 的值默认 skip；`Force=true` 才覆盖（覆盖后给 Undo）；
- **幂等/重试/限流**：完全沿用 gen-backend 的 job 表 + 2s/5s/15s 退避 + 事件广播；
- **可撤销**：AI 批量写入前捕获旧 `props` 快照，复用 `undo-toast` 的 10s Undo。

### 4.3 为什么要 `source`

- 卡片上可显示 `✨` 小标（AI 写的），用户在 Notion 里也能一眼看出「这条是 AI 填的」；
- 避免「用户改了又被后台覆盖」的经典冲突；
- 为将来的「AI 建议 → 用户接受」预留 `pending` 状态。

---

## 5. Agent Card 展示

### 5.1 卡片 = Notion 页面

```
┌─────────────────────────────────────────────┐
│  🦊  (page icon: emoji 或 provider logo)      │
│  refactor-auth-module            ✨ titleSource│
│                                             │
│  Status        In progress                  │
│  Owner         @Nita                        │
│  Date          Oct 29, 2026                 │
│  Tags          #auth #refactor              │
│  Tech Stack    #Go #React                   │
│  + 3 more properties                        │
└─────────────────────────────────────────────┘
```

### 5.2 展示规则

| 规则 | 说明 |
|---|---|
| 顺序 | `PropertyDef.order`；内置属性固定在前（Status / Owner / Date），AI 新增属性追加在后 |
| 数量 | 悬浮卡/ID Card：默认 5 行 + `+N more`（展开看全部）；Detail 信息卡：全部 |
| 空值 | 卡片上**隐藏**空值属性；Detail 页显示 `Empty`（对齐 Notion） |
| 只读 | `formula` / `created_time` / `updated_time` 灰底或斜体，不可编辑 |
| AI 来源 | AI 写入的值右侧 `✨`，hover 显示「AI generated · 10s 前」 |
| 长文本 | `text` 超过 2 行截断 + tooltip；`note` 作为长文本在卡片上单独占一整行 |
| 排序 | 卡片允许拖拽排序（复用 Notion 的 `⋮⋮` 手柄），排序写回 schema.order |

### 5.3 渲染映射（type → UI）

| type | 卡片/页面渲染 | 编辑器 |
|---|---|---|
| text | 单行/多行文本 | inline textarea |
| number | 数字（可带后缀） | inline input |
| select | 彩色 pill | 搜索浮层 |
| multi_select | 彩色 pill 组 | 搜索浮层 + toggle |
| status | 彩色 pill（带分组色） | 分组浮层 |
| date | `Oct 29, 2026` / `Oct 29, 2026 14:30` | 月历浮层 |
| person | 头像 + 名字 | 成员列表 |
| checkbox | 方形勾选框 | 点击切换 |
| url | 蓝色下划线链接 | inline input |
| formula | 只读值 + `ƒ` 图标 | 无 |
| relation | 关联 chip（父/子会话） | 会话搜索 |
| created/updated | 只读时间 | 无 |

---

## 6. Icon 决策：品牌 Logo 还是 emoji？

### 6.1 结论

**分层覆盖，不是二选一。**

```
page icon 解析优先级：
  L2  block meta "agent:emoji"        （仅此 block）
  L1  provider persona emoji          （所有该 provider 的会话）
  L3  provider 品牌 Logo              （默认）
```

这正是 `10-24-agent-emoji-persona` 已定的 registry 优先级（`getAgentIcon()`），本设计**不新增机制**，只把它接入 Agent Card 的 page icon 位。

### 6.2 为什么

| 方案 | 优点 | 缺点 |
|---|---|---|
| 只用品牌 Logo | 识别度高、零配置、跨平台一致 | 冷、无个性；同一 provider 多会话全一样 |
| 只用 emoji | 有温度、易区分、用户爱用 | 失去品牌识别；emoji 渲染跨平台不一致 |
| **分层（推荐）** | 默认有品牌识别，用户想个性化就覆盖；与 Notion page icon 心智一致 | 需要 registry（已存在） |

### 6.3 在属性系统里的位置

- page icon **不是属性**（不占属性行、不参与 schema）；
- 如果确实希望「可配置人格」进属性列表，可加一个只读/选择型 `persona` 属性，但默认不加——避免属性面板被非结构化内容污染；
- 卡片折叠态：page icon 可叠加状态环（沿用 `agent-id-card` 的 status ring），emoji 在环内居中显示。

---

## 7. 分期与迁移

| 阶段 | 内容 | 交付 |
|---|---|---|
| P0 只读展示 | `props` 虚拟映射 + 卡片属性行渲染（不改写） | 无数据迁移，纯前端 |
| P1 内置属性编辑 | note/tags/marked 统一进属性编辑器（单编辑器） | 替换 4 处分散入口 |
| P2 AI 属性 | `GenerateProperties` + 新属性提议 + `source=ai` + Undo | 复用 gen-backend |
| P3 自定义 schema | wconfig schema + 新建/改名/换类型/排序/删除 | 属性模板 |

**迁移原则**：旧字段永远可用；`props` 是叠加层，不是替换层。任何阶段回滚都不丢用户数据。

---

## 8. 风险与开放问题

| 风险 | 影响 | 对策 |
|---|---|---|
| schema 膨胀 | AI 乱造属性 → 属性面板爆炸 | 新属性默认进「建议区」，用户确认后升为正式属性；设上限 |
| AI 覆盖用户值 | 数据丢失 | `source=user` 默认 skip + Force 才覆盖 + Undo |
| 类型漂移 | 同 key 这次 text 下次 number | schema 一旦定型，AI 不能改类型；只能新增 |
| 卡片空间 | 属性太多 | 默认 5 行 + `+N more`；卡片内可拖拽排序 |
| 跨 surface 漂移 | 4 处编辑器不一致 | 收敛为单一 `PropertyList` 组件 + 单一 store |
| emoji 渲染 | Windows 黑白 | 沿用 persona 的字体链与单 grapheme 校验 |
| noversion migration | 旧客户端读 `props` | 旧字段仍写；`props` 只在读时合并 |

**开放问题（需要产品决策）**：

1. schema 是「全局模板」还是「每项目一套」？（推荐：全局默认 + 项目覆盖）
2. AI 新属性是否自动生效，还是先进入「Suggested」区等确认？（推荐：先进 Suggested）
3. `person` 类型在我们的语境里是谁？（owner = 用户 / agent = provider）——需要先定义「members」概念。
4. 是否允许 formula 用户自定义表达式？（推荐 v1 只做内置派生，不做表达式编辑器）

---

## 9. 验收（设计层）

- [ ] 原型中可完成：新建属性（选类型）→ 填值 → 改类型 → 删除，交互与 Notion 一致。
- [ ] Select / Multi-select / Date / Checkbox / Number / Text / URL 编辑器均可真实操作。
- [ ] 「AI 自动填充」按钮能演示：AI 写值 + AI 提议新属性 + `✨` 来源标记 + Undo。
- [ ] page icon 可在「品牌 Logo / emoji」之间切换，且与属性列表解耦。
- [ ] 窄卡形态（Agent Card）展示前 5 条 + `+N more`。
- [ ] 设计文档与原型 README 互相引用。

---

## 10. 参考

- 原型：`design/prototypes/notion-property-agent-card/`
- 既有属性设计：`design/plans/property-editor-wolai-style.md`、`property-editor-markdown-first.md`、`obsidian-properties-plugin.md`
- Agent 人格化：`.trellis/tasks/10-24-agent-emoji-persona/design.md`
- AI 生成：`.trellis/tasks/10-25-aisessions-ai-gen/prd.md`
- 图标 registry：`frontend/app/view/term/agent-logo.tsx`
- 类型推断：`frontend/app/view/preview/plugins/md-properties/frontmatter-block.ts:137`
