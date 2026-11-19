> **Confirmed: 2026-11-13 @nita**

# A2 创建入口与两步向导（右键 / launcher / card）

> 用户 2026-11-13 授权继续开发；真机验证留用户手动（三入口真机探针改为组件/接口断言）。

## Goal

把「会话 → 人设」压到两次点击：三个入口打开同一个两步向导。

## Requirements

- 一个可复用向导 `PersonaCreateWizard`（两步：身份 → 预览），三处入口：AISessions 行右键「🎭 设为新人设…」、agent block 头部右键同项、Session Detail 卡片 ⋯ 菜单同项
- 步骤 1 身份：emoji 输入、名字（实时 slug 预览）、provider/model、记忆初稿提示（Note/Tags 由 CLI `--memory-from-session` 落地，向导只展示说明）
- 步骤 2 预览：文件树来自 `aisessions.PersonaScaffoldPreview`（与 A1 `wsh persona create --dry-run` 同源，禁止两处手写）
- 确认：调后端创建（`aisessions.PersonaCreate` 或复用 CLI 语义）；v1 用「复制命令」+ 一次性 `--yes` 调用的安全路径（见偏离 2）
- 键盘：`P` 打开向导；Esc 关闭

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/view/persona frontend/app/view/aisessions` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `grep PersonaCreateWizard frontend/app/view/persona/persona-create-wizard.tsx` → 含 `PersonaCreateWizard`
- [ ] `grep "PersonaScaffoldPreview(request: AISessionsPersonaScaffoldPreviewRequest)" frontend/app/store/services.ts` → 含该行
- [ ] `grep persona-create-wizard frontend/app/view/aisessions/*.tsx` → 至少 1 处入口接线

## 依赖

A1（scaffold）、A2.5（propose 语义）、A3/A4（persona 视图与登场）。

## 假设与偏离

1. 三个入口共用一个向导组件；入口只负责带上预填（source/sessionId）并打开它。
2. 向导的「创建」不在前端直接落盘：v1 生成并展示 `wsh persona create … --yes` 命令（人执行）+
   可选的 `wsh persona create …` propose 提示，避免 GUI 里绕开 propose 闸门。真机验证留用户。
3. 记忆初稿（Note/Tags → MEMORY/inbox）v1 只展示 CLI 参数说明。
