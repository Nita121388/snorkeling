# design.md — 昼夜循环工作流（loop 台账 + 门引擎）

> 前置：`prd.md` G1 已签（prd_hash `76c2fcfdf546`，2026-11-05 @nita）。
> 本文只讲**怎么实现**；需求与验收判据在 `prd.md`，不在本文重复。

---

## 1. 总体形状

```
                ┌──────────────────────────── .trellis/（Trellis 托管，永不写） ─────────────┐
                │  tasks/*/prd.md   tasks/*/task.json   hooks.local.json                     │
                └───────▲──────────────────────────┬──────────────────────┬──────────────────┘
        G1 签字写一行   │                          │ 只读扫描              │ after_* 钩子
                        │                          ▼                      ▼
┌───────────────────────┴───────────────────────────────────────────────────────────────────┐
│ loop/  （本仓库自有，trellis update 冲不掉）                                              │
│  queue.json          包定义 + 门凭据（人/看板写）                                          │
│  LEDGER-YYYY-MM.jsonl 事件流（append-only，机器写）                                        │
│  QUEUE.md / LEDGER.md 生成物（禁止手改）                                                   │
│  gates.mjs   classify.mjs   derive.mjs   queue.mjs   ledger.mjs   hook-bridge.mjs          │
│  RUNBOOK.md  DECISIONS.md  REPORTS/<date>.md                                               │
└───────┬───────────────────────────────────────────────────────────────────────────────────┘
        │ 三个只读 CLI（--json）
        ▼
   loop-board（独立项目，只消费、不解析内部结构）
```

三层各只有一个写者，避免多写者打架：

| 层 | 唯一写者 | 其他角色 |
|---|---|---|
| `.trellis/**` | `task.py` / 人 | 本系统**只读** |
| `loop/queue.json` | `queue.mjs`（人/看板/agent 都经过它） | — |
| `loop/LEDGER-*.jsonl` | `queue.mjs`（门/验收事件）+ `hook-bridge.mjs`（Trellis 事件）+ `run` 执行器（执行事件） | — |

---

## 2. 关键设计：状态用**两个正交维度**，不用一个大状态机

把 13 个状态塞进一个枚举会立刻爆炸（`blocked:g3-and-running` 这种组合无解）。所以拆成：

### 2.1 `gateState` —— 由 `queue.json` 的 `gates{}` + 实时 hash 校验推导

```
blocked:g1 | blocked:g2 | blocked:g3 | blocked:g4 | blocked:g6 | clear
```

规则：按门的顺序取**第一个**未满足的门（G1→G2→G3→G4→G5→G6）。`drift` 也算未满足。

### 2.2 `runState` —— 由 LEDGER 事件流**折叠**（replay）得出

```
idle | queued | running | green | red | parked | committed | accepted | released | dropped
```

`parked` 附带 `parkReason ∈ {human-wall, gate-reopen, out-of-scope, budget, flaky}`。

### 2.3 看板列 = f(gateState, runState)

| 列 | 条件 |
|---|---|
| 🚧 未就绪 | `gateState ≠ clear`，按门分组 |
| 🌙 今晚队列 | `clear` 且 `runState ∈ {idle, queued}` |
| ⚙️ 执行中 | `runState = running` |
| ✅ 待验收 | `runState ∈ {green, committed}` |
| 📦 待发池 | `runState = accepted` |
| ⏸ 停泊横幅 | `runState = parked`（不进列） |

**收益**：新增一道门只改 `gateState` 计算，不动状态机；LEDGER 可以任意回放重建状态。

---

## 3. `queue.json` schema（v1）

```jsonc
{
  "version": 1,
  "project": "snorkeling",
  "packages": [
    {
      "id": "N-1105-loop-skeleton",          // 稳定 ID，永不复用
      "task": "11-05-day-night-loop",        // Trellis 任务目录名（唯一跨系统引用）
      "title": "loop 台账骨架",               // 人读；允许漂移，不参与判定
      "type": "arch",                        // 8 类之一；冻结后不可由 agent 改
      "typeSource": "classify",              // classify | override
      "overriddenBy": null,                  // {at, by, from} 覆写留痕
      "order": 10,                           // 列内排序
      "accept": [                            // 判据：命令 + 期望（数字/字面）
        { "cmd": "node loop/queue.mjs self-test", "expect": "16 passed" },
        { "cmd": "node loop/ledger.mjs self-test", "expect": "12 passed" }
      ],
      "touch": ["loop/**"],                  // 路径白名单（glob，相对仓库根）
      "rollback": "rm -rf loop/ && git checkout loop/",
      "budget": { "minutes": 40, "retries": 2 },
      "gates": {
        "g1": { "at": "2026-11-05T09:36", "by": "nita", "verdict": "confirmed", "prdHash": "76c2fcfdf546" },
        "g2": { "redProof": "node loop/queue.mjs self-test --expect=broken → 3 failed @ abc1234" },
        "g6": { "at": "2026-11-05T09:50", "by": "nita", "verdict": "confirmed", "planHash": "e11f0a3b" }
      },
      "releaseCandidate": false,
      "createdAt": "2026-11-05T09:36"
    }
  ],
  "dropped": [ { "id": "...", "reason": "..." } ]
}
```

**约束**：`accept[].expect` 必须能字符串比对（`"16 passed"` / `"<=69"` / `"31/31"`），禁止自然语言。`touch` 必须非空（否则等于无边界）。

---

## 4. `LEDGER-YYYY-MM.jsonl` schema

固定 9 字段，顺序无关，一行一个事件：

```jsonc
{"ts":"2026-11-05T22:14:03Z","shift":"night","task":"11-05-day-night-loop",
 "id":"N-1105-loop-skeleton","action":"pick","from":"queued","to":"running",
 "evidence":null,"commit":null,"verdict":null}
```

- `action ∈ {create,start,archive,pick,verify,commit,accept,release,park,drop,note}`
- `shift ∈ {am, pm, night, hook}`（`hook` 由 Trellis 钩子写入，与班次无关）
- `from/to` 使用 §2.2 的 `runState`；`null` 表示不迁移
- `evidence` 只放指针：`loop/REPORTS/2026-11-05.md#L12` / `gh:run/123` / `prd.md`
- `commit` 短 SHA 或 tag 名

**原因**：JSONL append-only 天然支持多写者、可被 `grep`/`jq` 消费、可整段回放重建状态；Markdown 表格多写者必冲突。

---

## 5. 门引擎（`gates.mjs`）

### 5.1 类型 → 门集（代码内常量，不进 queue.json）

```js
export const GATE_MATRIX = {
  'bug':         ['g2', 'g7'],
  'fix-small':   ['g2', 'g7'],
  'docs':        ['g5', 'g7'],
  'chore':       ['g5', 'g7'],
  'feature':     ['g1', 'g2', 'g5', 'g7'],
  'redesign':    ['g1', 'g2', 'g3', 'g4', 'g5', 'g7'],
  'new-surface': ['g1', 'g2', 'g3', 'g4', 'g5', 'g7'],
  'arch':        ['g1', 'g2', 'g5', 'g6', 'g7'],
};
export const GATE_ORDER = ['g1','g2','g3','g4','g5','g6','g7'];
export const HUMAN_GATES = new Set(['g1','g3','g4','g6']);
```

### 5.2 每道门的满足判定

| 门 | 满足条件 | 备注 |
|---|---|---|
| g1 | `verdict==='confirmed'` 且 `prdHash === sha256(prd.md 的 `## Goal` … `## G1 签字` 之前)` | 不等 → `drift` |
| g2 | `redProof` 非空 | 内容是实测输出，人不复核 |
| g3 | `verdict==='confirmed'` 且 `ref` 目录存在 | |
| g4 | `verdict==='confirmed'` 且 `rubricHash === sha256(design-rubric.md)` | 不等 → `drift` |
| g5 | `compliance.executedAt` 存在且 `ok===true` | 由 `verify` 命令写 |
| g6 | `verdict==='confirmed'` 且 `planHash === sha256(implement.md)` 且 `at` 在 24h 内 | 过期 → 重新确认 |
| g7 | LEDGER 折叠出 `accepted` | 人做的，不在 queue.json |

### 5.3 漂移检测

**为什么用 hash 而不是 mtime**：mtime 在 checkout / 复制 / 硬链接下不可靠，且无法区分注释改动。hash 覆盖"签字时看到的内容"，改一个标点即失效——这符合"签字是签内容"的语义。

`prd_hash` 的覆盖面是 **`## Goal` 起、到 `## G1 签字` 之前**（实现于 `lib/hash.mjs` 的 `prdHash()`）：
排除头部元信息（状态行 / `Confirmed:` 行）与签名字段自身；否则签字这个动作本身就会让 hash 失效。
> 实测过这个坑：首版规则是“`## G1 签字` 之前全部内容”，签完在头部补一行 `Confirmed:` 就把自己的 hash 销毁了。
> 已修正为锚定 `## Goal`，并登记进 `DECISIONS.md`。

---

## 6. 分类器（`classify.mjs`）

### 6.1 输入信号（全部来自 git，不引入 AI）

```js
{
  changedFiles: ['frontend/app/x.tsx', ...],   // git diff --name-only <base>...HEAD + 工作区
  addedFiles:   ['frontend/app/view/y.tsx'],   // git diff --diff-filter=A
  hasRepro:     true,                          // 命中 scripts/verify/**/ 或 *.test.ts 新增
  hints:        { type: 'redesign' }           // 可选人工提示
}
```

### 6.2 规则序列（第一条命中即返回）

```js
const RULES = [
  ['bug',         s => s.hasRepro && s.addedFiles.some(f => /scripts\/verify|\.test\.ts$/.test(f))],
  ['new-surface', s => s.addedFiles.some(f => /frontend\/app\/.*\/(pages|views?)\//.test(f))],
  ['redesign',    s => s.changedFiles.some(f => /(tokens\.css|\.scss$|components\/ui\/)/.test(f))],
  ['arch',        s => s.changedFiles.some(f => /(shared\/|pkg\/|package\.json$|deps-policy)/.test(f))],
  ['docs',        s => s.changedFiles.every(f => /(\.md$|docs\/|\.trellis\/)/.test(f))],
  ['chore',       s => s.changedFiles.every(f => /(package-lock\.json$|\.npmrc$|version)/.test(f))],
  ['feature',     s => s.hints.behaviorChange === true],
  ['fix-small',   s => true],   // 兜底
];
```

**default up**：`fix-small`（0 门）是兜底，所以"拿不准"必须**显式升级**——实现为：若 `hints.uncertain === true`，把结果向上一档（`fix-small→feature`、`feature→new-surface`、`redesign→new-surface`）。

### 6.3 冻结

分类只在**入队时**执行一次并写入 `type`。之后 `classify` 不再被调用（除非人工点"重新分类"）。

---

## 7. 钩子桥（`hook-bridge.mjs`）

### 7.1 配置（`.trellis/config.yaml` 的 `hooks:` 段）

```yaml
hooks:
  after_create:  ["node loop/hook-bridge.mjs created"]
  after_start:   ["node loop/hook-bridge.mjs started"]
  after_archive: ["node loop/hook-bridge.mjs archived"]
```

> **修正（2026-11-05 实测）**：钩子注册表是 `.trellis/config.yaml` 的 `hooks:` 段（`common/config.py:get_hooks`，`shell=True` + `cwd=repo_root` + `TASK_JSON_PATH` env，fail-open 带超时）。
> `.trellis/hooks.local.json` 是 `hooks/linear_sync.py` **自己的**私有配置，**不是**钩子注册表——首版设计写错了，已改。

### 7.2 事件映射（读 `TASK_JSON_PATH` env）

| 钩子事件 | LEDGER `action` | `from`→`to` | 说明 |
|---|---|---|---|
| created | `create` | `null`→`idle` | 任务出现在 Trellis |
| started | `start` | `idle`→`queued` | 开始规划/实现（不代表夜里在跑） |
| archived | `archive` | 当前→`released` 或 `dropped` | 归档即收尾 |

### 7.3 健壮性

- **绝不失败到影响 task.py**：任何异常 → 写 `loop/.hook-errors.log` + `exit 0`。
- **幂等**：同一 `(task, action, ts 到分钟)` 已存在则跳过（防止重试/重复触发）。
- **未知任务**：`queue.json` 里没有对应包 → 仍然写 LEDGER（`id: null`），因为"任务出现"本身是事实。

---

## 8. 三个只读 CLI（给 loop-board 的契约）

```bash
node loop/queue.mjs list --json      # → [{id, type, gateState, blockedBy, order, ...}]
node loop/queue.mjs derive --json    # → {packages:[{id, gateState, runState, parkReason, drift}]}
node loop/ledger.mjs tail --json -n 50   # → 最近 N 条事件
```

**为什么让看板走 CLI 而不是直读文件**：`gateState`/`runState` 是派生值，逻辑在 `gates.mjs` + `derive.mjs`。如果看板自己算，就会有两份实现并逐渐分叉（参考项目里 `device-names` 三种实现靠契约测试才没分叉，那是被动防御）。CLI 输出即契约，看板只渲染。

性能：包数 < 100，全量 derive < 10ms，无需缓存。若 `LEDGER` 超过 2000 行再加 `.state-cache.json`（按文件列表 + size 失效）。

---

## 9. 夜班执行器契约（本任务只定义，v1 由人/agent 按 RUNBOOK 执行）

- 顺序：`packages` 按 `order`，跳过 `gateState ≠ clear` 与 `runState ∈ {parked, accepted, released, dropped}`。
- abort 条件（写 `park` 事件，原因枚举）：
  - 写白名单外文件 → `out-of-scope`
  - 发现需要人工拍板 → `gate-reopen`
  - 需要登录/验证码/真机点击 → `human-wall`
  - 预算耗尽 / 重试 2 次仍红 → `budget`
  - 测试非确定性 → `flaky`
- 发版是**循环外**独立步骤（见 RUNBOOK §发版 gate），不进包循环。

---

## 10. 安全边界

| 边界 | 实现 |
|---|---|
| 不写 `.trellis/**` | `queue.mjs` 唯一例外是给 `prd.md` 写 `Confirmed:` 一行；写入前校验目标路径以 `.trellis/tasks/` 开头且以 `/prd.md` 结尾 |
| 路径穿越 | 所有相对路径 `path.resolve(repoRoot, p)` 后必须 `startsWith(repoRoot + sep)`，再 `realpath` 复核 |
| 破坏性操作 | `queue.mjs` 永不调用 `git` / `task.py` 的写子命令；归档只生成命令文本 |
| 原子写 | `queue.json` 写临时文件 + `rename`（同盘原子）；LEDGER 用 `appendFile`（单行 < 4KB） |

---

## 11. 失败模式与对策

| 失败模式 | 对策 |
|---|---|
| 钩子未触发（配置漏写/平台不支持） | `derive` 时对比 `.trellis/tasks/*/task.json` 的 `status/commit` 与 LEDGER 最新状态；不一致 → 顶栏告警 `hook-gap: N` |
| 漂移误报（改了注释但语义没变） | 接受。签字是签内容；误报代价只是重新确认一次 |
| 分类错（`fix-small` 实际是 feature） | `touch` 白名单兜底：一旦写出界即 abort；人工可覆写并留痕 |
| LEDGER 被手改 | `queue.mjs verify-ledger` 校验每行可 JSON 解析 + 必填字段齐全；挂进 `npm run verify` |
| 多写者并发 | queue.json 走第 10 节原子写；LEDGER 单行追加；冲突时后写者胜并留 `note` 事件 |
| 看板与台账分叉 | 看板只走 §8 的三个 CLI，不直读派生逻辑 |

---

## 12. 权衡记录

| 选择 | 放弃的方案 | 理由 |
|---|---|---|
| 文件 + JSONL | SQLite | 30 个包、每晚几十行事件，查询需求极低；文件的 diff/回滚/审阅价值远超性能收益。且参考项目已证明 `node:sqlite` 只在数据量大时才值得 |
| 两个正交状态维度 | 单一状态枚举 | 门×运行 的组合会爆炸；正交后看板列是纯函数 |
| hash 冻结 | mtime 冻结 | mtime 在 checkout/copy 下不可靠，且无法区分语义改动 |
| classify 用 git 信号 | classify 用 AI | 判据必须可复现、可测试、零 token；AI 判错无法复核 |
| CLI 给看板输出 | 看板直读文件 | 派生逻辑只有一份实现，避免分叉 |
| `loop/` 放仓库根 | 放 `.trellis/` | `trellis update` 覆盖 + `archive` 搬走目录 |

---

## 13. 测试策略

| 对象 | 方式 |
|---|---|
| `classify` | 夹具表：8 类各 2 例 + 3 例"拿不准升级" + 2 例多信号取先序 = **16+ 用例** |
| `gates` | 正向（全凭据齐 → clear）+ 负向（缺 g1 → `blocked:g1`；hash 不符 → `drift`）= **12+ 用例** |
| `derive` | 给定 LEDGER 序列 → 期望 runState 序列（含 park/重试/回放幂等） |
| `hook-bridge` | 用假 `TASK_JSON_PATH` 驱动，断言 LEDGER 末行 + 重复触发幂等 + 异常不退出非 0 |
| `queue` CLI | `--json` 输出结构快照（字段名与类型） |

全部用 `node --test`（内置，零依赖）。

---

## 14. 落地顺序（对应 implement.md）

1. `loop/` 目录 + `RUNBOOK.md` + `DECISIONS.md` + `queue.json` 空骨架
2. `gates.mjs` + `derive.mjs` + 自测
3. `queue.mjs`（classify / gate / list / derive / verify-ledger）+ 自测
4. `ledger.mjs`（add / tail / render / self-test）+ 自测
5. `hook-bridge.mjs` + `hooks.local.json` + 实测 3 次迁移
6. `QUEUE.md` / `LEDGER.md` 生成 + `.gitignore` 缓存
7. 4 个既有 harness 登 `red_proof`
8. `RUNBOOK.md` 补齐门×类矩阵 / 证据阶梯 / 发版 gate / 例外
