# A2 设计 — 创建向导

## 边界

| 层 | 文件 | 说明 |
|---|---|---|
| 后端预览 | `AISessionsService.PersonaScaffoldPreview`（已加） | `persona.Create(DryRun:true)` 的同源文件树 |
| 向导 | `frontend/app/view/persona/persona-create-wizard.tsx` | 两步向导（身份 / 预览 + 命令） |
| 入口 | AISessions 行右键、agent block 头部右键、Session Detail ⋯ 菜单 | 统一 `openPersonaCreateWizard(prefill)` |
| 纯逻辑 | `frontend/app/view/persona/persona-create-model.ts` | slug 预览、命令拼装、预填合并（可单测） |

## 契约

- `PersonaCreateWizard` 以 modal 形式挂载在 persona/AISessions surface；props：`{open, prefill:{source,sessionTitle,projectPath}, onClose}`。
- 步骤 1 → 步骤 2 时调 `PersonaScaffoldPreview({name,emoji,role,provider,model})`；失败显示错误、可重试。
- 步骤 2 左侧文件树（path + exists 标记 + preview），右侧命令块（`wsh persona create --name … --yes`）。
- 入口接线：只新增菜单项，不改既有菜单行为；`P` 快捷键只在 AISessions/persona 视图内响应。

## 风险

| 风险 | 处置 |
|---|---|
| 向导直写磁盘绕过 propose 闸门 | v1 只展示命令，不自动落盘 |
| 文件树与 A1 drift | 单一数据源 = 后端 `plannedFiles` |
| 菜单项与既有右键冲突 | 只 append 一项，单测断言渲染 |

回滚：新增组件 + 菜单项 + 一个 RPC，`git revert` 单 commit。
