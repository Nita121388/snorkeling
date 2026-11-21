# Implement — DeleteBlock 补广播

## 步骤

[x] **改 `pkg/service/objectservice/objectservice.go#DeleteBlock`**
   - `updates := waveobj.ContextGetUpdatesRtn(ctx)` 提出来 → `sendUpdateEvents("ObjectService:DeleteBlock", updates)` → return updates。
   - 与 `CreateBlockInTab` / `MoveBlockToTab` / `CopyBlockToTab` 同构；注释写清「只回响应 → 其它 Tab 幽灵卡片」。

[x] **验证 1：编译**
   - `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go build ./..."` → `BUILD_EXIT=0`

[x] **验证 2：包测试**
   - `… go test ./pkg/service/objectservice/ ./pkg/wps/` → `ok objectservice 4.281s` / `wps [no test files]`，`TEST_EXIT=0`

[ ] **验证 3：运行时广播（待 wavesrv 重启，不擅自重启用户正在跑的实例）**
   - 重启 dev 实例 → 在 tab-01 删除一个 agent 块 → `grep` 日志：
     `[ps-publish] event=waveobj:update otype=block oid=<被删块>` + `[ps-route] … routes>=1`，
     并且其它 Tab 的 Overview 看板列计数立即跟随（不再需要「新建 agent」才自愈）。

[ ] **收尾**
   - 提交：`fix(objectservice): DeleteBlock 补 WPS 广播`。

## 审计记录（本包不改，留作后续）

同文件同类「只回响应不广播」：
| 方法 | 影响面 | 备注 |
|---|---|---|
| `CreateBlock` | 新块在别的 renderer 不可见 | 现网主路径多走 `CreateBlockInTab`（有广播） |
| `UpdateObjectMeta` | meta 改动（重命名/标签）在别的 Tab 卡片滞后 | 需评估调用频率与事件量 |
| `UpdateObject` | 同上（整对象写） | 高频，加广播需先量化 |

`BlockService.CleanupOrphanedBlocks` 同理（返回 updates 不广播）。

## 回滚

单 hunk，revert 即回到「只回响应」行为（用户已实测的问题形态）。
