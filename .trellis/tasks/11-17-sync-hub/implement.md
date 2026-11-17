# 实施方案（G6 凭据）

> 设计决策在 `board/docs/adr/0004-cloud-sync.md` §5（先于代码）；本文是文件清单与落点。状态：**待签**

## 文件清单

| 文件 | 改动 | 为什么 |
|---|---|---|
| `board/server/lib/sync-store.mjs` | 新增 | 镜像仓库：校验、落盘、写者登记；不依赖 http 可单测 |
| `board/server/lib/sync-store.test.mjs` | 新增 | 15 条单测（穿越/白名单/越权/sha256/整批拒绝/幂等/remove/坏登记表） |
| `board/server/lib/config.mjs` | 扩 | `LB_MODE=hub` + `LB_SYNC_STORE`；hub 且无 store → 启动即拒 |
| `board/server/index.mjs` | 扩 | 4 个路由 + `refreshRoots()` 热发现 + `denyWrite()`（hub 写动作 403） |
| `board/scripts/verify-sync.mjs` | 新增 | 真机器具：真起 hub，真 HTTP，17 条断言 |
| `board/package.json` | +1 行 | `verify:sync` 挂进 `verify:all` |
| `board/README.md` / `board/docs/architecture.md` | 扩 | hub 部署一行 + 架构一段 |
| `board/docs/adr/0004-cloud-sync.md` | 改 | §5 改成落地形态 |

## 关键取舍

1. **镜像 = 普通消费者仓**。落成 `<store>/<repo>/loop/**`，现有 `queue board --root` 原样能读 —— 没有第二种读路径，也就没有第二套真相。
2. **写者登记用事实而不是配置**：第一个推上来的设备写进 `_hub.json`。配置会和现实对不上（换机器、重装）；登记表是结果，且可以人工改。
3. **整批拒绝**：任何文件不合格（穿越/白名单外/sha256 不符）整批 400，镜像不留半截 —— 半截写入比不写更糟。
4. **白名单复用引擎那份**（`lib/sync.mjs` 的 `isSyncedPath`），hub 端不抄第二份。
5. **先全量校验后落盘**，包括总量上限（8MB）与单文件上限（4MB）。

## 回滚

`git revert` 单提交；`LB_SYNC_STORE` 不配时行为与改造前完全一致（没有 hub 模式，路由 404）。
