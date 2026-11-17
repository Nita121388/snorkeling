# 自部署同步服务：hub 模式 /api/sync/*

> **本文是 G1（需求确认）凭据文件。** 设计依据：`board/docs/adr/0004-cloud-sync.md` §5。
> 状态：**待签**

## Goal

让现有 board server 多一种 `LB_MODE=hub`：本机变成「同步服务」——别的机器把自己的 `loop/` 推上来，它合并展示，**不写任何本地台账**。不新建服务、不新建代码库。

## 做什么

| # | 做什么 | 落点 |
|---|---|---|
| 1 | hub 模式判定 + 启动闸（无 `LB_SYNC_STORE` 拒绝启动） | `board/server/lib/config.mjs` |
| 2 | 镜像仓库：推送落盘、写者登记、状态一览 | `board/server/lib/sync-store.mjs` |
| 3 | 四个端点：`status / manifest / file / push` | `board/server/index.mjs` |
| 4 | 推送后镜像**热并入** `/api/state`（不用重启） | `refreshRoots()` |
| 5 | hub 上写动作仍 403（hub 不是第二个写者） | `denyWrite()` |
| 6 | 真机器具：起真 hub 走 HTTP，17 条断言 | `board/scripts/verify-sync.mjs`（挂进 `verify:all`） |

## 不做什么

- **不做传输客户端**：本机怎么把自己的仓推上去（push 客户端）是下一个切片。
- **不做多写者**：`_hub.json` 一个仓只认一个写者；换设备 = 人手工改登记表。
- **不做 UI**：看板不显示 hub 状态页（`/api/sync/status` 给谁看由 S5 决定）。
- **不做 TLS**：外网走反代（Caddy/nginx），hub 自身只有 token。
- **不动引擎**：镜像就是普通消费者 `loop/`，引擎一行不改。

## 验收判据

- [ ] `npm --prefix E:/primary/projects/loop/board run verify:sync` → `17/17 条通过`
- [ ] `npm --prefix E:/primary/projects/loop/board run verify` → `# fail 0`
- [ ] `node --test "E:/primary/projects/loop/lib/*.test.mjs"` → `# fail 0`
- [ ] 红样 `loop/red/N-1117-sync-hub.txt`：注入「写者检查失效」→ 越权断言红；注入「白名单校验失效」→ 越界断言红

## G1 签字

- [ ] 做什么 / 不做什么 / 验收判据 三段已读并同意（`node bin/loop.mjs queue gate --id N-1117-sync-hub --gate g1 --by <who> --root <仓库>`）
