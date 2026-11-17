---
id: N-1117-gates-race
title: "门凭据并发写互相覆盖：gates.json 拆成一个包一份文件"
type: bug
priority: P0
severity: S1
status: open
origin: internal
source: "ADR 0004 §10；2026-11-17 并发夹具实测 10 轮丢 6 次"
task: null
order: 5
touch: ["E:/primary/projects/loop/lib/queue-io.mjs", "E:/primary/projects/loop/lib/queue-store.mjs", "E:/primary/projects/loop/lib/queue-io.test.mjs", "E:/primary/projects/loop/lib/capabilities.mjs", "E:/primary/projects/loop/queue.mjs", "E:/primary/projects/snorkeling-agent-control/loop/migrations/**", "E:/primary/projects/snorkeling-agent-control/loop/VERSION"]
rollback: "git revert 单提交；迁移前备份在 loop/.backup/<ts>/gates.json"
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-17T06:18:44Z"
---

# 门凭据并发写互相覆盖：gates.json 拆成一个包一份文件

## 背景

gates.json 是整文件读改写：saveQueue 把内存里的全量 gates 写回。两个 queue 进程并发时后写的赢，别人刚签的门凭据静默消失。夹具实测 10 轮丢 6 次。夜里 agent 签门 + 看板点写按钮就会触发（看板动作也是 spawn 一个 node 进程，窗口约 600ms）。这也是云同步的前置：多机写同一份整文件必然丢数据。

## 来源

- internal：ADR 0004 §10；2026-11-17 并发夹具实测 10 轮丢 6 次

## 验收判据

- [ ] `node --test "E:/primary/projects/loop/lib/queue-io.test.mjs"` → `# fail 0`
- [ ] `node --test "E:/primary/projects/loop/lib/*.test.mjs"` → `# fail 0`
- [ ] `node "E:/primary/projects/loop/bin/loop.mjs" queue upgrade --dry-run --root .` → `schema 已是最新 v3`
- [ ] `node "E:/primary/projects/loop/bin/loop.mjs" queue verify-ledger --root .` → `ledger ok`

## 记录

- 2026-11-17 修完：`gates.json` → `loop/gates/<id>.json` + `saveStore` 只写「本进程真的改过」的包。
- 红样确定性那条（进程内交错）修前 1/1 丢凭据、修后 1/1 保留；真机并发观测 1/10~6/10 波动，只当佐证（启动抖动），不拿它当判据。
- 顺带发现两个真 bug：① `cmdUpgrade` 用 `import('./migrations/…')` 解析到**引擎**目录，消费者自己的迁移永远 import 不到；② `createTrellisTask` 调 `task.py create` 没传 `--description`（现版本必填），`queue add --create-task` 对现版本必然失败。
- 迁移已在 `snorkeling-agent-control` 落地（VERSION 2→3，12 份凭据），迁移前后 `queue board --json` 逐字节相等；旧文件在 `loop/.backup/gates-v2-*/`。
