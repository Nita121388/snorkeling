---
id: N-1114-commontext-draft-autosave
title: "CommonText Editor 文本持久草稿自动保存"
type: fix-small
priority: P2
status: open
origin: self
source: "2026-11-14T06:42:00Z"
task: 11-14-commontext-editor-draft-autosave
order: 100
touch: [frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-editor-draft.ts, frontend/app/commontext/commontext-compose-modal.dom.test.tsx, scripts/verify/commontext-source-notion/, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 40, retries: 2}
releaseCandidate: false
createdAt: "2026-11-14T06:42:00Z"
---

# CommonText Editor 文本持久草稿自动保存

## 背景

Editor 文本只在关弹窗时快照进模块级内存 `composeDraft`，同进程重开还原，**应用重启即丢**；要保住文本只能点「+」升格为列表条目。改法（用户已确认方案 A）：文本 800ms 防抖写入 `localStorage["commontext:editorDraft"]`，关弹窗/卸载强制 flush；橡皮与「+」成功后清草稿；无 query 打开从 localStorage 还原（同进程与重启统一路径，删内存 composeDraft）；footer 显示 `Draft saved`。不自动落列表条目（方案 B 已否决：重复检测 throw + 云同步 rev 噪音）。

## 来源

- self：nita 2026-11-14 会话 —— 「CommonText Editor的文本自动保存 不需要点击+」→ 设计方案（A 持久草稿 / B 空闲自动落列表）→ 用户确认「A」。

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/ --reporter=basic` → `Test Files 15 passed` 且新增 dom 台断言全过（type→800ms→localStorage 含文本；卸载→重挂→还原值与光标；橡皮/「+」→ 草稿键不存在；坏 JSON → 空编辑器打开）
- [ ] 红证：旧源（git show HEAD）跑新 dom 台 → ≥1 条 draft 断言失败

## 记录

- 2026-11-14 实施（方案 A 已确认）：新模块 `commontext-editor-draft.ts`（localStorage 单槽 load/save/clear，
  坏 JSON/错 schema 静默清掉）+ 弹窗接线（800ms 防抖、close/卸载强制 flush、基线相同跳过避免误清、
  橡皮与「+」立即清键、footer `Draft saved` 指示）。
- 红证（G2）：旧源（git show HEAD）跑新断言 5 failed（防抖落盘/重挂还原/橡皮清空/「+」清空/坏 JSON 清理
  + 源码断言）→ 新源 190 passed（15 files，新增 1 文件 +9 例）。
- 真机台阻塞：Electron 启动器故障依旧（launcher exit=201，与 2026-11-13 同病，与本次改动无关）。
  行为断言由 jsdom 台兜住；真机台已补 editor-draft-persisted/cleared 断言，启动器修复后补跑（台账已记 skipped）。
