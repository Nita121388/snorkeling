---
description: loop/ 台账的执行契约——单一写者、两维状态、hash 冻结、校准要求、教训与自升级
paths:
  - loop/**
  - .trellis/spec/guides/**
  - .trellis/tasks/**
---

# 昼夜循环工作流（loop 台账）— 执行契约

> 操作手册在 `loop/RUNBOOK.md`（每天读的那份）。本文件只记**不可协商的契约**，供改 `loop/` 代码时对照。

## 三条硬契约

1. **单一写者**
   - `.trellis/**`：只由 `task.py` 与 `queue.mjs gate --gate g1`（写 `Confirmed:` 一行）写。白名单见 `loop/lib/paths.mjs`。
   - `loop/queue.json`：只由 `loop/queue.mjs` 写（临时文件 + `rename` 原子替换）。
   - `loop/LEDGER-*.jsonl`：只由 `queue.mjs` / `ledger.mjs` / `hook-bridge.mjs` 追加（`appendFile`，单行 < 4KB）。
   - `QUEUE.md` / `LEDGER.md`：**生成物**，手改会被下次 render 覆盖。

2. **状态是两个正交维度**
   - `gateState`（`clear` / `blocked:g1..g6`）：由 `gates.mjs` 从凭据 + 实时 hash 推导。
   - `runState`（`idle|queued|running|green|red|parked|committed|accepted|released|dropped`）：由 LEDGER 折叠（`derive.mjs`）。
   - **不要**把两者合成一个大状态机；G7 是终态门，不参与"能否开工"。

3. **冻结靠 hash，不靠时间戳**
   - `prdHash` = sha256(`## Goal` … `## G1 签字` 之前)。锚 `## Goal` 是为了让签字动作本身（头部加 `Confirmed:` 行）不改 hash。
   - `planHash` / `rubricHash` 用 `fileHash()`（CRLF→LF 归一 + trimEnd）。**不要**用 `sha256sum` 手算，两者结果不同。
   - 漂移 = hash 不匹配 → 该门自动降级并标 `drift`。

## 校准要求（验证优先）

`loop/queue.mjs self-test --expect=broken` 必须**转红**（当前：43 通过 / 12 失败）。
它把 `LOOP_SLOPPY=1` 注入引擎让所有门判为满足 —— 若此时夹具仍然全绿，说明夹具是假仪器。
新增门或改判定时，这个数字必须>0，也是包的 `gates.g2.redProof` 的写法来源。

## 钩子

注册表是 `.trellis/config.yaml` 的 `hooks:` 段（`shell=True` + `cwd=repo_root` + `TASK_JSON_PATH`，fail-open）。
`.trellis/hooks.local.json` 是 `hooks/linear_sync.py` 的私有配置，**不是**注册表。
`hook-bridge.mjs` 任何异常都必须 `exit 0` 并写 `loop/.hook-errors.log`，否则会拖坏 `task.py`。

## 改动后的必跑清单

```bash
node --test "loop/lib/*.test.mjs"                    # 纯函数
node loop/queue.mjs self-test                        # 夹具（正向）
node loop/queue.mjs self-test --expect=broken        # 校准（必须红）
node loop/ledger.mjs self-test                       # 事件流（沙箱 tmpdir，不污染真台账）
node loop/queue.mjs verify-ledger                     # 台账可解析
```

## 教训条目（索引在 loop/LESSONS.md）

### L-0001 prd_hash 必须锚 `## Goal`

首版规则是「`## G1 签字` 之前全部内容」，签完字在头部补一行 `Confirmed:` 就把自己的 hash 销毁了（当场实测到 DRIFT）。
现在 `prdHash()` 从 `## Goal` 起切到 `## G1 签字` 前，头部元信息与签名字段都不计入。
**任何新增的 hash 冻结都要先问一句：签字这个动作本身会不会改变被 hash 的区间。**

### L-0002 解析失败不能静默返回空

`loadStore()` 早期版本在 `gates.json` 解析失败时返回空对象，等于「夜间队列被静默清空」。
现在回退 `.gates.last-good.json` 并告警；没有快照才抛错。
**任何读队列/规则/配置的入口都必须有 last-good 回退或硬失败，二者选一，不许装作空。**

### L-0001 续（2026-11-05 第二次复发）

`rubric_hash` 再次踩同一个坑：在**同一个提交里**给 rubric 追加评审记录，然后又写 hash —— 签字内容与 hash 对不上，
引擎 `hashMismatch` 直接判 drift，G4 凭据不可验证。评审组第三次复核时抓到。

两条硬规则（写进肌肉记忆）：

1. **hash 永远在最后一次编辑之后取**。凡是要在签完字后追加内容（评审记录、确认行、备注），必须把它放在 hash 覆盖区间**之外**，或者取 hash 之后再单独提交。
2. **hash 只能由引擎函数产出**：`lib/hash.mjs` 的 `fileHash()` / `prdHash()`（CRLF 归一 + trimEnd）。
   裸 `sha256sum` 与引擎口径不同，两者混用会让同一份文件出现两个"正确"的 hash。

### L-0005 loop 命令的未知 flag 被静默忽略：**预检 ≠ 只读**

2026-11-12 实测：`queue gate --id X --gate g1 --by nita --dry-run` —— `gate` 根本没有 `--dry-run`，
未知 flag 被当空气，命令**真的把 g1 签了**（并往 prd.md 写了 `Confirmed:` 行），等于主 agent 伪造人门凭据。

三条硬规则：

1. **只读预检只许用 `queue list / show / derive / board --json`。** `gate / add / run --emit-pick / accept / drop / lead` 全是写操作，不要带猜测性 flag 去"试一下"。
2. **`gate` 的 `--by` 必须是人手给出的那一刻**；agent 只有在用户当次对话里明确说过「可以/开工/签字」时才能代录，且必须在验收记录写清来源原话。夜里没有这句话 → 包保持 `blocked:g1`，不是「想办法让它 clear」。
3. **误签的补救路径 = `queue drop` + 重建新 id**（`gates.json` / ledger 不手改）。drop 理由必须写清误签原因；被写进 prd.md 的 `Confirmed:` 行要一并删除（它不在 hash 区间内，删了不改 hash）。
