# A4 设计 — persona:// 名册 Block

## 边界

| 层 | 文件 | 说明 |
|---|---|---|
| 后端 | `pkg/service/aisessionsservice` | `PersonaOverview` RPC（只读聚合：persona + charter + storage + pending + last journal） |
| 前端 view | `frontend/app/view/persona/persona.tsx` | `PersonaViewModel` + `PersonaView`，注册到视图表 |
| 前端纯逻辑 | `frontend/app/view/persona/persona-model.ts` | 行/详情派生、字节格式化、待批准计数（可单测） |
| 登场复用 | `frontend/app/workspace/persona-launch.ts` | `buildPersonaLaunchBlockDef`（A3） |
| widget 点击 | `frontend/app/workspace/widgets.tsx` | A3 的点击分支改为打开 `persona://` block（A4 接回设计原意） |

## 契约

- view type = `persona`；block meta `{view: "persona"}`；无参数时展示全部人设。
- 数据一次拉 `PersonaOverview`；刷新按钮重拉；空列表 → 引导 `wsh persona create`。
- 「叫TA登场」= `buildPersonaLaunchBlockDef({persona, root})` → `env.createBlock`；
  不注入主工作目录（名册场景没有「本次主工作目录」语义），provider/model 取 persona 卡。
- 待批准只读：显示 stamp/section/content + 复制命令，不提供一键批准（写操作留 CLI/后续包）。

## 风险

| 风险 | 处置 |
|---|---|
| 新 view 未注册 → 打不开 | 单测 + tsc + 手动注册点核对 |
| RPC 聚合把大 CHARTER 全下发 | v1 可接受（人设数少）；后续可截断 |
| 与 A3 点击行为冲突 | A4 明确改回「点击 → 名册」，登场浮窗仍走 hover |

回滚：新增 view + 新增只读 RPC + 一处点击分支，`git revert` 单 commit。
