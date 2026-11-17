# 实施方案（G6 凭据）

> 设计决策先于代码落在 `board/docs/adr/0004-cloud-sync.md`；本文是**文件清单与落点**，供 G6 复核边界。
> 状态：**待签**

## 文件清单（只碰这些）

| 文件 | 改动 | 为什么是它 |
|---|---|---|
| `lib/sync.mjs` | 新增 | 本切片的全部纯函数；传输层将来只 import 它 |
| `lib/sync.test.mjs` | 新增 | 19 条纯函数 + 4 条 CLI 合约断言 |
| `lib/i18n.mjs` | +2 张表 | 状态词/方式词的中英文案（领域名词的单一实现） |
| `lib/i18n.test.mjs` | 扩 | 把 `SYNC_STATES` / `SYNC_MODES` 与文案 key 双向对账 |
| `lib/capabilities.mjs` | +1 条 | `queue sync` 登记（漏登记即红，已有对账门） |
| `queue.mjs` | +`cmdSync` / `loadSyncConfig` | CLI 入口；顺带修 `createTask` 缺 `--description` |
| `RUNBOOK.md` | +1 行 | §8 每日命令加 `queue sync status` |

不改：`LEDGER-*.jsonl` 格式、`items/*.md` 结构、看板前端、任何依赖。

## 落点与顺序

1. `isSyncedPath` / `manifest` / `diffManifests` —— 先定「搬什么」和「差多少」。
2. `mergeEventLines` —— 台账并集；去重键用**稳定序列化后的 sha256**，不用原始行（键序不同也要算同一条）。
3. `normalizeSyncConfig` —— token 只存变量名，不落配置文件；坏配置收进 `problems[]` 不抛。
4. `syncState` —— 六态，判定顺序 `off > syncing > offline(连败) > error > offline(超时) > pending > idle`。
5. `buildSyncStatus` —— 把配置 + 水位 + 清单合成一个可以直接喂给看板的形状。
6. `queue sync status` —— 只读；`--json` 给看板与 agent，文本给人。

## 已知边界

- `mergeEventLines` 只做并集与稳定排序，不做跨机器因果推断（一仓一写者是前提）。
- `syncState` 的阈值（2× / 5× 间隔、连败 3 次）写在函数签名里，看板不许自己算第二份。
- 水位文件 `loop/.sync-state.json` **不在同步白名单内**：同步自己的进度条没有意义。
- 本切片结束时 `state` 只会是 `off` 或 `pending`：没有传输层，`pending` 表示「还没同步过」，不是故障。

## 回滚

纯新增 + 一处 `switch` 分支 + 一张表登记：`git revert` 单提交即可；`sync.config.json` 不存在时行为与改造前完全一致（都是本地模式）。

## 顺带修的真 bug

`createTrellisTask` 调 `task.py create` 时没传 `--description`，而当前版本 task.py 要求它必填 —— 也就是说 `queue add --create-task` 对现版本**必然失败**。本切片需要建任务目录，所以在这里修（1 行）。
