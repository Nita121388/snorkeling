# 调研：`agent-autoloop`（KKKKhazix）对本项目的参考价值

> 调研时间：2026-11-05 · 对象：https://github.com/KKKKhazix/agent-autoloop
> 元数据：TypeScript，2605 ★ / 506 fork，创建 2026-11-03，内核 1651 行、**零运行时依赖**，MIT
> 平台：macOS / Linux（**Windows 未支持**，作者 issue #17，本周内补）
> 读取方式：GitHub API + raw 文件（README 17KB、`docs/protocol.md` 43KB、`sim/invariants.ts`、`protocol/schema.json` 结构、目录树 207 文件）

## 一句话判断

**机制极其对口，架构不该抄。** 它的命题就是本任务的命题（「夜里自己干活，拿不准才找人拍板」），但它是通用多租户中台，我们是单仓库流程台账。

## 同构对照

| 维度 | agent-autoloop | 本项目 `loop/` |
|---|---|---|
| 人拍板 | 卡片：`ask` / `notice` / `resolve` / `later` | H 门 G1/G3/G4/G6 + 晨报停泊 |
| 队列定义 | `rules.json`：`when(source\|cron)` → `to/cwd/skill/prompt` | `queue.json`：`type` / `gates` / `accept` / `touch` |
| 状态载体 | SQLite WAL+FULL + 事件溯源，`evolve` 唯一投影写入者 | JSONL 事件流 + `derive` 折叠 |
| 等价概念 | 事项 / 一轮 / 回执 | 包 / 夜班 / 验收证据 |
| 边界来源 | 插件主动连内核（内核零外呼） | 无外部请求（本地文件） |
| 平台 | macOS/Linux | Windows 为主 |

## 值得抄（12 条）

### P0 —— 补短板

| # | 它的做法 | 我们的缺口 | 落点 |
|---|---|---|---|
| 1 | `sim/invariants.ts` 的 `replay()` 是**独立重放实现**，不复用 `evolve()`，然后 `assert.deepEqual(view, replay(log))` | `deriveRunStates` 是唯一实现，测试只是固定输入→期望，等于自己验自己 | 新增 `loop/lib/derive.oracle.test.mjs`：手写极简 replay 做双实现对账 |
| 2 | `node sim/random.ts 24301 200000`：种子复现的 20 万步随机模拟（断网/丢包/崩溃/重复提交） | 只有 43 条固定夹具 | `queue.mjs fuzz --seed N --steps M`，断言：序号连续 / 无重复 id / 门状态单调 / park 必带原因 |
| 3 | `agent-autoloop why 1`：任一轮的来龙去脉时间线（触发→规则版本→领取→回执→卡片回答） | `list`/`derive` 只给结论，阻塞原因散在 stderr | `queue.mjs why --id X`：门链逐项判定 + 相关 LEDGER 时间线 + 签字人 |
| 4 | **规则文件坏了按旧规则继续跑并告警**，不当作"规则被删光" | `loadQueue()` 解析失败返回空队列 = 队列被静默清空（已在本次修复） | 已修：`lib/queue-io.mjs` 回退 `.queue.last-good.json` |

### P1 —— 结构改进

| # | 它的做法 | 我们的缺口 |
|---|---|---|
| 5 | 「一轮不等人」是协议级：提问时进程退出、不花 token，状态在库里 | 我们的 park 只是台账状态，夜里 agent 上下文仍占着 → 纪律改为「park 即终止该包子进程」 |
| 6 | 卡片四型：`ask` / `notice` / **`resolve`**（问题自己好了→卡片改"不用决定了"）/ **`later`**（定时复查） | 只有"停泊 + 晨报"，缺 resolve / later 两种收尾 |
| 7 | **hops TTL ≤ 8**：事件递归派活层数只增不减，**Agent 改不了**，超 8 层只记录不派发 + 通知 | 无链深限制；本项目有 subagent 能力 → 无界递归风险 |
| 8 | `protocol/schema.json`（JSON Schema 2020-12）+ `conformance` 命令跑真实 HTTP | `queue.json` 只靠手写断言 |
| 9 | `worker/usage.ts` + `cli/spend.ts`：按轮统计 token 与费用 | 台账无用量/成本字段（夜里跑 agent 是真花钱的） |

### P2 —— 纪律与术语

| # | 它的做法 | 我们的缺口 |
|---|---|---|
| 10 | 指令数据分离：外部文字只进"资料文件"**不进提示词**；事件里带 `cwd/agent/access` 直接拒收 | `touch` 白名单是同类思路，但"外部内容进夜班 prompt"（提示注入）无防线 |
| 11 | `elsewhere`：别处定时任务只列出不执行 | 不在队列里的 Trellis 任务应在 status 里列出 |
| 12 | 六个词的术语表（事件/规则/事项/一轮/回执/卡片） | 包/门/凭据/班次/停泊/晨报需同样一张表；术语不统一是 agent 误用主因 |

## 明确不抄

| 它做了 | 不抄的理由 |
|---|---|
| SQLite + 事件溯源重投影（110 万事实启动 99.8ms、全量重建 43.1s） | 我们 3 个包、每晚几十行；违反 PRD N8（不引数据库） |
| HTTP 协议 + 四类密钥 + 插件三向（source/agent/channel） | 单机单用户，过度工程 |
| 卡片推到飞书/钉钉/企微/Slack/Discord | 我们有 `shout_for_user` + `loop-board` |
| 交付流水线：PR review→CI→merge→deploy→verify 线上版本 | 他们做多仓库持续交付，我们做"周五晚一次发版" |
| 本轮 token / 卡片链接 token 的 HMAC 推导 | 无多租户 |

## 它做得比我们彻底、值得单独记住的三句话

1. **「注意力最贵。默认安静。」** —— 这是它六条原则的第一条，我们的 `silence` 策略同源，但没写成原则。
2. **「规则才是指令」** —— 事件决定不了交给谁、在哪干、什么权限；别人写的话不进提示词。我们的门链同源，但没说透。
3. **失败表穷举 20 行** —— 连「你点了两次」「提问之后问题自己好了」「接单程序整台不见了」都有对策。我们的失败模式表只有 6 行。

## 落地建议（需人工拍板后入队）

| 优先级 | 事项 | 类型 | 门 |
|---|---|---|---|
| P1 | `why` 命令（补可解释性） | `feature` | G1 |
| P1 | 独立重放 oracle + fuzz（补验证能力） | `bug`/`feature` | G2 |
| P2 | 卡片四型（resolve/later） | `feature` | G1 |
| P2 | hops TTL + usage 入账 | `feature` | G1 |
| P3 | 术语表 + 失败表扩到 15 行 | `docs` | G5 |
