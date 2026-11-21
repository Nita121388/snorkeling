# DeleteBlock 缺广播：删除 agent 块后其他 Tab / Overview 看板不同步

## Goal

在 tab-01 删除一个 agent 块后，其他 Tab 的 renderer（Overview 看板、Tab 悬浮卡）仍显示被删块：
看板列计数不变、幽灵卡片还在，直到下一次「有广播的写操作」（如新建 agent）才自愈。

根因：`ObjectService.DeleteBlock` 只把 updates 返回给调用方 renderer（HTTP 响应），
**没有** 像 `CreateBlockInTab` / `MoveBlockToTab` / `CopyBlockToTab` 那样调 `sendUpdateEvents`
走 WPS broker 广播，导致其它 renderer 的 WOS（`frontend/app/store/wos.ts` 的
`updateWaveObject`）永远收不到 `waveobj:update (delete)` 与 tab 的 `blockids` 变更。

## Evidence（2026-11-21 dev:cdp 实例实测）

- DB 真值：`45f7621a…` 已从 `db_block` 删除；`tab:556bdae3`（tab-01）`blockids` 已缩减为 8、仅 1 个 agent。
- 后端日志删除瞬间（11:42:20，`DeleteBlock: parentBlockCount: 8` 之后）**没有任何**
  `[ps-publish] event=waveobj:update otype=block oid=45f7621a…`，也没有 `tab:556bdae3` 的 publish；
  而同窗口其它块更新均有 `[ps-publish] … scopes=[block:…]`。
- 运行中 DOM（Overview Tab 的 renderer）：`section[data-column-key="tab:556bdae3…"]`
  `aria-label="tab-01，2 个会话"`、计数徽章 `2`，卡片容器里 2 张卡（含幽灵卡 `45f7621a`）+ 1 个添加按钮。
- 自愈：随后新建 agent 走 `CreateBlockInTab`（有广播）→ 全体 renderer 刷新 → 计数正确。

## Requirements

- R1 `ObjectService.DeleteBlock` 删除成功后必须广播 updates（复用同文件 `sendUpdateEvents`，
  与 Create/Move/Copy 完全同构；广播 + 响应双路径重复 apply 幂等，现网已有 6 个方法如此）。
- R2 不改 `sendUpdateEvents` 本身、不改 WPS broker、不改前端 WOS 逻辑。
- R3 不扩大范围：`CreateBlock` / `UpdateObjectMeta` / `UpdateObject` 同类遗漏只做审计记录
  （`UpdateObject` 高频调用，加广播需单独评估代价），本包不改。

## Acceptance Criteria

- [ ] 代码：`grep -n "sendUpdateEvents" pkg/service/objectservice/objectservice.go` 含
      `DeleteBlock` 行（与 Create/Move/Copy 同一 helper）。
- [ ] `go build ./...` 退出码 0（本地 env 加载后）。
- [ ] `go test ./pkg/service/objectservice/ ./pkg/wps/` 全绿（真库测试台不存在，不新增 DB 脚手架）。
- [ ] 运行时判据（需要重启 wavesrv，本包不改用户正在跑的实例）：
      删除块后 `waveapp.log` 出现 `[ps-publish] event=waveobj:update otype=block oid=<被删块>`
      与 `[ps-route] … routes>=1`；且其它 Tab 的 Overview 看板计数立即跟随。

## Notes

- 前端 `11-20-tab-info-card-freshness`（快照读 → 响应式）是另一层修复，与本包互补不冲突。
