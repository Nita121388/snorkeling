---
id: N-1117-sync-core
title: "云同步纯函数层：manifest / 差量 / 台账并集去重 / 六态判定"
type: feature
priority: P1
status: open
origin: internal
source: "ADR 0004 §8 S2；云能力切片 2/6"
task: 11-17-sync-core
order: 10
touch: ["E:/primary/projects/loop/lib/sync.mjs", "E:/primary/projects/loop/lib/sync.test.mjs", "E:/primary/projects/loop/lib/i18n.mjs", "E:/primary/projects/loop/lib/i18n.test.mjs", "E:/primary/projects/loop/lib/capabilities.mjs", "E:/primary/projects/loop/queue.mjs", "E:/primary/projects/loop/RUNBOOK.md", "E:/primary/projects/snorkeling-agent-control/.trellis/tasks/11-17-sync-core/**", "E:/primary/projects/snorkeling-agent-control/loop/red/N-1117-sync-core.txt"]
rollback: null
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: "2026-11-17T06:38:08Z"
---

# 云同步纯函数层：manifest / 差量 / 台账并集去重 / 六态判定

## 背景

把云同步里与传输无关的部分（白名单/清单指纹/差量/台账并集去重/六态判定/配置与水位）做成一份纯函数实现，让 hub 与 folder 两条路复用同一套判定，避免出现第二份合并逻辑。设计见 board/docs/adr/0004-cloud-sync.md §4–§6。

## 来源

- internal：ADR 0004 §8 S2；云能力切片 2/6

## 验收判据

- [ ] `node --test "E:/primary/projects/loop/lib/sync.test.mjs"` → `# fail 0`
- [ ] `node --test "E:/primary/projects/loop/lib/*.test.mjs"` → `# fail 0`
- [ ] `node "E:/primary/projects/loop/bin/loop.mjs" queue sync status --json --root .` → `"state": "off"`
- [ ] `node "E:/primary/projects/loop/bin/loop.mjs" queue help` → `sync status`

## 记录

- 2026-11-17 落地 `lib/sync.mjs`：白名单/清单指纹/差量/台账并集去重/六态判定/配置与水位，加 `queue sync status [--json]`。
- 去重键用**稳定序列化后的 sha256**，不用原始行：字段相同、键序不同的事件也算同一条（否则对端搬一次就多一段假历史）。
- 灯六态的判定顺序写死为 `off > syncing > offline(连败) > error > offline(超时) > pending > idle`；看板不许自己算第二份。
- 阈值也钉在函数里：2× 间隔才出 pending、5× 间隔或连败 3 次才 offline、连败 ≥3 时不显示 error（"又失败一次"不是新信息）。
- token 只从环境变量读，配置里存的是**变量名**：配置文件会被同步、会被提交，密钥落进去就是落进 git 历史。
