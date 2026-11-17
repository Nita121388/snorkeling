---
id: N-1117-sync-hub
title: "自部署同步服务：hub 模式 /api/sync/*（写者独占 · 白名单 · 整批拒绝 · 热发现）"
type: feature
priority: P1
status: open
origin: internal
source: "ADR 0004 §5 §8 S4；云能力切片 4/6"
task: 11-17-sync-hub
order: 10
touch: ["E:/primary/projects/loop/board/server/lib/sync-store.mjs", "E:/primary/projects/loop/board/server/lib/sync-store.test.mjs", "E:/primary/projects/loop/board/server/lib/config.mjs", "E:/primary/projects/loop/board/server/index.mjs", "E:/primary/projects/loop/board/scripts/verify-sync.mjs", "E:/primary/projects/loop/board/package.json", "E:/primary/projects/loop/board/README.md", "E:/primary/projects/loop/board/docs/architecture.md", "E:/primary/projects/loop/board/docs/adr/0004-cloud-sync.md", "E:/primary/projects/snorkeling-agent-control/.trellis/tasks/11-17-sync-hub/**", "E:/primary/projects/snorkeling-agent-control/loop/red/N-1117-sync-hub.txt"]
rollback: null
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: "2026-11-17T07:55:10Z"
---

# 自部署同步服务：hub 模式 /api/sync/*（写者独占 · 白名单 · 整批拒绝 · 热发现）

## 背景

让现有 board server 多一种 LB_MODE=hub：本机变成同步服务，别的机器把 loop/ 推上来合并展示，但不写任何本地台账。镜像落成 <store>/<repo>/loop/**（普通消费者仓，引擎原样读），一个仓一个写者，先全量校验再落盘。设计见 board/docs/adr/0004-cloud-sync.md §5。

## 来源

- internal：ADR 0004 §5 §8 S4；云能力切片 4/6

## 验收判据

- [ ] `npm --prefix E:/primary/projects/loop/board run verify:sync` → `17/17 条通过`
- [ ] `npm --prefix E:/primary/projects/loop/board run verify` → `# fail 0`
- [ ] `node --test "E:/primary/projects/loop/lib/*.test.mjs"` → `# fail 0`

## 记录

- 2026-11-17 落地 `LB_MODE=hub`：四个端点 + 镜像仓库 + 写者登记 + 推送后热发现（不用重启）。
- 镜像 = `<store>/<repo>/loop/**`，就是普通消费者仓 —— 现有 `queue board --root` 一行不改就能读，没有第二种读路径。
- 写者用**事实**登记（第一个推上来的设备写进 `_hub.json`），不用配置：配置会和现实对不上（换机器/重装），登记表是结果且可人工改。
- 先全量校验再落盘，一个文件不合格整批 400：半截写入比不写更糟。
- hub 上 `/api/action`、`/api/repos` 仍 403 —— 否则看板就成了第二个写者（D9）。
- 判据：`npm --prefix board run verify:sync` 17/17（含 6 条「必须被拒」），已挂进 `verify:all`。
