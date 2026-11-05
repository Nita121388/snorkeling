# implement.md — 执行计划

> 前置：G1 已签（`prd_hash 76c2fcfdf546`）。设计见 `design.md`。
> 每个步骤自带验证命令；**验证不绿不进下一步**。

## 环境自检（首次）

```bash
node --version                                  # 需 ≥ 20（用到 node:test / fs.appendFile 稳定行为）
git -C . status --short .trellis                # 允许有本任务目录
```

---

## T1 loop/ 骨架 + 台账文档

**产出**
- `loop/RUNBOOK.md`（门×类矩阵、分类规则、证据阶梯、夜班纪律、发版 gate、例外）
- `loop/DECISIONS.md`（D1–D11 固化 + 后续流程决策追加位）
- `loop/queue.json`（v1 空骨架，含首个包占位）
- `loop/.gitignore`（忽略 `.hook-errors.log`、`.state-cache.json`）

**验证**
```bash
node -e "JSON.parse(require('fs').readFileSync('loop/queue.json','utf8'))" && echo queue-json-ok
grep -c "^## " loop/RUNBOOK.md        # ≥ 6 个必需小节
```

---

## T2 门引擎 + 状态折叠（纯函数，先测后用）

**产出**
- `loop/lib/gates.mjs`：`GATE_MATRIX` / `GATE_ORDER` / `HUMAN_GATES` / `evaluateGates(pkg, hashes)` / `gateStateOf(...)`
- `loop/lib/derive.mjs`：`deriveRunStates(events)` 折叠；`deriveAll(events, queue)`
- `loop/lib/hash.mjs`：`prdHash(taskDir)`（截到 `## G1 签字`）/ `fileHash(path)`
- `loop/lib/paths.mjs`：`safeResolve(repoRoot, p)`（resolve + 越界拒绝 + realpath）

**验证**
```bash
node --test loop/lib/*.test.mjs
# 期望：gates 12+ / derive 8+ / paths 5+ 全绿
node --test loop/lib/gates.test.mjs 2>&1 | grep -E "^# (pass|fail)"   # fail 0
```

**门（review gate）**：负向用例必须存在且为红（缺凭据 → `blocked:g1`；hash 不符 → `drift`）。

---

## T3 `queue.mjs`（唯一 queue 写者）

**子命令**
```
classify [--base <ref>] [--json] [--hint type=x] [--uncertain]
add --id <id> --task <taskdir> --type <t> [--order N]
gate --id <id> --gate g1 --by <who> [--verdict confirmed]
approve --id <id>            # 入队前置校验
list [--json]
derive [--json]
override-type --id <id> --type <t> --by <who>
drop --id <id> --reason <text>
verify-ledger
self-test
```

**关键实现点**
- `approve` = 门准入：`gateStateOf()` 非 `clear` → 拒绝并打印缺哪道门 + `exit 1`（对应 C8）
- `gate --gate g1` 在写凭据的同时，给 `.trellis/tasks/<task>/prd.md` 顶部写 `Confirmed:` 行（唯一允许写 `.trellis` 的路径，写入前校验 `^\.trellis/tasks/[^/]+/prd\.md$`）
- `queue.json` 写：临时文件 + `rename` 原子替换
- 任何子命令都**不调用** `git` / `task.py` 的写子命令

**验证**
```bash
node loop/queue.mjs self-test                     # 期望 "16+ passed"
node loop/queue.mjs classify --json               # 结构含 type/signals
node loop/queue.mjs approve --id __nonexistent; echo "expect-exit=1 got=$?"
```

---

## T4 `ledger.mjs`（事件流）

**子命令**
```
add --id <id> --action <a> --to <state> [--from <s>] [--shift night] [--evidence <ptr>] [--commit <sha>]
tail [-n 50] [--json]
render                     # 生成 loop/LEDGER.md（含 generated 头，禁止手改）
self-test
```

**实现点**
- 文件名按事件 `ts` 的月份分卷：`LEDGER-2026-11.jsonl`
- 追加前做单行 JSON 序列化（无换行字符），`appendFile`
- `render` 输出两张表：进行中 + 近 14 天 released

**验证**
```bash
node loop/ledger.mjs self-test                    # 期望 "12+ passed"
node loop/ledger.mjs tail -n 3 --json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);Array.isArray(a)&&console.log('ledger-tail-ok',a.length)})"
```

---

## T5 钩子桥（自动记账）

**产出**
- `loop/hook-bridge.mjs`（事件映射 + 幂等 + 异常吞掉写 `.hook-errors.log`）
- `.trellis/config.yaml` 的 `hooks:` 段（注册表就是它；`.trellis/hooks.local.json` 是 linear_sync 私有配置，不是注册表）

**验证**
```bash
# 用假 TASK_JSON_PATH 驱动，不碰真实任务状态
TASK_JSON_PATH=$(pwd)/.trellis/tasks/11-05-day-night-loop/task.json node loop/hook-bridge.mjs started
node loop/ledger.mjs tail -n 1 --json            # 末行 action=start shift=hook
# 幂等：1 分钟内重复触发不应重复记
TASK_JSON_PATH=$(pwd)/.trellis/tasks/11-05-day-night-loop/task.json node loop/hook-bridge.mjs started
node loop/ledger.mjs tail -n 5 --json            # 断言 start 事件仅 1 条
```
**实测**：建一个临时任务跑 `create → start → archive` 三次迁移，确认 LEDGER 有记录（C5）。

---

## T6 生成物 + 校验挂载

**产出**
- `loop/QUEUE.md`（由 `queue.mjs render` 生成）
- `npm run verify` 增补（在 `package.json` scripts 里加 `verify:loop`，不侵入既有 verify）
- `.gitignore` 增补生成物缓存

**验证**
```bash
node loop/queue.mjs render && head -5 loop/QUEUE.md
node loop/queue.mjs verify-ledger && echo ledger-ok
```

---

## T7 既有 harness 全部登记 `red_proof`（C6）

对 4 个 harness 各跑一次"已知坏样本"路径，把**实测输出**写进对应包的 `gates.g2.redProof`：

```bash
node scripts/verify/preview-edit/run.mjs --legacy-css --expect=broken   # 期望红
node scripts/verify/vcs-tree-status/verify.mjs --attach                 # 期望 31/31
node scripts/verify/image-pager/verify.mjs --attach                     # 期望 30/30
node scripts/verify/overview-board/verify.mjs --attach                  # 期望 18/18
```
> 前两个需要运行中的隔离 Electron 实例；起不来的先把命令与期望登记，标 `pending-env` 并进晨报。

---

## T8 RUNBOOK 补齐 + 首次真实夜班（C9）

- 补齐 `RUNBOOK.md` 的发版 gate 与例外条款
- 选 3 个零人工门类型的包，跑一次真实夜班
- 产出 `loop/REPORTS/<date>.md`（固定 5 段：结论 / 包状态表 / 阻塞清单 / 需求反证 / 发版）

**验证**
```bash
test -f loop/REPORTS/$(date +%F).md && grep -c "^## " loop/REPORTS/$(date +%F).md   # ≥5
node loop/queue.mjs derive --json | node -e "..."   # 无包处于 running（夜班已收尾）
```

---

## T0 清账（独立子任务，不阻塞 T1–T8）

46 → ≤22：对每个候选跑"git log + 源码存在性 + task.json 状态"三方核对，逐个 `task.py archive`（或保留待办）。
**本文件只登记流程，具体归档清单必须人工过一遍**（PRD C7 / G1 提醒）。

---

## 回滚点

| 步骤 | 回滚 |
|---|---|
| T1–T6 | `rm -rf loop/` + `git checkout package.json .gitignore`（不触碰 `.trellis` 与本任务文档） |
| T5 | 删 `.trellis/hooks.local.json` 即摘除钩子；`loop/` 保留 |
| T7 | 仅 `queue.json` 字段，`git checkout loop/queue.json` |
| 任何步骤 | 任务文档（prd/design/implement）不受影响，可重跑 |

---

## 交付后需人工过目（G7 验收）

- `loop/RUNBOOK.md` 是否 3 分钟能读完
- `node loop/queue.mjs derive --json` 的输出是否能让看板直接渲染（字段够不够）
- 首次夜班晨报是否 30 分钟内可处置完
