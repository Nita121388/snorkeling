# RUNBOOK — 昼夜循环工作流

> 每天 3 分钟读完。规则变了就改这里，别改记忆。
> 真相源分工：`.trellis/` 管「任务是什么/怎么做」；`loop/` 管「哪个班次跑到哪、算不算过」。

## 0. 边界宣言（先读这条）

`loop/` **只**记录班次与状态迁移。判定测试：

> 一条记录删掉后 —— **未来重新实现这个功能会做错** → 它是内容，写进 `.trellis/`。
> 删掉只是**不知道当时跑到哪** → 它留在 `loop/`。

硬禁止：`loop/` 里出现函数名、文件路径、代码片段、设计理由、"今天我做了什么"。
一出现就说明写错了地方。

## 1. 班次与时间盒

| 班次 | 时段 | 干什么 | 不干什么 |
|---|---|---|---|
| AM | 09:30–10:00 | 读夜班报告 → 逐包处置（合 / 打回 / 批注） | 不开新代码 |
| PM | 10:00–17:30 | 需求确认、原型、评审、排夜班队列 | 不看 diff（除非夜色报告标 ⚠️） |
| 边界 | 17:30–18:00 | `git status --short` 必须干净 → 队列冻结 | 不临时插单 |
| NIGHT | 22:00–05:30 | agent 按队列执行 → 收尾发版 gate → 出晨报 | 不喊人、不改需求 |

## 2. 任务分类（8 类，机械判定）

判定顺序，第一条命中即停（`node loop/queue.mjs classify`）：

| 序 | 类 | 信号 |
|---|---|---|
| 1 | `bug` | 有 repro（新增 `scripts/verify/**` 或 `*.test.ts`） |
| 2 | `new-surface` | 新增 `pages/` / `views/` 文件或新入口 |
| 3 | `redesign` | 命中 `tokens.css` / `*.scss` / `components/ui/` |
| 4 | `arch` | 命中 `shared/` / `pkg/` / `package.json` / `deps-policy` |
| 5 | `docs` | 全部是 `.md` / `docs/` |
| 6 | `chore` | 全部是 lockfile / `.npmrc` / version / bump |
| 7 | `feature` | 人工标记"新增用户可见行为" |
| 8 | `fix-small` | 兜底 |

**拿不准就升级**（default up）：`fix-small → feature → new-surface`。升错只多问一次，降错做错一版。
分类在入队时冻结；夜里 agent **不得**改类，改类 = park。

## 3. 门链（H=人解，A=机器解）

| | G1 需求 | G2 器具 | G3 原型 | G4 评审 | G5 合规 | G6 方案 | G7 验收 |
|---|---|---|---|---|---|---|---|
| `bug` | — | A | — | — | — | — | H |
| `fix-small` | — | A | — | — | — | — | H |
| `docs` | — | — | — | — | A | — | H |
| `chore` | — | — | — | — | A | — | H |
| `feature` | **H** | A | — | — | A | — | H |
| `redesign` | **H** | A | **H** | **H** | A | — | H |
| `new-surface` | **H** | A | **H** | **H** | A | — | H |
| `arch` | **H** | A | — | — | A | **H** | H |

- **G1 需求确认**：`prd.md` 的「做什么 / 不做什么 / 验收判据」三段签字 → 记 `prdHash` 冻结
- **G2 器具**：必须是对**已知坏样本实测转红**的输出（不是"测试通过"）
- **G3 原型**：`design/prototypes/<slug>/` 可点原型 + 并排对照图
- **G4 评审**：`design-rubric.md` 逐条签字 → 记 `rubricHash` 冻结
- **G5 合规**：deps 白名单 + 布局规则 + 只用 token 色（机器判）
- **G6 方案**：仅 `arch`，改前交文件清单 + 计划，24h 内有效
- **G7 验收**：人；证据级别达标 + 复跑三连绿

**冻结与漂移**：G1 签的 `prdHash`、G4 签的 `rubricHash` 对不上 → 该包自动回退 `blocked:g1|g4` 并标 `drift`。

## 4. 验证优先 · 证据阶梯
| 级 | 证据 | 最低适用于 |
|---|---|---|
| L0 | 肉眼"看起来好了" | ❌ 不接受 |
| L1 | 单测红绿 | 后端/契约 |
| L2 | 真机 harness 计数（31/31） | 新功能 |
| L3 | L2 + **stash 对照**（修前红 / 修后绿） | Bug 修复 |
| L4 | L3 + 像素/几何测值 + 并排截图 | 样式缺陷 |
| L5 | rubric 逐条签字 + 每条一张证据 | 样式重设计 |

器具 = 判据 + 已知坏样本 + 校准记录。**永远绿的测试 = 零信息**。

## 5. 夜班三条铁律

1. **不许改需求**。发现 `prd.md` 有缺陷 → 只登记进晨报「需求反证」，白天改。
2. **不许喊人**。阻塞一律 `park` 入晨报；`set_calling_preference(silence)`，只在全部完成时单条推送。
3. **不许越界写**。`touch` 白名单外的写入 = 该包 abort。

park 原因只允许这五个（写进 LEDGER 的 `verdict` 字段）：
`human-wall` / `gate-reopen` / `out-of-scope` / `budget` / `flaky`。

## 6. 发版 gate（循环外，串行独占）

前置全满足才允许发版：

```bash
git status --short                                   # 必须空（package-lock 除外需说明）
node loop/queue.mjs derive --json | grep -c '"red"'  # 0
git ls-remote --tags origin | grep -oE '0\.0\.[0-9]+$' | sort -t. -k2 -n | tail -1   # 新号必须更大
```

打 tag 后**只确认 CI 已触发**（`gh run list` 出现 `in_progress` 即收工），不熬夜等构建。

## 7. 例外（有记账的欠条）

| 例外 | 可跳 | 代价 |
|---|---|---|
| `expedited`（线上事故） | G1/G3/G4 | 强制 `releaseCandidate: true` + 回滚开关必填 + 24h 内补 G1；未补则永久 `needs-retro-g1` |
| `spike`（只做原型） | 全部实现门 | 产物只能落 `design/prototypes/`；碰 `src/` 即升级为 `new-surface` 重新定类 |

## 8. 每日命令

```bash
node loop/queue.mjs list                 # 队列 + 每包门状态
node loop/queue.mjs derive --json        # 给看板 / 晨会用的派生状态
node loop/queue.mjs approve --id <id>    # 入队校验（缺门直接拒）
node loop/queue.mjs gate --id <id> --gate g1 --by nita     # 签字 + 冻结 hash
node loop/queue.mjs render               # 重生成 QUEUE.md
node loop/ledger.mjs tail -n 30          # 最近事件
node loop/ledger.mjs blocked             # 所有 parked（晨会第一屏）
node loop/ledger.mjs render              # 重生成 LEDGER.md
node loop/queue.mjs verify-ledger        # 台账自检（挂进 npm run verify）
node loop/queue.mjs inbox                # 我自己的待分诊项
node loop/queue.mjs g8                   # 沉淀门（重复问题必须先写规范）
```

## 9. 每周自检 + 三路验收

验收不是一条路，是三条。缺任何一条，夜间产出会脱节或忘记。

| 路 | 对象 | 何时 | 出口 |
|---|---|---|---|
| 一 · 包验收（对内） | 夜里跑完的包 | 每天晨会 30min | 通过 / 打回 / 批注，证据按 L0–L5 计级 |
| 二 · 四面巡检（对外） | GitHub issues、PR、社区、社媒 | 白天分诊，夜里执行 | 每条有归宿：修 / 回信 / 记录后忽略 |
| 三 · 防腐与长记性 | 技术债、恶意代码、重复犯的错 | 每周一个 `chore` 包 | 清理清单 + 教训入库 |

### 回信义务

来源不是 internal 的包（`origin` 为 issue / pr / community / social）必须带 `reply` 字段。
验收通过但未回信的包**不许归档**。这是“修完要回去说一句”的落点。

### G8 沉淀门（重复即沉淀）

```bash
node loop/queue.mjs g8      # 有重复但未沉淀 → exit 1
```

规则：同一个问题（同类 `park` / `drop` 原因）在 90 天内出现第二次，验收不通过。
必须先写一条规范：

```bash
node loop/ledger.mjs add --action note --verdict "sediment:park:human-wall" --evidence .trellis/spec/guides/xxx.md
```

流程层写 `DECISIONS.md` 一行，代码层写 `.trellis/spec/` 一条。规范条目随路径注入，下次犯同样的错时 agent 当场看见。

### 每周清单

- `loop/RUNBOOK.md` ≤ 120 行、`DECISIONS.md` ≤ 80 行、`queue.json` 包数 ≤ 60 —— 超了说明该沉淀到 `.trellis/spec/`
- `loop/ledger.mjs blocked` 是否长期非空（长期停泊的包本身就是待办）
- 器具是否长期全绿（长期绿的器具 ≈ 死器具）
- `node loop/queue.mjs g8` 是否 exit 0

## 10. 我自己的输入通道（三层摩擦）

有一条想法的时候，用什么通道取决于它有多熟。**不要用重渠道记轻想法**，那样就不记了。

| 想法熟到哪一步 | 记在哪 | 摩擦 | 怎么进流程 |
|---|---|---|---|
| 一句话，还没想清 | `loop/INBOX.md` 一行 | 5 秒 | 分诊时变成包/任务/丢弃 |
| 想清了是个改动，判据能写 | `queue.mjs add --origin self` | 1 分钟 | 直接进队列，补 g2 红证 |
| 要设计、要先问需求 | `task.py create` | 5 分钟 | 走 G1 需求确认 |

```bash
printf -- '- [ ] %s 想法\n' "$(date +%F)" >> loop/INBOX.md   # 随手记
node loop/queue.mjs inbox                                    # 看待分诊
node loop/queue.mjs triage --n 1 --to-package --type bug      # → 包
node loop/queue.mjs triage --n 1 --to-task                    # → 打印建任务命令
node loop/queue.mjs triage --n 1 --drop --reason "重复"        # → 丢弃
```

**INBOX 允许粗糙**：不分类、不写判据、不写期望值。铁律只有一条：分诊时必须三选一，没有第四条路——这就是“每条输入都有归宿”。

分诊时机：每天晨会后的 10 分钟，或睡前排夜班队列时。绝不能攒过三天。
