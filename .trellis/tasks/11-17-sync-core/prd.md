# 云同步纯函数层：manifest / 差量 / 台账并集去重 / 六态判定

> **本文是 G1（需求确认）凭据文件。** 签字前不得进入实现动作。
> 设计依据：`board/docs/adr/0004-cloud-sync.md` §4–§6（策略层），本文只锁「这一步做什么、不做什么、怎么算过」。
> 状态：**待签**

## Goal

把云同步里**与传输无关**的那部分做成一份纯函数实现，让 `hub`（自部署服务）与 `folder`（共享目录）两条路复用同一套判定：

1. **搬什么** — `manifest(loopDir)`：白名单内的文件 + sha256 内容指纹；
2. **差多少** — `diffManifests(from, to)`：新增 / 变化 / 删除 / 未变；
3. **台账怎么合** — `mergeEventLines(shards)`：append-only 求并集 + 按稳定序列化去重 + 按 `ts` 稳定排序；
4. **灯什么颜色** — `syncState(...)`：`off / idle / syncing / pending / error / offline` 六态；
5. **配置与水位** — `normalizeSyncConfig`（token 只从环境变量读）、`readSyncState`、`buildSyncStatus`；
6. **一个能看的入口** — `queue sync status [--json]`。

判据的核心不是「能跑」，是**坏了会红**：去重失效、pending 不催、白名单放行越界文件，都必须被测试抓住（见 `loop/red/N-1117-sync-core.txt`）。

## 做什么

| # | 做什么 | 落点 |
|---|---|---|
| 1 | 同步白名单 + 排除表（默认不外发，不是默认全发） | `lib/sync.mjs` `SYNC_INCLUDE` / `SYNC_EXCLUDE` / `isSyncedPath` |
| 2 | 目录清单与内容指纹 | `manifest` / `sha256` |
| 3 | 差量 | `diffManifests` |
| 4 | 台账并集去重与排序 | `mergeEventLines` / `readShardLines` |
| 5 | 设备级配置归一化 + 问题清单 | `normalizeSyncConfig` |
| 6 | 水位读取 + 六态判定 + 状态快照 | `readSyncState` / `syncState` / `buildSyncStatus` |
| 7 | CLI 入口（只读） | `queue sync status [--json]` + `lib/capabilities.mjs` 登记 |
| 8 | 状态词的中英表（单一实现） | `lib/i18n.mjs` `SYNC_STATE_LABEL` / `SYNC_MODE_LABEL` |

## 不做什么

- **不做传输**：不发 HTTP、不拷文件、不读写远端。`hub` 接口与 `folder` 适配器是后续切片。
- **不改台账格式**：`LEDGER-*.jsonl` 一行一事件、append-only，不动。
- **不做多写者合并**：仍然「一个仓库一个写者」。读者只拉不推。
- **不做远端写动作**（outbox）：后端只读。
- **不引依赖**：只用 node 内置模块；glob 复用 `lib/night.mjs` 的 `globToRegExp`，不抄第二份。
- **不做 UI**：右上角状态灯是后续切片（S5），本切片只保证 `/api` 能拿到形状。

## 验收判据

- [ ] `node --test "lib/sync.test.mjs"` → `# fail 0`
- [ ] `node --test "lib/*.test.mjs"` → `# fail 0`（含 i18n 枚举对账、capabilities 双向对账）
- [ ] `node bin/loop.mjs queue sync status --json --root .` → `"state": "off"`（未配置时不许谎报已同步）
- [ ] 红样 `loop/red/N-1117-sync-core.txt`：注入三处错误（去重失效 / pending 不催 / 白名单放行）→ 分别 3 / 5 / 4 条断言变红

## G1 签字

- [ ] 做什么 / 不做什么 / 验收判据 三段已读并同意（`node bin/loop.mjs queue gate --id N-1117-sync-core --gate g1 --by <who> --root <仓库>`）
