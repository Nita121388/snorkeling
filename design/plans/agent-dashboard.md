> 状态：▲ 设计活跃（未实现）
> 镜像源：—（产品设计方案，尚无真实组件）
> 最后同步：2026-09-09

# Agent Dashboard — 产品设计文档

> 作者：Agent 产品经理  
> 日期：2026-09-09  
> 状态：Draft  
> 项目：Snorkeling（基于 Wave）

---

## 一、为什么要做

Snorkeling 同时管理多种 AI Agent（Pi / Codex / Claude Code / Wave AI 内置 / 自定义 Agent），分别来自不同供应商（OpenAI、Anthropic、Google、Ollama 等），使用不同模型，运行状态、速率限制、费用消耗分散在各处。

**用户需要一个统一视图，一眼掌握全局。**

---

## 〇、与已有 Agent ID Card 的关系

本项目已有 [`design/prototypes/agent-id-card/`](../design/prototypes/agent-id-card/) UI 原型——单个 agent 的"开篇卡/身份证"，在 agent 启动瞬间于终端 block 内展示，折叠后常驻 header 徽标。两者**互补而非竞争**：

| 维度 | Agent ID Card（已有原型） | Agent Dashboard（本文档） |
|------|-------------------------|--------------------------|
| **定位** | 单个 agent 的深度身份页——开篇仪式 + 折叠态常驻 | 多 agent 全局监控面板——一眼看所有状态 |
| **视角** | 微观：一个 agent 的完整身份 + 时间轴 + Note/Tags + Sessions 方块 | 宏观：所有 agent 的摘要 + 对比 + 趋势 + 费用 |
| **生命周期** | launch/resume → 开篇卡 → 有输出后折叠为 header 徽标 → 随时展开 | 始终存在，实时更新 |
| **入口** | 终端 block 内嵌（嵌入式） | 右侧 WidgetsBar widget（面板式） |
| **共享数据** | `SessionSummary` + `presentAgentStatus()` | 同左 + 新增 usage/rateLimit/cost 采集 |

### 融合方案

1. **Dashboard AgentCard = ID Card 的"摘要版"**：Dashboard 的每张卡片提取 ID Card 的核心字段（provider logo + 状态环 + state label + sessionId），去掉 Note/Tags/Sessions 方块/时间条（这些留在完整卡里）。
2. **Dashboard → ID Card 钻取**：在 Dashboard 卡片上点击 "View Details" / 点击卡片本身 → 展开完整的 Agent ID Card 视图（复用已有原型的视觉语言和字段布局）。
3. **ID Card 的折叠徽标也接 Dashboard**：Header 徽标的 tooltip/展开菜单中，新增一个 "Open Dashboard" 入口，从单 agent 视角跳转到全局视图。
4. **共享视觉系统**：状态环颜色、provider logo、状态文案（"Working · Tool: x" / "Thinking" / "Blocked" / "Rate limited"）两端统一使用 `agent-status-derive.ts` 的 `presentAgentStatus()`，保持一致。

```
                    ┌─────────────────────────────┐
                    │      WidgetsBar             │
                    │  ┌───────────────────────┐  │
                    │  │  📊 Agent Dashboard    │  │  ← 全局面板
                    │  │                       │  │
                    │  │  [Card: Pi ─ Sonnet]──┼──┼──→ 展开完整 ID Card
                    │  │  [Card: Codex ─ o3]  │  │    （内嵌式 / 弹窗）
                    │  │  [Card: Claude ─ GPT] │  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
                           ↕ 互补跳转
                    ┌─────────────────────────────┐
                    │  Terminal Block (agent)      │
                    │  ┌───────────────────────┐  │  ← 单 agent 深度
                    │  │  Agent ID Card (折叠)  │  │
                    │  │  状态灯 + Title        │  │  ← 徽标态常驻
                    │  ├───────────────────────┤  │
                    │  │  终端内容              │  │
                    │  └───────────────────────┘  │
                    └─────────────────────────────┘
```

> **参考原型路径**：`design/prototypes/agent-id-card/`（index.html + script.js + style.css + README.md）

---

## 一-A、目标用户画像

| 场景 | 痛点 |
|------|------|
| 多窗口并行开发 | 开了 5 个终端分别跑 agent，不知道哪个还活着、哪个卡住了 |
| 费用敏感型用户 | 不知道 OpenAI 和 Claude 各花了多少钱，API key 余额多少 |
| 速率限制遭遇者 | 突然 rate-limited 了，不知道还有多少额度、恢复时间 |
| 调试/排查 agent | agent 莫名报错，需要看错误率、最后几轮对话状态 |

---

## 三、数据来源分析

### 已有数据管道

| 数据层 | 路径 | 已有数据 |
|--------|------|---------|
| `pkg/agentstatus` | Go 后端 | blockId → AgentStatus（provider / sessionId / state / phase / toolName / seq / updatedAt） |
| `pkg/aiusechat` | Go 后端 | 各 provider 对话记录（token usage / model / cost） |
| `pkg/aisessions` | Go 后端 | session metadata（开始时间 / 结束时间 / 标签） |
| WaveEvent 订阅 | 前后端 | real-time `"agentstatus"` 事件流 |

### 缺失的数据（需新增采集）

| 缺失项 | 采集方案 |
|--------|---------|
| Token 消耗（prompt_tokens / completion_tokens） | 在各 `aiusechat` provider 的 `ChatStream` 返回中拦截 `usage` 字段，写入内存 ring buffer |
| 费用估算 | 按 provider/model 维护 `pricing.json`（参考 OpenRouter 定价），实时乘以 token 数 |
| 速率限制元数据 | 解析 HTTP 响应头 `x-ratelimit-*` / Anthropic 的 `anthropic-ratelimit-*`，写入 rateLimit 状态 |
| Agent 运行时长 | `agentstatus` 事件中的 `activeSince` + `updatedAt` 计算 delta |
| 历史趋势 | 每 5 分钟一次快照写入 SQLite `agent_metrics` 表 |

---

## 四、功能架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent Dashboard                            │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │  Agent Cards │  │ Global Stats │  │  Trend Charts        │ │
│  │  (每 agent)  │  │  (汇总数字)  │  │  (token/费用/速率)   │ │
│  └─────────────┘  └─────────────┘  └──────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Timeline / Event Stream (可选展开)                       │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 五、核心数据模型

> 说明：`AgentSnapshot` 是 **Dashboard 专用聚合模型**。它与 Agent ID Card 使用的 `SessionSummary` 是两套数据，但字段有重叠（provider/model/state/sessionId），实现时由同一个 `agentstatus.Manager` 派发，**状态字段两端同源**（都来自 `presentAgentStatus()` 的 state label）。

```typescript
/** 每个 Agent 实例的实时快照 */
interface AgentSnapshot {
  id: string;                    // agentId / blockId
  name: string;                  // 可读名称（与 ID Card 的 Title 同源）
  type: AgentType;               // "pi" | "codex" | "claude-code" | "wave-ai" | "custom"
  provider: string;              // "openai" | "anthropic" | "google" | "ollama" | "azure" | "deepseek"
  model: string;                 // "gpt-4o" | "claude-sonnet-4-20250514" | "gemini-2.5-pro"
  state: AgentState;             // "working" | "idle" | "blocked" | "error" | "rate-limited" | "stale"
  phase: AgentPhase;             // "thinking" | "tool" | "shell-command" | "approval" | "none"
  currentTool?: string;          // 当前调用的工具名（与 ID Card 的 "Working · Tool: x" 同源）

  // 速率 & 配额
  rateLimit?: {
    requestsRemaining: number;
    requestsLimit: number;
    requestsResetAt: number;     // epoch ms
    tokensRemaining: number;
    tokensLimit: number;
    tokensResetAt: number;
  };

  // 本轮/本会话累计
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;    // 基于 pricing.json 估算
    requestCount: number;
    errorCount: number;
    avgLatencyMs: number;
    activeSince: number;         // epoch ms, 最近一次从 idle→working
    lastUpdatedAt: number;
  };

  // 来源（与 ID Card 底部编号行同源）
  sessionId?: string;            // resolveAgentSessionId(meta) 同源
  blockId?: string;              // 波浪块
  cwd?: string;                  // 工作目录（ID Card 的 projectPath）
  branch?: string;               // git 分支（如果可检测）
}
```

---

## 六、UI 设计（Snorkeling 风格）

### 6.1 入口

右侧 `WidgetsBar` 新增一个 **📊 Agent** widget，点击展开 Dashboard Panel。

### 6.2 全局摘要条（顶部）

```
┌──────────────────────────────────────────────────────────┐
│  🟢 3 Active   ⚠️ 1 Rate-Limited   🔴 0 Error           │
│  Total: $12.34 today   245K tokens   89 requests        │
│  Last updated: 2s ago                        ⟳ Refresh   │
└──────────────────────────────────────────────────────────┘
```

### 6.3 Agent 卡片（核心）

每个 Agent 一张卡片，信息密度高但层次清晰：

**Working Agent：**

```
┌────────────────────────────────────────────┐
│  🟢 Pi — Claude Sonnet 4      thinking...  │
│  ─────────────────────────────────────────  │
│  Provider: Anthropic    Model: claude-sonnet-4-20250514  │
│  Session:  abc123       Block:  #12       │
│  ─────────────────────────────────────────  │
│  ⏱ Active: 12m 34s    📨 23 reqs    ❌ 1 error  │
│  💰 Cost: $4.21       Tokens: 156K (12K+144K)  │
│  ⚡ Latency: avg 2.3s    p95: 5.1s              │
│  ─────────────────────────────────────────  │
│  Rate Limit: ████████████░░░░ 78% remaining  │
│  ─────────────────────────────────────────  │
│  [View Logs]  [View Session]  [Compare]     │
└────────────────────────────────────────────┘
```

**Rate-Limited Agent：**

```
┌────────────────────────────────────────────┐
│  🔴 Codex — o3              rate-limited!  │
│  ─────────────────────────────────────────  │
│  Provider: OpenAI       Model: o3           │
│  Session:  def456       Block:  #7        │
│  ─────────────────────────────────────────  │
│  Rate Limit: ████░░░░░░░░░░░░ 25% remaining  │
│  Reset in: 3m 12s                            │
│  ⚠️ Retry-After: 42s                        │
└────────────────────────────────────────────┘
```

### 6.4 卡片状态颜色映射

| State | 颜色 | 图标 |
|-------|------|------|
| working | 🟢 绿色 + 脉冲动画 | ⚡ |
| idle | ⚪ 灰色 | ⏸ |
| blocked | 🟡 黄色 | 🔒 |
| error | 🔴 红色 | ❌ |
| rate-limited | 🟠 橙色 | ⏳ |
| stale | 🟤 暗灰 | 👻 |

### 6.5 趋势图（展开区域）

```
Token Usage (last 1h)          Cost Breakdown (today)
  ▁▂▃▅▇█▇▅▃▂▁                    ┌──────────────┐
  OpenAI ──  Anthropic ──  Ollama │ ▓▓▓▓▓▓▓▓ $8.4 │  Claude Sonnet
                                  │ ▓▓▓▓ $3.9     │  GPT-4o
                                  │ ░ $0.0         │  Ollama
                                  └──────────────┘
```

---

## 七、数据流架构

```
┌──────────────────────────────────────────────────────────────┐
│                        波浪后端 (Go)                          │
│                                                              │
│  agentstatus.Manager                                         │
│    │                                                         │
│    ├─ StatusReport() ← hook / provider / shell-integration  │
│    │   └─ 每次更新 → AgentMetricsCollector.Collect(snapshot)│
│    │                                                         │
│    ├─ aiusechat providers                                    │
│    │   └─ stream response → 拦截 usage → UsageCollector     │
│    │                                                         │
│    └─ Provider RateLimit Headers                             │
│        └─ 解析 → RateLimitCollector                          │
│                                                              │
│  ┌────────────────────────────────────────┐                  │
│  │ AgentDashboardService                  │                  │
│  │  GetDashboard() → []AgentSnapshot      │                  │
│  │  GetMetricsHistory(id, range)          │                  │
│  │  GetGlobalStats()                      │                  │
│  └───────────────┬────────────────────────┘                  │
│                  │ wps push / wsh query                      │
└──────────────────┼───────────────────────────────────────────┘
                   │
┌──────────────────┼───────────────────────────────────────────┐
│         前端 (React + Jotai)                                  │
│                  │                                           │
│  agentDashboardAtom ──→ AgentDashboardPanel                  │
│    │  ├─ agentSnapshotsAtom[]                                │
│    │  ├─ globalStatsAtom                                     │
│    │  └─ metricsHistoryAtom                                  │
│    │                                                         │
│  └─ waveEventSubscribeSingle("agent-dashboard")              │
└──────────────────────────────────────────────────────────────┘
```

---

## 八、API 设计

### WPS 事件

```protobuf
AgentDashboardUpdate {
  agentId: string
  snapshot: AgentSnapshot
  type: "update" | "removed"
}
```

### WSH 命令

```bash
wsh agent dashboard                    # 全局摘要
wsh agent dashboard --watch            # 实时流（tail -f）
wsh agent dashboard --agent <id>       # 单 agent 详情
wsh agent dashboard --history 1h       # 历史趋势
wsh agent dashboard --export report.json
```

---

## 九、技术实现路径

### Phase 1：数据采集层（1-2 天）

| 任务 | 涉及文件 |
|------|---------|
| 在 `aiusechat` 各 provider stream 返回处拦截 `usage` 字段 | `pkg/aiusechat/openai/`, `anthropic/`, `gemini/` |
| 解析 `x-ratelimit-*` 响应头写入状态 | 同上 + `pkg/agentstatus/agentstatus.go` |
| 新增 `pkg/agentdashboard/` 服务（内存 ring buffer + 聚合逻辑） | 新目录 |
| pricing.json 配置文件 | `pkg/agentdashboard/pricing.json` |

### Phase 2：前端看板 UI（2-3 天）

| 任务 | 涉及文件 |
|------|---------|
| WidgetsBar 新增 Agent widget 入口 | `frontend/app/widgets-bar/` |
| AgentDashboardPanel 组件 | `frontend/app/agent-dashboard/` (新目录) |
| AgentCard 子组件 | 同上 |
| 全局统计条 + 趋势图（用 recharts 或 canvas） | 同上 |
| Jotai atoms 订阅 | 同上 |

### Phase 3：持久化 + 历史（1 天）

| 任务 | 涉及文件 |
|------|---------|
| SQLite `agent_metrics` 表定期快照 | `pkg/agentdashboard/metrics.go` |
| `wsh agent dashboard --history` 查询 | `pkg/waveapp/` |
| 趋势图数据后端 | 同上 |

---

## 十、MVP 范围（先做什么）

```
✅ MVP（一周内）：
  - 右侧 Widget 入口
  - 实时 Agent 卡片列表（provider/model/state/phase）
  - 全局摘要数字（active 数 / total cost / total tokens）
  - Rate limit 进度条（需先从 header 采集数据）

📈 V2（后续）：
  - 趋势图表（token/cost 随时间变化）
  - 历史快照（SQLite 持久化）
  - 按 provider/model 筛选和排序
  - Cost Budget 告警（"今日费用超 $10 通知"）
  - Export 报告

🔮 V3（远期）：
  - Agent 对比视图（"同样任务 Claude vs GPT 谁快"）
  - 预算预估（按当前速度预计月底费用）
  - 速率限制自动调度（A 限流时自动切换 B）
```

---

## 十一、与现有代码的集成点

> **核心原则：不重写，扩展现有基础设施。**

| 现有模块 | 复用方式 |
|---------|---------|
| `pkg/agentstatus` 状态机 | 直接复用 working/idle/blocked/error/rate-limited 状态 |
| `AgentStatusReport.Provider` / `.SessionId` | 卡片的 provider 和 session 来源 |
| `frontend/app/agent-status/` Jotai atom 缓存 | 可扩展为 dashboard 数据源 |
| WaveEvent 订阅 | 实时更新用同一套机制 |
| `agent-status-done-ack-store` ack 机制 | Dashboard 卡片可复用"已确认"状态 |

---

## 十二、关键设计决策

| 问题 | 建议 |
|------|------|
| Dashboard 放在 WidgetsBar 还是独立 Tab？ | **WidgetsBar**：看板是"瞥一眼"场景，不是全屏工作流 |
| 数据更新频率？ | **1s 轮询 agentstatus + 事件驱动 usage**：状态秒级，token 级合并 |
| 多终端场景（SSH 远端）？ | Phase 1 只做本机；Phase 2 通过 wps bridge 扩展到远端 |
| Ollama 本地模型如何计费？ | **固定 0 cost**，但记录 token 数用于对比 |

---

## 十三、附录：Pricing.json 示例

```json
{
  "providers": {
    "openai": {
      "models": {
        "gpt-4o":           { "promptPer1k": 0.0025,  "completionPer1k": 0.01 },
        "gpt-4o-mini":      { "promptPer1k": 0.00015, "completionPer1k": 0.0006 },
        "o3":               { "promptPer1k": 0.01,    "completionPer1k": 0.04 },
        "o3-mini":          { "promptPer1k": 0.0011,  "completionPer1k": 0.0044 }
      }
    },
    "anthropic": {
      "models": {
        "claude-sonnet-4-20250514":  { "promptPer1k": 0.003,  "completionPer1k": 0.015 },
        "claude-3-5-haiku-20241022": { "promptPer1k": 0.001,  "completionPer1k": 0.005 }
      }
    },
    "google": {
      "models": {
        "gemini-2.5-pro":  { "promptPer1k": 0.00125, "completionPer1k": 0.01 },
        "gemini-2.0-flash":{ "promptPer1k": 0.0001,  "completionPer1k": 0.0004 }
      }
    },
    "ollama": {
      "models": {
        "*": { "promptPer1k": 0, "completionPer1k": 0 }
      }
    }
  }
}
```

---

## 十四、风险与 Mitigation

| 风险 | 影响 | 缓解 |
|------|------|------|
| 部分 provider 不返回 `usage` 或 `x-ratelimit-*` | 卡片上部分字段为空 | 空值显示为"—"，标注数据不可用 |
| 高频使用时 ring buffer 内存增长 | 看板占用内存过多 | 固定 buffer 大小（10K 条），LRU 淘汰 |
| pricing.json 定价与实际不一致 | 费用估算偏差 | 支持用户自定义 pricing，标注"估算" |
| 浏览器端 Jotai 原子过多影响渲染性能 | 卡顿 | 分批渲染 + 虚拟滚动（>20 agents 时） |
