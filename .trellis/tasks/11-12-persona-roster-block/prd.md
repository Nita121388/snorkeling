> **Confirmed: 2026-11-13 @nita**

# A4 人设名册 Block（persona://）

> 用户 2026-11-13 授权继续开发；真机验证留用户手动（列表数=磁盘目录数改为组件/接口断言）。

## Goal

点击 🎭 打开的总览：谁在当班、每人记得多少、有什么待批准。

## Requirements

- 新 view `persona://`（React view，注册进视图表）
- 列表：emoji + 名字 + 职责 + provider/model + 最近一条 journal（「最近登场」代理）+ ⚡待批准数
- 详情：CHARTER 全文、容量三项（档案/归档/产物）+ syncable、待批准提议逐条（批准/驳回走既有 CLI 语义，v1 只读展示 + 命令提示）
- 动作：[叫TA登场]（复用 A3 的 buildPersonaLaunchBlockDef，block meta persona=id、cwd=据点）
- 数据：`aisessions.PersonaOverview` RPC（root + persona/charter/storage/pendingProposals/lastJournalLine）

## Acceptance Criteria

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `npx vitest run frontend/app/view/persona` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep PersonaViewModel frontend/app/view/persona/persona.tsx` → 含 `PersonaViewModel`
- [ ] `grep "PersonaOverview(request: AISessionsPersonaOverviewRequest)" frontend/app/store/services.ts` → 含该行

## 依赖

A1；A1.5（登场史）；A2.5（待批准）；A3（登场管线复用）。

## 假设与偏离

1. 列表数=磁盘目录数：由 `PersonaOverview` 直接扫 `persona.List` 保证（接口层一致性），组件单测断言空态/行渲染。
2. 待批准区 v1 只读展示 + 提示 `wsh persona memory approve <id> <stamp> --yes`（不在视图里做破坏性写操作）。
3. 真机 Electron 验证留用户手动。
