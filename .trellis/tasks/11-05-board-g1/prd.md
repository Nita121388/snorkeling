# loop-board · G1 需求确认

> **状态：待签。** 签字前不得进入任何实现动作（含 `npm install`、scaffold、写组件）。
> 依据：`E:/code/snorkeling` 的 `loop/` 台账与 `.trellis/tasks/11-05-day-night-loop/`。
> 框架总图：`E:/code/snorkeling/docs/answers/day-night-loop-framework-20261105-1034.html`

## Goal

把 `loop/` 台账与 `.trellis/` 任务渲染成一个**事实的视图 + 决策入口**：

1. 一次看多个仓库的队列、门状态、夜班进度；
2. 白天在板上做 6 个决策动作，不打开代码；
3. 睡前与起床都能看（本机 + 远程只读）。

## 定位（不许长成别的东西）

| 是 | 不是 |
|---|---|
| 派生状态的渲染器 | 第二个数据库 |
| 6 个决策的入口 | 任务管理系统 |
| 只读 `.trellis/**` | 会写 `.trellis` 的工具 |
| 只写 `loop/**` | 会执行 `git` / `task.py` 的工具 |

## 三条硬约束（来自上游）

- **单一写者**：队列只经 `queue.mjs` 写；看板与 CLI 走同一个写入函数。
- **状态两维**：`gateState`（门）与 `runState`（班次）由 CLI 输出，看板只渲染，不自己算。
- **不许拖进事实态**：`执行中`/`已发布` 只能由 LEDGER 事实产生，人不能拖进去。

## Requirements

### R1 数据来源

- R1.1 读多仓库：`LB_ROOTS`（分隔符 `;` 或 `:`），每个根下找 `loop/queue.json` 与 `.trellis/tasks/`。
- R1.2 派生状态只走三个只读命令：`queue.mjs list --json`、`queue.mjs derive --json`、`ledger.mjs tail --json`。
- R1.3 仓库缺 `loop/` 时显示"未接入"，不报错、不猜。
- R1.4 全部扫描 ≤ 300ms（10 个仓库 × 40 包）。

### R2 看板

- R2.1 六列：`未就绪 / 今晚队列 / 执行中 / 待验收 / 待发池`，加一条停泊横幅（不进列）。
- R2.2 未就绪列内按门分组：等你确认 / 待建器具 / 不合规。
- R2.3 卡片：门进度（已过/总数）、类型、器具三态灯（无器具 / 只红 / 绿×3）、`red_proof` 摘要、commit、报告指针、`origin` 与 `reply` 标记。
- R2.4 卡片文字节点 ≤ 7，**禁止** `label：value` 标签式；靠布局与对齐说明含义。
- R2.5 窄屏为单列 + 横向 snap 滑列，不挤压六列。

### R3 决策（只许 6 个）

- R3.1 改判据（`accept` / `touch` / `budget`）。
- R3.2 批准入队 / 撤出。
- R3.3 列内排序。
- R3.4 验收三选一：通过 / 打回 / 批注。
- R3.5 丢弃（必填理由）。
- R3.6 复跑器具 / 打开报告 / 跳 Trellis 任务。

### R4 三路验收（对上游框架负责）

- R4.1 **路一 包验收**：待验收列按 `red_proof` 与证据级别排序，一键 `[复跑]`。
- R4.2 **路二 对外巡检**：`origin` 非 internal 的包单列一组，显示未回信的（`reply` 未填）为红点。
- R4.3 **路三 防腐**：显示 `queue.mjs g8` 结果；不通过时顶栏常红。
- R4.4 顶栏三段：`⏸ 停泊 N` / `✍ 等你确认 N` / `🌙 今晚 N 包 · 人工门已清?`。

### R5 写回与安全

- R5.1 写只落 `loop/**`；`.trellis/**` 只读。
- R5.2 写回五道闸：路径白名单 → `resolve` + `realpath` 防穿越 → 原子写 → 备份 → 审计行。
- R5.3 归档/删除类操作**只生成命令文本**供复制，服务端永不执行。
- R5.4 `LB_MODE=readonly` 时所有写接口返回 403；远程强制 readonly。

### R6 远程

- R6.1 实时：本机 server 长跑 + 隧道（Tailscale 优先），`LB_TOKEN` 鉴权。
- R6.2 快照（可选）：Cloudflare Pages + Basic Auth，未配口令整站 503；默认只发总览。
- R6.3 手机可看，且默认只读。

### R7 技术约束

- R7.1 前端：Vite + React + TS + Tailwind；组件只用 shadcn 源码（vendored）；`lucide-react` / `motion` / `react-resizable-panels` / `@dnd-kit` / `zustand` / `sonner`。
- R7.2 服务端：裸 `node:http`，零第三方运行时依赖。
- R7.3 禁止：express/fastify/hono、任何组件库 npm 包、TanStack Query/SWR/axios、第二个图标集、第二个动画库。
- R7.4 `deps-policy.json` 白名单 + `scripts/check-deps.mjs`，挂进 `npm run verify`。
- R7.5 设计语言取 `data-guardian-dev`：shadcn 语义 token + 4 状态色族（ok/warn/danger/info）+ `--radius` + `html[data-font-scale]`。
- R7.6 一键启动器：查端口 → 按 PID 停旧进程（**命令行必须含 `server/index.mjs`**）→ 健康探测 → 开浏览器；`--stop/--status/--port`；绝不按进程名杀 node。

## 不做什么

- N1 不做第二个数据库；不把派生状态落盘成第二份真相。
- N2 不做多人协作、评论、权限体系。
- N3 不做浅色主题（v1 单深色）。
- N4 不执行 `git` / `task.py` 写子命令 / 任何归档动作。
- N5 不显示代码内容、diff、函数名（只显示指针与结论）。
- N6 不做移动端原生 App；只做响应式单页。
- N7 不在 v1 接外部事件源（GitHub / Discord / Twitter 抓取）——留给分诊人工登记。

## Acceptance Criteria

- [ ] **C1** 10 个仓库（含缺 `loop/` 的）全部正确显示，扫描 ≤ 300ms
- [ ] **C2** 六列分布与 `derive --json` 完全一致（同一份输入，抽样 20 包零差异）
- [ ] **C3** 卡片文字节点 ≤ 7（自动计数脚本断言）
- [ ] **C4** 6 个动作各有一条成功与一条被拒的负向用例（readonly 下写接口 403）
- [ ] **C5** 路径穿越负向用例：`../` 与软链逃逸均被拒
- [ ] **C6** `[复跑]` 能真实跑 `accept` 并把实测值写回，失败时卡片转红
- [ ] **C7** 顶栏三段数字与 `derive --json` 的 summary 一致
- [ ] **C8** 手机窄屏单列 + snap 滑动可用，六列不被挤压
- [ ] **C9** `npm run verify` = typecheck + check-deps + 单测 + 截图基线，全绿
- [ ] **C10** 启动器 `--stop` 只终止命令行匹配的 PID；不匹配时**不杀只告警**

## Gate 计划（本项目的门链）

本项目类型为 `new-surface` + `arch`，门链：**G1 需求 → G3 原型 → G4 rubric → 才开工**。

| 门 | 产出 | 状态 |
|---|---|---|
| G1 | 本文 | 待签 |
| G3 | `design/prototypes/loop-board/index.html` 可点原型（六列 + 卡片 + 顶栏 + 窄屏） | 未开始 |
| G4 | `design/design-rubric.md` 逐条签字 | 未开始 |
| G2 | `red_proof`：一个能把"列分布错乱"打红的夹具 | 未开始 |

## 待你决策

| # | 问题 | 我推荐 |
|---|---|---|
| Q1 | 项目名与路径 `E:/primary/projects/loop-board` | 保持 |
| Q2 | v1 只读优先，写回放 v2？ | **否，写回进 v1**（没有决策入口就只是仪表盘） |
| Q3 | 六列够不够？要不要第七列"已发布" | **不够，已发布落底部发版带**，不占列 |
| Q4 | 远程默认只读、且必须 token | 保持 |
| Q5 | 单深色 + shadcn token（data-guardian 那套） | 保持 |

## G1 签字

```yaml
g1:
  at: null
  by: null
  verdict: pending
  prd_hash: null
```
