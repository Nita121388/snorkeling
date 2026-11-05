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
