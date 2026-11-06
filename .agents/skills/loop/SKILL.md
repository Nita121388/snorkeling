---
name: loop
description: 昼夜循环工作流引擎（台账 / 7 道门 / 值班取件 / 验收打分 / 教训沉淀）。当用户提到 loop、台账、队列、取件、夜班、门、G1-G7、验收打分、看板数据、工作项包、park、教训沉淀时使用。
---

> 安装来源：`E:/primary/projects/loop/skills/loop/SKILL.md`（引擎自带，勿在此手改）。
> 引擎升级后重新拷贝一次即可（没有专门的同步命令）：
> `cp E:/primary/projects/loop/skills/loop/SKILL.md .agents/skills/loop/SKILL.md`

# loop — 昼夜循环工作流引擎

引擎只有一份，数据每个仓库一份。**不许自己解释「该干什么」——契约由引擎给。**

## 0. 三十秒定位

| 是什么 | 在哪 | 谁能改 |
|---|---|---|
| 引擎（代码/规则/迁移） | `/Users/nita/Primary/projects/loop` | 引擎自己的测试门（`node --test "lib/*.test.mjs"`，必须全绿） |
| 数据（台账） | `<仓库>/loop/`，本机消费者 = `projects/snorkeling` | 只由 `queue.mjs` / `ledger.mjs` 写 |
| 视图（看板） | `loop-board`，`http://127.0.0.1:7799` | 只读 `.trellis/**`，只写 `loop/**` |

命令一律走统一入口，**`--root` 只被 `bin/loop.mjs` 认**：

```bash
node /Users/nita/Primary/projects/loop/bin/loop.mjs <queue|ledger|hook-bridge> <动词> --root <仓库>
```

> 坑：直调 `node queue.mjs` **不支持** `--root`（会 exit 2 报错，不再静默返回空）。永远用 `bin/loop.mjs`。

## 1. 三个高频动作（照抄，别自己发明流程）

### ① 值班开场（每天第一件事，不许沉默）

```bash
node <engine>/bin/loop.mjs queue morning --root <仓库>   # 3 行：昨夜产出 / 等你几件 / 今晚队列
```

```bash
node <engine>/bin/loop.mjs queue pending --json --root <仓库>
```

返回 `[{id, task, type, text, at, clarify}]`。**每条必须三选一**，不许放着：

```bash
queue note     --id X --text "已处理：..." --agent <你的名字>   # 答完了
queue clarify  --id X --text "看不懂哪一块：..." --by <谁>      # 要求澄清（会 park 成 gate-reopen）
queue inbox-add --text "..." --source <来源>                    # 这条其实是新想法
```

`clarify: true` 表示用户的原话本身含歧义（看不懂/不明白/什么意思）。

### ② 取件（先看契约，再落 pick）

```bash
queue run --id X --dry-run    --root <仓库>   # 只读：打印契约，不写任何文件
queue run --id X --emit-pick  --root <仓库>   # 落 pick 事件，看板转「执行中」
```

不满足准入会 **exit 1** 并告诉你缺哪道门 / 缺什么，例如：

```
✗ 拒绝取件：T-1105-demo
  门未清：g2（no-red-proof）
  门状态：blocked:g2
```

准入四条（缺一即拒）：门 `clear`（含 g1/g4/g6 的 hash 不漂移）· 必须挂 Trellis 任务目录 · 判据每条都有 `cmd` 与 `expect` · `touch` 白名单与 `budget` 都非空。

契约首行固定 `Active task: <task>`，正文含判据/白名单/预算/重试/回滚/四条铁律，末尾给主 agent 的执行序列：

```
[pick]   ledger add --id X --action pick   --to running --shift night
[prove]  <每条判据>
[scope]  git diff --name-only
[verify] ledger add --id X --action verify --to green --evidence <probe>
[park]   ledger add --id X --action park   --verdict <reason>
```

### ③ 落账（采数字，不收自述）

```bash
queue prove  --id X --json --root <仓库>     # {"ok":true,"results":[{cmd,expect,ok,tail}]}
queue accept --id X --score 1..5 --by <谁> --note "..." --root <仓库>   # 只有人能打这个分
```

失败归类 `park` 理由（优先级从高到低）：`out-of-scope` > `gate-reopen` > `human-wall` > `flaky` > `budget`。
**判据红但还有重试次数时不许落 park**，必须重试。

## 2. 五条铁律

1. **台账只由主 agent 写**；子 agent 不写 ledger、不 commit、不动看板。
2. **不手改** `loop/items/*.md`、`loop/LEDGER-*.jsonl`（唯一写者是 queue.mjs / ledger.mjs）。
3. **不写**消费者仓库的 `.trellis/**`（唯一例外：`queue add --json '{... "createTask": true}'` 由引擎建目录）。
4. 判据必须有 `cmd` **且**有 `expect`；「跑一下看看」不算判据。
5. **门不清不取件**；**出白名单即停**；需要人拍板的事写 park，不许自己解人工门。

## 3. 出了问题先跑五个体检

| 命令 | 看什么 | 红了通常意味着 |
|---|---|---|
| `queue doctor --json` | `problems[]` | items 必填缺失 / 教训规范文件不存在 / G8 未结 / 待迁移 |
| `queue self-test` | 夹具 pass/fail | 引擎门判定坏了（`--expect=broken` 是校准：故意坏掉必须红） |
| `ledger verify-ledger` | 事件流一致性 | 台账被手改过 / 事件顺序断链 |
| `queue board --json` | `symptoms[]` | 框架自省症状（如 `queue-dry` 没可跑包、`gate-no-power` 某门没有判别力） |
| `queue introspect --to-inbox` | 自省清单 | 该给自己记一条待分诊想法 |

`board --json` 的 `symptoms[]` 每条形如 `{code, severity, evidence, means, suggest}` —— `means` 是「人话解释」，`suggest` 是「下一步看哪」。

## 4. 建包 / 分诊 / 门

```bash
queue add --json '{"id":"N-1105-07","title":"...","type":"fix-small","priority":"P1",
  "accept":[{"cmd":"npm test","expect":"pass"}],"touch":["src/**"],
  "budget":{"minutes":30},"createTask":true}' --root <仓库>

queue inbox  --root <仓库>                     # 我的随手记录（编号）
queue triage --n 3 --to-package --type bug --priority P1 --root <仓库>
queue gate   --id X --gate g2 --red-proof <证据文件> --root <仓库>
queue hash   --prd .trellis/tasks/<d>/prd.md --root <仓库>     # 签字前自己核对口径（别用裸 sha256sum）
queue drift  [--id X] --root <仓库>                            # 签字之后文件被改过没有（三态：一致/漂移/无法判定）
queue retro  --week --root <仓库>                              # 周报：产出/停泊原因/门效率/人的通道/教训
queue g8 --json --root <仓库>                  # 沉淀门：同类问题第二次必须先写规范
```

8 类任务 × 门链（H=人解 / A=机器解）：

| type | 门 |
|---|---|
| `bug` / `fix-small` | g2(H) → g7(H) |
| `docs` / `chore` | g5(A) → g7(H) |
| `feature` | g1(H) → g2(H) → g5(A) → g7(H) |
| `redesign` / `new-surface` | g1(H) → g2(H) → g3(H) → g4(H) → g5(A) → g7(H) |
| `arch` | g1(H) → g2(H) → g5(A) → g6(H) → g7(H) |

G7 不参与「能否开工」判定。H 门的凭据必须落盘含 hash（夜里 agent 上下文里没有白天的对话，口头「可以」传不过去）。

## 5. 规则的正文在哪（本 skill 只给索引，不复制正文）

| 想查什么 | 读哪 |
|---|---|
| 班次/时间盒、每日命令 | `RUNBOOK.md §1 §8` |
| 8 类分类、门链、证据阶梯 | `RUNBOOK.md §2 §3 §4` |
| 夜班三条铁律、发版 gate | `RUNBOOK.md §5 §6` |
| 教训三档、自升级、框架自省 | `RUNBOOK.md §12 §13 §14` |
| 引擎与数据分离 | `RUNBOOK.md §15` |
| 值班取件准入与契约 | `RUNBOOK.md §17` |
| 人的批注怎么被接住 | `RUNBOOK.md §18` |
| 为什么这么定（append-only） | `DECISIONS.md` |
| 能力清单（机器可读） | `node <engine>/bin/loop.mjs capabilities --json`（命令数以它的输出为准，别记数字） |
| 看板写接口 | `curl -s http://127.0.0.1:7799/api/schema` |
