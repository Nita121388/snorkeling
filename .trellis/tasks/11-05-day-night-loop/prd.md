# 昼夜循环工作流：任务分类 · 门链 · loop 台账 · loop-board 看板

> **本文是 G1（需求确认）凭据文件。** 签字前不得进入任何实现动作。
> 状态：**✅ 已签 2026-11-05 09:36 @nita** · prd_hash `c589d4b71e14`
> 需求来源：2026-11-05 六轮讨论 + `data-guardian-dev` 勘察
>
> **Confirmed: 2026-11-05 @nita**

## Goal

把「白天决策/验收/原型 + 夜里 agent 执行/发版」落成一套**可执行、可验证、不可绕过**的流程：

1. 任务按内容分 8 类，每类有固定门链；
2. 门分「人解（H）」与「机器解（A）」，H 门没过下游全停；
3. 流程流水落 `loop/` 台账（只记班次与状态，不记开发内容）；
4. 台账有一个独立部署、可远程查看的看板 `loop-board`。

核心原则：**验证能力先于开发**——没有可重复执行的判定方式，任务不算可开工。

---

## 已拍板决策（2026-11-05）

| # | 决策 | 内容 |
|---|---|---|
| D1 | 台账位置 | 根目录 `loop/`（不放 `.trellis/`：`trellis update` 会覆盖；`task.py archive` 会搬走目录） |
| D2 | 台账形态 | 人写 `queue.json` + 生成 `QUEUE.md`；机器写 `LEDGER-<月>.jsonl`；`LEDGER.md` 为生成物 |
| D3 | 与 Trellis 边界 | Trellis = 任务是什么 & 怎么做；`loop/` = 哪个班次跑到哪一步、算不算过。单向引用，互不复制内容 |
| D4 | 耦合方式 | 用 Trellis 生命周期钩子（`after_create/start/archive`）自动喂 LEDGER，人操作无需记账 |
| D5 | 任务分类 | 8 类：`bug` / `fix-small` / `feature` / `redesign` / `new-surface` / `arch` / `docs` / `chore`，机械判定，default up |
| D6 | 门链 | G0 分类(A) · G1 需求确认(H) · G2 验证能力(A半) · G3 原型确认(H) · G4 设计评审(H) · G5 合规自检(A) · G6 方案确认(H) · G7 验收(H) |
| D7 | 确认凭据 | H 门必须有落盘凭据（时间/人/verdict/hash），不接受对话里一句"可以" |
| D8 | 看板形态 | 独立项目 `E:/primary/projects/loop-board`，本地 server + SPA，支持远程只读 |
| D9 | 看板性质 | 事实的视图 + 决策入口，**不是第二个数据库**：不能把卡拖进 `执行中`/`已发布` |
| D10 | 看板自身 | `loop-board` 是 `new-surface`+`arch`，**必须先过 G1→G3→G4 才开工** |
| **D11** | **参考实现模板** | 以 `E:/primary/projects/data-guardian-dev` 为模板（同族工具，已解决前端/服务端/启动器/部署/写回闸门），**优先复用而非重写**；`pi-session-library` 退为次要参考 |

---

## 参考实现基线（2026-11-05 勘察 `data-guardian-dev`）

**这是本任务最重要的输入：loop-board 需要的八件事，参考项目里已有六件跑在生产上。**

| 需要的件 | 参考项目现成实现 | 处置 |
|---|---|---|
| 前端栈 | Vite + React 18 + TS + Tailwind + shadcn 语义 token（`hsl(var(--background))` 全套）+ cva/clsx/tailwind-merge | **照抄** |
| 图标/动画/拖拽/状态 | `lucide-react` / `motion` / `@dnd-kit/core+sortable+utilities` / `zustand` | **照抄** |
| 设计语言 | `tailwind.config.js` 语义色 + 4 状态色族（ok/warn/danger/info 各 50/100/500/600/700）+ `--radius` + 字号走 CSS 变量支持 `html[data-font-scale]` 整体缩放 | **照抄**，这就是"统一设计语言"的实装，替代不确定的 "Nova" |
| 服务端 | `web/server.mjs` 1895 行零依赖 `node:http`，`listen(PORT,'127.0.0.1')` | **照抄范式** |
| 一键启动器 | `scripts/start.mjs`：查端口 → 按 PID 停旧进程（**命令行必须含 `web/server.mjs`，绝不按进程名杀 node**）→ 判断/触发构建 → 起服务脱离父进程 → 健康探测 → 开浏览器；幂等；`--stop/--status/--no-open/--force-build/--port` | **照抄**，这条正好覆盖 pi 不能批量杀 node 的硬约束 |
| 写回闸门 | `web/agent-files.mjs`：路径全部来自配置不硬编码 → `resolve+realpath` 防穿越/软链逃逸 → 白名单是唯一判定 → 原子写 → 备份 → 审计 | **照抄模式** |
| 依赖边界声明 | `requirements.txt` 故意为空 + 注释写明"这是边界声明不是安装清单"+ doctor 检查 | **照抄话术**，JS 侧对应 `deps-policy.json` + `check-deps.mjs` |
| 远程发布 | Cloudflare Pages + `deploy/_worker.js` Basic Auth（未配口令整站 503 = "忘了配 ≠ 裸奔"）+ `dg-publish.sh` **默认只发脱敏总览**，含客户名的页面需 `--with-backup` 显式开启 | **照抄，但需修正模型**（见 N11 与 R8.6） |

### 必须修正、不能照抄的一点

参考项目的远程是**发布快照**（构建产物 → Pages），而 loop-board 的核心场景是**睡前/起床看夜班实时进度**。两者不是一回事：

- 实时 → 必须本机 server 长跑 + 隧道（Tailscale / 反代）
- 快照 → Pages 可选，用于"不带 token 的只读归档"

→ 见 R8.6 与待决策 Q1。

---

## 范围拆分

本任务（snorkeling 内）只交付**流程资产**：`loop/` 台账骨架、`RUNBOOK.md`、`ledger.mjs`、`queue.mjs`、`hook-bridge.mjs`、门链/分类规范、现有 harness 的 `red_proof` 登记、T0 清账。

`loop-board` 产品本体在 `E:/primary/projects/loop-board` 独立成项目、独立 Trellis，**不落在本仓库**。

---

## Requirements

### R1 任务分类

- R1.1 分类必须**机械可判**：由 `queue.mjs classify` 按固定规则序列判定，不依赖 agent 主观判断。
- R1.2 规则顺序：有 repro → `bug`；新增 `pages/*` 或新入口 → `new-surface`；命中 tokens/scss/组件内部 → `redesign`；命中 `shared/`、server 路由、依赖清单 → `arch`；有新增用户可见行为 → `feature`；纯文档/规范 → `docs`；bump/依赖/杂务 → `chore`；其余 → `fix-small`。
- R1.3 拿不准**升级**（default up），不降级。
- R1.4 分类随包冻结；夜里 agent 不得改类（改类 = park，等人工）。
- R1.5 人可在看板上覆写分类，覆写留痕。

### R2 门链

- R2.1 门 × 类矩阵（H=人工，A=自动）：

  | | G1 | G2 | G3 | G4 | G5 | G6 | G7 |
  |---|---|---|---|---|---|---|---|
  | `bug` | — | A | — | — | — | — | H |
  | `fix-small` | — | A | — | — | — | — | H |
  | `docs` / `chore` | — | — | — | — | A | — | H |
  | `feature` | H | A | — | — | A | — | H |
  | `redesign` | H | A | H | H | A | — | H |
  | `new-surface` | H | A | H | H | A | — | H |
  | `arch` | H | A | — | — | A | H | H |

- R2.2 `bug` / `fix-small` / `docs` / `chore` **零人工门**——这是"夜里能无人跑完"的前提。
- R2.3 H 门只能在白天解；夜间队列准入时所有 H 门必须已清零，否则看板拒绝启动夜班。
- R2.4 执行中发现 H 门被新暴露（需求歧义 / 类型判错 / 触达白名单外）→ park 并跳下一包，**不得自解**。

### R3 门凭据与冻结

- R3.1 H 门凭据：`{at, by, verdict, <artifact>_hash}` 写 `loop/queue.json`；同时在对应 `prd.md` 顶部写一行 `Confirmed: <date> @<who>`。
- R3.2 G1 通过时对 `prd.md` 取 hash 冻结；prd 变更 → 该包自动回退 `needs-g1` 并报变更行数。
- R3.3 G4 通过时对 `design-rubric.md` 取 hash；rubric 变更同理回退。
- R3.4 G2 凭据必须是**已知坏样本实测转红**的输出 + commit，不是"测试通过"。

### R4 例外

- R4.1 `expedited`（线上事故）：可跳 G1/G3/G4，但强制 `release_candidate: true` + 回滚开关必填 + **24h 内补 G1**；未补则永久停在 `needs-retro-g1`，不进后续发版。
- R4.2 `spike`（仅探索原型）：只走 G3，产物必须在 `design/prototypes/`；一旦 diff 触达 `src/` 即升级为 `new-surface` 重新定类。
- R4.3 例外是有记账的欠条，须在看板顶栏常显直到补齐。

### R5 台账 `loop/`

- R5.1 只记状态迁移与班次，**禁止**出现函数名、文件路径、代码片段、设计理由。
- R5.2 判定测试：删掉后"未来重新实现会做错"→ 属内容，进 Trellis；删掉只是"不知道跑到哪"→ 留 `loop/`。
- R5.3 LEDGER 固定字段：`ts / shift / task / action / from / to / evidence / commit / verdict`。
- R5.4 `evidence` 只存指针（报告锚点 / CI run id），不存内容。
- R5.5 按月分卷；`LEDGER.md` 为生成物，禁止手改。
- R5.6 人操作由 Trellis 钩子自动写入，不要求人工记账。

### R6 队列

- R6.1 每包必填：`type`、`gates{}`、`accept`（命令 + 期望数字）、`touch`（路径白名单）、`rollback`、`budget`。
- R6.2 缺 `accept` 数字或 `red_proof` 的包不许进夜班队列。
- R6.3 `touch` 白名单外的写入 = 该包 abort。

### R7 发版 gate

- R7.1 发版是队列尾部的独立串行步骤，不在包循环内。
- R7.2 前置：工作区干净 + 远端号未被占 + 无 ❌ 包 + 发版候选包器具三连绿。
- R7.3 打 tag 后只确认 CI 已触发，不在夜间等构建完成。

### R8 看板 `loop-board`（外部项目，需求在此登记）

- R8.1 6 列：`未就绪 / 今晚队列 / 执行中 / 待验收 / 待发池 / 停泊横幅`；「停泊」不进列。
- R8.2 「未就绪」内按门分组（等你确认 / 待建器具 / 不合规）。
- R8.3 卡片显示门进度、类型、器具三态灯、`red_proof` 摘要、commit、报告指针；**文字节点 ≤ 7，禁止 `label：value` 标签式**。
- R8.4 允许动作仅 6 个：改判据 / 批准入队 / 排序 / 验收三选一 / 丢弃 / 复跑与跳转。
- R8.5 只读 `.trellis/**`；写只落 `loop/**`；写回必须过"路径白名单 + resolve/realpath 防穿越 + 原子写 + 备份 + 审计"（照 `agent-files.mjs` 模式）；归档类破坏操作只生成命令供复制。
- R8.6 远程支持两种模型，**默认最少暴露**：
  - **实时**：本机 server 长跑 + 隧道（Tailscale 优先），token 鉴权，远程强制 `readonly`；
  - **快照**（可选）：Cloudflare Pages + Basic Auth，未配口令整站 503；发布内容默认只含总览，凡涉及真实仓库路径/客户名/commit 的视图需显式开关。
- R8.7 窄屏为单列 + 横向 snap 滑列，不挤压 6 列。
- R8.8 技术约束：仅 `shadcn(vendored)` + `lucide-react` + `motion` + `react-resizable-panels` + `@dnd-kit` + `zustand` + `sonner`；服务端裸 `node:http`；禁 express/fastify/hono、禁组件库 npm 包、禁 TanStack Query/SWR/axios。
- R8.9 **一键启动器**：照 `scripts/start.mjs` 范式（查端口 → 按 PID 停旧进程 → 构建判定 → 起服务脱离父进程 → 健康探测 → 开浏览器），幂等，支持 `--stop/--status/--port`；**只按端口解析出的 PID 停进程，且校验命令行归属，绝不按进程名批量杀 node**。
- R8.10 **依赖边界声明**：`deps-policy.json`（唯一允许清单）+ `scripts/check-deps.mjs`（越界即退出非 0），挂进 `npm run verify`；`.npmrc` 加 `save-exact`。
- R8.11 **Windows 防乱码约定**：入口脚本用 ASCII 文件名 + 编号前缀（`01-*` 启动 / `02-*` 停止），文件内容 UTF-8 + `chcp 65001`。

### R9 验证优先（贯穿）

- R9.1 每包必须有可执行判定；无判定者只算"想法"，不进队列。
- R9.2 现有 4 个 harness（preview-edit / image-pager / overview-board / vcs-tree-status）逐个登记 `red_proof`。
- R9.3 证据阶梯：L0 肉眼不接受；Bug ≥ L3（红绿 + stash 对照）；样式修复 ≥ L4（像素/几何）；样式重设计 ≥ L5（rubric 逐条）。

---

## 不做什么（Non-goals）

- N1 不做任务管理系统替代品：不复制、不同步 Trellis 任务内容到 `loop/`。
- N2 不做通用"开发日记/日志"（已有 git log + journal + task.json 三个时间轴，第四个必然腐烂）。
- N3 看板不执行 `git` / `task.py archive` / 任何破坏性命令。
- N4 看板不提供拖拽到 `执行中`/`已发布`（只能由事实产生）。
- N5 不在 `.trellis/` 内新增任何工具代码。
- N6 不做多人协作、评论系统、权限体系（讨论可复用 `trellis channel forum`）。
- N7 不做浅色主题切换（v1 单深色主题）。
- N8 不引入数据库（`loop/` 文件即真相源）。
- N9 本任务不实现 `loop-board` 产品代码（另立项目）。
- N10 不做 cron 定时器；夜班由人启动或单一调度入口触发。
- N11 **不照抄参考项目的"只发快照"远程模型**——实时查看是核心场景，快照只作可选补充。

---

## Acceptance Criteria

- [ ] **C1** `loop/` 骨架就位：`RUNBOOK.md`（门×类矩阵、分类规则、例外、证据阶梯）/ `queue.json` / `LEDGER-<月>.jsonl` / `DECISIONS.md`
- [ ] **C2** `queue.mjs classify` 对 8 类各给出正确判定（≥16 条夹具用例全绿，含"拿不准升级"用例）
- [ ] **C3** `queue.mjs gate` 能写入并校验 H 门凭据；缺凭据时拒绝入队（负向用例必须红）
- [ ] **C4** prd 改动后对应包自动回退 `needs-g1` 并报变更行数（漂移检测生效）
- [ ] **C5** `hook-bridge.mjs` + `hooks.local.json` 使 `task.py start/archive` 自动向 LEDGER 追加（实测 3 次迁移），人工零记账
- [ ] **C6** 现有 4 个 harness 全部登记 `red_proof`，且每条 `red_proof` 可复现为红
- [ ] **C7** T0 清账完成：活跃任务从 46 降至 ≤22，`task.py list-archive` 可查全部归档
- [ ] **C8** 夜班准入校验生效：任一台 H 门未清零时启动被拒绝并指明缺哪道门
- [ ] **C9** 至少 1 次真实夜班：3 个零人工门类型无人工干预跑完，产出晨报 `loop/REPORTS/<date>.md`
- [ ] **C10** 晨报能让人在 30 分钟内处置完，且处置过程无需打开代码
- [ ] **C11** `loop-board` 需求已过 G1，原型已过 G3、rubric 已过 G4（以凭据记录为准）
- [ ] **C12** 发版 gate 校验生效：工作区不干净 / 号被占 / 有 ❌ 包时拒绝发版
- [ ] **C13** `loop-board` 的一键启动器可幂等启停，且 `--stop` 只终止校验通过的 PID（负向用例：命令行不匹配时**不杀**，仅告警）

---

## 约束与前置

- 发版前置已满足：`0.0.118` bump commit 已落地（12eab5dc）。
- `tsc` 基线 69 错误为存量，任何改动不得使该数字变大。
- 夜间 agent 不喊人：阻塞一律 park 入晨报；完成时单条推送。
- 不得在 `.trellis/` 内新增工具代码；不得放宽既有 harness 规则而未重读其 incident note。

---

## 待你决策（G1 一并答复）

| # | 问题 | 我推荐 |
|---|---|---|
| **Q1** | 远程模型：实时（本机 + Tailscale）/ 快照（Pages + 口令）/ 两者（实时为主、快照归档） | **两者，实时为主** —— 实时覆盖"睡前看夜班"，快照覆盖"手机不方便连内网时看归档" |
| **Q2** | 设计语言基准：`data-guardian-dev` 现有 shadcn 语义 token + 4 状态色族 | **采用**，被视为 "Nova" 的落地答案；后续换肤只改 token 一处 |
| **Q3** | `fix-small` 是否保持零人工门 | **保持**（若你不放心，可加一道"晨会阅后确认"轻门，请指明） |
| **Q4** | `loop-board` 自己先过 G1→G3→G4 才开工（多等约 1 天） | **保持**，规则自洽 |
| **Q5** | 单深色主题（N7） | **保持** |

---

## G1 签字

> 请确认「做什么 / 不做什么 / 验收判据」三段 + 上面 5 个决策。
> 任一验收判据不可执行或不可量化，请直接批注条款号，我改后回签。

```yaml
g1:
  at: 2026-11-05T09:36
  by: nita
  verdict: confirmed
  prd_hash: c589d4b71e14   # = sha256(`## Goal` … `## G1 签字`之前)；不含头部元信息与签名字段
  answers:
    Q1: both-realtime-primary   # 实时为主 + 快照可选
    Q2: data-guardian-tokens    # 采用参考项目 token 体系
    Q3: fix-small-zero-gate     # 保持零人工门
    Q4: self-gated              # loop-board 自身先过 G1→G3→G4
    Q5: dark-only               # 单深色主题
```
