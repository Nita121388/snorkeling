---
template: doc
outline: right
theme: paper
title: 守夜人判定内核
subtitle: 会话读取 · 写回 · 卡片时间线 · 自我进化（设计总账）
source: 核查 E:/code/snorkeling @ 0.14.6-beta.0
mirror: http://49.51.243.178:3000/nita/hero-feaa3f86 design/session-kernel-design-20261118.md @ 274f8e56（2026-11-18 16:01 推送）
---
结论：后端的分帧读取、批注存储、时长组件都已存在，缺的是三个形状——「只读用户消息的入口」「批注的外部入口」「阶段归类的规则」。本文按「现状 → 三个设计 → 总账」排列。

## 1 现状：问题在哪，能力到哪 {nest}
### 1.1 现在怎么读，卡在哪
```flow
巡检 -> [(会话jsonl)]: 只能读尾部 64KB 原始记录
[(会话jsonl)] --> 巡检: 大半是工具输出, 用户指令常在窗口外
巡检 -> {靠什么定任务?}
{靠什么定任务?} --> 巡检: 借会话标题猜, 但标题是首条用户消息, 永不更新
```

读不到用户指令就只能猜。标题永不更新，所以猜经常猜错。

### 1.2 后端已有什么、缺什么
| 能力 | 状态 | 说明 |
|---|---|---|
| 消息存入 SQLite 索引表 | ok | `ai_session_messages`，主键 `session_key+seq`，有 `role` 列 |
| 分帧读取 | ok | LoadAll：≤512KB/帧，`messageOffset` 续传 |
| 增量读取 | ok | DetailDelta：文件字节游标，只回新增 |
| 尾部快照 | warn | Detail(tail=N)：全量加载后切片，不是数据库级分页 |
| 只读最近 user 消息 | ok | **UserOutline RPC 已存在**（默认 20 条，上限 200） |
| 往回翻页（before-seq） | no | 只能拿「最近 N 条」 |
| 批注存储与 AI 草稿 | ok | schema v4：note/milestone/decision/question，draft→accepted |
| 阶段时长的数据源 | ok | `Message.timestamp` + `tool_name` 已入库 |
| 外部入口（CLI / MCP） | no | 以上全部只在 GUI 内部使用 |

关键：标 ok 的分页通道，实现都是「先全量 Load，再在内存里切」。功能够用，成本是 O(全部消息)。

### 1.3 谁改什么：两侧清单
```tree
本 Hero（守夜人）· 修改
  ~ CHARTER | 删启发式阶梯，120 秒改 5 分钟，职责扩到 emoji
  ~ playbook 判定流程 | 第一问改读 userline / turns，标题退出判据
  ~ playbook note 格式 | 状态｜做什么｜进展，≤60 字
  ~ 存量卡片 | 91be854c / 5687712a 两条长块换短块
本 Hero · 新增
  + emoji 纪律一节 | 推荐 → if-absent → source=ai，一轮 ≤10
  + R10 红线 | source=user 不覆盖，L1 全局层不改
  + patrol-log.jsonl | 每轮判定快照，供下轮 diff 与学习闭环
  + 学习闭环流程 | 反馈 → 案例 → inbox 人审 → 规则版本化
snorkeling · 修改
  ~ session emoji 存储 | localStorage → ai_session_props（带 source）
  ~ UserOutline | 全量加载后内存筛 → SQL 直查 role='user'
  ~ Picker | 打开即读缓存推荐区，标注来源，异步补候选
  ~ data apply patch | 增加 session_emoji.update 操作
snorkeling · 新增
  + session info / turns / turn | 探规模 + 按轮分页（第 2 节）
  + session annotate | 批注写入口，默认 draft（第 3 节）
  + 两级阶段段落表 + 渐进更新器（第 4 节）
  + emoji get / set / recommend | 含五信号排序（第 5 节）
  + ai_emoji_prefs 偏好表（第 5 节）
  + 后台推荐 worker | 缓存 + 事件，TTL 7 天（第 5 节）
  + MCP 工具 | 与 CLI 一一对称
```

口径：Hero 侧全是文档与流程改动（成本低）；snorkeling 侧只有两处改（emoji 存储、UserOutline），其余全是新增，不动现有 GUI 路径。

## 2 设计一：会话读取 {nest}
### 2.1 第一步总是探规模，不先读内容
读消息之前先拿一行元信息：

| 字段 | 用途 |
|---|---|
| 消息总数 / 字节大小 | 决定能直接全读、还是只能分页 |
| user 消息数 | 决定要翻几页；一条 SQL COUNT 就够 |
| 最后一条消息时间 | 判断会话是否已停，不用读正文 |
| 项目路径 / 标题 | 只作参考，不作判据 |

```flow
探规模 -> {多大?}
{多大?} -> 小会话: ≤150 条消息且 ≤2MB，一次读完
{多大?} -> 中会话: 分页读，每页 20 条 user 消息
{多大?} -> 大会话: 只读最近 20 条，永不读全量
```

这条门禁必须写在接口层：未拿到规模信息就拒绝读消息。

### 2.2 四层渐进：一轮就是一页
一轮 turn = 一条 user 消息 + 之后直到下一条 user 消息之前的全部消息。看一段真实序列：

```text title="消息序列与轮边界"
seq  role       内容
 1   user       帮我修脱敏规则塌缩
 2   assistant  思考
 3   tool       read redact-rules.json
 4   tool       grep 消费方
 5   assistant  找到 3 处调用，先建任务
 6   user       ok go，注意文件数据安全    ← 第 2 轮从这里开始
 7   tool       write 11-18-redact-keep-relative.md
 8   tool       bash sqlite3 .backup
 9   assistant  快照完成，开始改规则
10   user       先暂停，格式不对             ← 第 3 轮从这里开始
11   assistant  明白，我改格式
```

轮边界由 user 消息切出：第 1 轮 = seq 1–5，第 2 轮 = seq 6–9，第 3 轮 = seq 10–11。

四层各回一样东西，命令即层：

```text title="第 1 层 · session users --limit 20"
{ "users": [
    { "seq": 10, "at": "09:16", "text": "先暂停，格式不对…" },
    { "seq": 6,  "at": "09:12", "text": "ok go，注意文件数据安全…" },
    { "seq": 1,  "at": "09:05", "text": "帮我修脱敏规则塌缩…" } ],
  "hasMore": false, "nextBeforeSeq": 1 }
```
```text title="第 2 层 · session turns --limit 5"
{ "turns": [
    { "turn": 3, "seq": 10, "at": "09:16",
      "user": "先暂停，格式不对…", "tools": 0, "chars": 42,  "ms": 180000 },
    { "turn": 2, "seq": 6,  "at": "09:12",
      "user": "ok go，注意文件数据安全…", "tools": 2, "chars": 180, "ms": 240000 },
    { "turn": 1, "seq": 1,  "at": "09:05",
      "user": "帮我修脱敏规则塌缩…", "tools": 3, "chars": 260, "ms": 420000 } ],
  "hasMore": false, "nextBeforeSeq": 1 }
```
```text title="第 3 层 · session turn 2"
{ "turn": 2, "seq": [6, 9], "messages": [ 4 条原文，合计约 1.8KB ] }
```

第 4 层是完整会话分帧（已有 LoadAll），仅排障用，必须显式声明。

| 层 | 得到什么 | 体积 | 回答什么 |
|---|---|---|---|
| 1 user 清单 | 每条 user 消息 seq / 时间 / 前 120 字 | ~2KB | 用户都要求过什么 |
| 2 轮清单 | 每轮 user 摘要 + 工具数 + 字数 + 时长 | ~3KB | 哪一轮值得展开 |
| 3 单轮详情 | 那一轮的原文 | ≤8KB | 这一轮到底发生了什么 |
| 4 完整会话 | 全部消息 | 512KB/帧 | 排障 |

游标统一 `nextBeforeSeq`，翻页不重传已读内容。

巡检实际只走前两层：`info` 判 small → `users` 一屏 → `turns` 找到该展开的一轮，停。大会话（如 1200 条消息）只多一步：用 `nextBeforeSeq` 翻页，永不碰第 4 层。

轮是大阶段划分的参考信号之一（见 4.1），不是小阶段的时长单元。

### 2.3 调用链与预算
```sequence
巡检 -> wsh: session info <key>
wsh --> 巡检: 规模元信息，<1KB
巡检 -> wsh: session turns <key> --limit 5 --before-turn N
wsh --> 巡检: 5 轮摘要，约 3KB
巡检 -> wsh: session turn <key> --turn 12
wsh --> 巡检: 单轮全文，≤8KB
```
```limits
探规模 | 1 | 行，<1KB
user 清单一页 | 20 | 条 × 120 字
轮清单一页 | 5 | 轮
单轮详情上限 | 8 | KB
完整会话单帧 | 512 | KB
巡检单轮总读取 | 3 | KB/会话（默认只到第1层）
```

两条禁止：未探规模就读消息；一次返回全量。现状 UserOutline 正是后者（全量 Load 后内存切），第二批改成 SQL 直查。

## 3 设计二：写回与批注 {nest}
### 3.1 给会话补时间线
后端存储、锚定校验、AI 草稿、覆盖更新都已齐，缺外部入口。

```bash title="wsh session annotate · sketch"
wsh session annotate <key> --anchor tail --kind milestone \
  --title "修脱敏规则塌缩" --body "已建任务 11-18-redact-keep-relative，db 快照 ok"
# 默认 status=draft：AI 只写草稿，人在 GUI accept 后才成为正式时间线
```

分工：卡片 note 只留一句话（一眼看懂），细节沉积为会话时间线上的里程碑（可回溯、可审）。

## 4 设计三：卡片阶段时间线（两级） {nest}
阶段分两级：先划大阶段，再在大阶段里划小阶段。轮只是参考信号，不是时长单元。

### 4.1 两级模型：大阶段跨轮，小阶段在消息区间
```text title="同一会话的两级划分示例"
大阶段 │ 摸底调研 │ 方案设计 │ 实现（跨轮 4–5）│ 验证 │
轮     │ 轮1 轮2  │ 轮3      │ 轮4 │ 轮5      │ 轮6  │
小阶段 │分析│分析  │ 设计     │处理 │ 处理 验证 │ 验证 │
```

- 大阶段（里程碑级）：由「用户指令切换 + 交付物」划分：摸底 / 设计 / 实现 / 验证 / 交接。可跨多轮，一轮也可含多个。
- 小阶段（动作级）：大阶段内按消息区间归类：分析 / 处理 / 验证 / 设计 / 等待。粒度是相邻消息，与轮无关。

### 4.2 渐进式划分：先粗后细，逐步更新时间节点
```flow
新消息 -> {新 user 指令?}
{新 user 指令?} -> 开新大阶段: 粗边界先落库, ended_at 空
{新 user 指令?} -> 归入当前大阶段: 只动最后一段
当前大阶段 -> {小阶段变了?}
{小阶段变了?} -> 结束旧段开新段: 回填 ended_at
大阶段收尾 -> 冻结: 交接语或交付物出现, 时间节点不再变
```

三条纪律：
- 段落表只 append 与回填 ended_at，历史段不重算。
- 边界拿不准就不切，标为待定；下一批消息到了再定。
- 反馈信号（用户改卡）触发重判时，只重判相关段，不全量重算。

### 4.3 小阶段分类：先打原子标签，再合并成段
分两步，先给单条消息打标签，再把相邻同标签合并成段。这样不会出现「混合段」。

| 类 | 覆盖什么 | 判定信号 |
|---|---|---|
| 设计 | 方案、架构图、长文本回复 | 无工具 + 长文本；drawio/图表 |
| 分析 | 读代码、搜索 | read / grep / find / ls / glob |
| 处理 | 改代码、写文件、常规命令 | edit / write / apply_patch；普通 bash |
| 验证 | 测试、构建、运行、检查 | bash 含 test / build / lint / run |
| 部署运维 | 上传、发布、部署 | scp / upload / deploy / publish |
| 文档 | 写 md、报告（非代码） | write `*.md`；docs 目录 |
| 调研 | 网络搜索、抓取 | search / fetch / curl |
| 等待·审批 | 等用户批权限 | approval hook（agentstatus 已有此 phase） |
| 等待·回复 | 用户未回、空置 | 相邻消息间隔 >5 分钟 |
| 其他 | 兜底 | 无法归类，卡片显示灰色 |

一条命令多属性时的优先级：验证 > 处理 > 分析 > 设计。例：`bash go test ./...` 归验证，不是处理。时长口径仍是相邻消息 timestamp 差分，卡片标注「近似」。性能：纯计算 O(消息数)，零新增写入。

```flow
消息 -> {同类相邻?}
{同类相邻?} -> 合并: 同一段, 只更新 ended_at
{同类相邻?} -> 开新段: 结束旧段
开新段 -> {可归类?}
{可归类?} -> 正常归类
{可归类?} -> 其他: 卡片灰色, 不猜测
```

「其他」占比超过 20% 时，卡片给一个提示：该类需要补规则。这不只是一个兼容处理——它正好是第 6 节学习闭环的一个输入源。

### 4.4 卡片显示：先大后小
堆叠条默认只画大阶段（色块少，一眼分期）；悬浮或展开才画小阶段占比。两级数据同源，都来自段落表，不存两份。

## 5 设计四：emoji 偏好 {nest}
现状：session emoji 是纯字符串，存浏览器 localStorage，无 source，外部 agent 写不到。解析链 L2 session → L1 provider → 品牌 logo。

### 5.1 snorkeling 要提供
| 项 | 内容 |
|---|---|
| 存储后端化 | 迁到 `ai_session_props`（表已有 `source` 列），AI 才写得到 |
| get / set 接口 | `set --emoji 🐛 --source ai --if-absent`：user 槽存在时拒绝覆盖 |
| 推荐接口 | 按推荐原则排序（见 5.2）；回候选与理由；CLI + MCP |
| Picker 改造 | 打开即显示推荐区；AI 设的值标「AI 设置 · 点击修改」 |
| 存量迁移 | localStorage 旧值一律标 source=user（人手工点的） |

### 5.2 推荐原则：五个信号，可解释排序
| 优先级 | 信号 | 分值 | 理由示例 |
|---|---|---|---|
| 1 | 用户偏好·项目层命中 | 100 | 你在本项目选过 3 次 🛡 |
| 2 | 会话 Tag 命中 | 70 | 标签含 bug |
| 3 | 时间线内容命中 | 50 | 当前大阶段是「验证」，且以测试为主 |
| 4 | 标题 / 项目名关键词（规则表） | 30 | 标题含「部署」 |
| 5 | 用户偏好·全局层命中 | 60 | 你一共选过 5 次 🔍 |

裁决规则：
- 同一 emoji 多信号命中 → 分值相加，理由拼接。
- 不同 emoji 同分 → 取优先级更高的信号层。
- 输出 top 5 候选；仅 1 号信号命中（分 ≥100）才具备自动设置资格，其余只进推荐区。

Tag 与时间线来源都在库里：Tag 在 `ai_session_tags`，时间线用第 4 节的段落表，都是一次查表，零额外成本。

### 5.3 用户偏好怎么形成
| 列 | 说明 |
|---|---|
| `dim` + `dim_key` | `project`+路径、`persona`+hero id、`global`+空 |
| `emoji` | 被选的 emoji |
| `count` | 命中次数，UPSERT +1 |
| `updated_at` | 最后命中，仅展示 |

主键 (dim, dim_key, emoji)。一次手选 = 一条 UPSERT。命中偏好时理由写人话：「你在本项目选过 3 次 🛡」。

### 5.4 推荐：后台异步补充，不阻塞 Picker
```sequence
用户 -> Picker: 点击打开
Picker -> 缓存: 同步读本地缓存 (<5ms)
缓存 --> Picker: 有: 直接渲染候选
缓存 --> Picker: 无: 显示「生成中」, 先出规则表兑底候选
后台 -> 推荐: 空闲时算 top5, 单会话一次, 并发≤2
推荐 --> 缓存: 写入 + 推事件
缓存 --> Picker: Picker 仍打开才增量刷新
```

约束：Picker 打开永不等待推荐；缓存 TTL 7 天，会话更新或偏好变更即失效；推荐失败静默降级到规则表；同一会话未变更不重算。

### 5.5 本 Hero 要优化
- 职责扩展：卡片维护从 note/status/tags 扩到 emoji，但只填空槽。
- playbook 新增「emoji 纪律」：无 emoji 的活跃会话 → recommend → set --if-absent --source ai；一轮 ≤10；幂等。
- 新红线 R10：source=user 永不覆盖；L1 provider 全局层永不改。
- 自动设置只认偏好命中（1 号信号）；其余只进推荐区。

## 6 判定内核：自我进化 {nest}
这是整套设计里唯一能让准确率随时间上升的部分。前提是必须有反馈信号，否则只会老化。

### 6.1 三层判定
```tree
意图层 | 用户最近指令要什么（读 userline）
  阶段层 | 这一单元走到哪：设计 / 分析 / 处理 / 验证
    状态层 | 对外四态：原型设计中 / 开发中 / 待验证 / 卡住
```

上层给下层定范围；下层矛盾时回推修正上层。同一套判断喂两处：卡片状态 + 卡片时间线时长。

### 6.2 学习闭环
```flow
判定 -> 快照: 意图摘要 + 命中规则 + 置信度
快照 -> 反馈: 用户改卡 / 下轮演化矛盾 / 用户覆盖 note
反馈 -> 沉淀: 误判案例进 playbook, 规则进 inbox
沉淀 -> 判定: 人批准生效, 规则带版本号
```
| 反馈源 | 强度 | 成本 |
|---|---|---|
| 用户把卡片状态改回去 | 强 | 零：读卡片 diff |
| 下一轮演化与上轮判定矛盾 | 中 | 零：patrol-log diff |
| 用户覆盖 note / emoji | 中 | 零：source diff |

度量三件：准确率（人抽查）、误判类型分布、每类误判一条防复发规则。

### 6.3 不可学习项
红线与纪律永不进学习回路：R1–R10、状态白名单、draft 语义、source=user 不覆盖。无反馈的自我进化 = 自我漂移；规则变更必须过 inbox 人审，带版本号可回退。

## 7 总账与待拍板 {nest}
### 7.1 一共要写什么
```tree
读入口（后端）
  + wsh session info | 探规模：消息数 / user 数 / 字节 / 最后时间
  + wsh session turns | 轮清单分页，一页 5 轮，带 beforeTurn 游标
  + wsh session turn | 单轮详情，上限 8KB
  + wsh session userline | 兼容层：只要最近 N 条 user 消息
  + MCP 工具 | 与 CLI 对称
  ~ UserOutline 改 SQL 直查 | (session_key, role, seq) 索引，不再全量加载
写回（后端）
  + wsh session annotate | 走已有 AnnotationSave，默认 draft
  + MCP 工具 | 与 CLI 对称
卡片时间线（前后端）
  + 两级阶段模型 | 大阶段（指令/交付物切分）+ 小阶段（消息区间归类）
  + 段落表 | (session_key, level, kind, started_at, ended_at)，只 append 与回填
  + 渐进更新器 | 新消息只动最后一段，历史不重算，拿不准不切
  + 小阶段归类规则 | 十类原子标签（含部署/文档/调研/两种等待）+ 优先级裁决
  + 卡片堆叠条 | 默认大阶段，悬浮才画小阶段；复用 DurationBar
emoji 偏好（前后端）
  ~ emoji 后端化 | localStorage → ai_session_props，带 source
  + get/set 接口 | --if-absent --source ai
  + ai_emoji_prefs 偏好表 | (dim, dim_key, emoji) + count
  + record-pick 事件 | 手选 / 覆盖 / 清空都上报
  + 推荐排序器 | 五信号可解释排序：偏好/Tag/时间线/标题关键词
  + 后台异步推荐 | 缓存 + 事件推送，不阻塞 Picker，TTL 7 天
  + Picker 推荐区 | 打开即读缓存，AI 设的值标来源可一键改
巡检改造（Hero 侧）
  ~ playbook 判定流程 | 第一问改读 userline，标题退出判据
  ~ playbook note 格式 | 状态｜做什么｜进展，≤60 字
  ~ CHARTER | 删启发式阶梯，120 秒改 5 分钟
  + patrol-log.jsonl | 每轮结论落盘做 diff
存量清理
  - 2 条旧长块 | 91be854c / 5687712a 换成短块
```

### 7.2 六个待拍板
```ask
userline 读入口按什么范围做？
* 先做第 1 层：CLI + MCP + 截断，验证后再补
- 一次做全四层
```
```ask
写入入口什么时候做？
* 读入口验证后，第二批
- 和读入口同一批
```
```ask
阶段时长在哪里算？
* 后端聚合，接口只回四类总时长
- 前端算，复用已加载消息
```
```ask
emoji 推荐引擎用什么？
* 关键词规则表（零成本）
- AI 生成（更准，有 token 成本）
```
```ask
emoji 自动设置的门槛？
* 只认偏好命中；纯规则只进推荐区
- 规则命中即自动写（会猜错）
```
```ask
反馈信号第一批接哪个？
* 用户改卡 diff（最强，零成本）
- 下轮演化 diff（更早，噪声多）
```

## 8 拍板记录（2026-11-18）{nest}

> 本节由 snorkeling 侧补记，非原设计页内容。6 条均按原设计页 §7.2 的推荐项落定；
> 要改就改这一节，并同步对应 PRD 的 Notes。
> 落定人：nita（「ok go」授权按推荐值先落，可随时推翻）。

| # | 问题 | 落定 | 代价 / 前提 |
|---|---|---|---|
| Q1 | userline 读入口范围 | **四层一起做**，`turn`（第 3 层）排最后；读入口验收后即可停在此处 | 一次性面大，但四层共用轮切分逻辑；`turn` 最后做，前三层已可用 |
| Q2 | 写入入口什么时候做 | **读入口验收后第二批**（`annotate-entry`） | 接口互不依赖，可并行规划；但排期上不抢读入口 |
| Q3 | 阶段时长在哪算 | **后端聚合**，接口只回四类总时长（工具/思考/等待/其他） | 前端不再扫消息；后端要多一次聚合查询 |
| Q4 | emoji 推荐引擎 | **关键词规则表**（零 token 成本）；AI 生成留作后续增强 | 覆盖率有限，靠偏好表补 |
| Q5 | emoji 自动设置门槛 | **只认偏好命中**；纯规则只进推荐区，不自动写 | 猜错成本低，但推荐区会常有候选 |
| Q6 | 反馈信号第一批 | **用户改卡 diff**（最强、零成本） | 比下轮演化 diff 晚一拍，但噪声小 |
