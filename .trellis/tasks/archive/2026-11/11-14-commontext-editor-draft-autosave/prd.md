# PRD: CommonText Editor 文本自动保存（持久草稿）

## Goal

CommonText 弹窗（`frontend/app/commontext/commontext-compose-modal.tsx`）的 Editor 文本当前只在关弹窗时存进模块级内存 `composeDraft`，同进程重开还在，**应用重启即丢**；要真正保住文本只能点「+」把它升格为列表条目。本期让 Editor 文本自动保存为跨重启的持久草稿，不需要点「+」。

## 背景（代码事实）

- 文本只在 React state；`close()` 把 `{editor, editorCaret, insertedIds}` 快照进模块级 `composeDraft`（`commontext-compose-modal.tsx:159,667`）。
- 带外部 query 打开（选区复制等场景）故意不取草稿，避免与外部文本冲突。
- 「+」(`handleSaveDialog:973`) 是唯一的「文本 → 列表条目」入口：upsert → 清空 editor → 切详情就地编辑。
- 详情区已有 800ms 防抖自动保存范式（`detailSaveTimerRef` + `flushDetailSave` + footer `saveStatus`）。
- 条目写走后端 `SetConfig` → 云同步记 rev；且 `upsertCommonTextItem` 对重复文本直接 throw —— 所以「空闲自动落列表」不可取（已与用户确认选方案 A）。

## 方案 A（已确认）

**落点**：`localStorage["commontext:editorDraft"]`，schema `{v:1, text, caret, insertedIds, savedat}`。损坏 JSON 静默丢弃。不走后端 settings/云同步（草稿跨机同步会撞车；先例 `commontext:composeModalSize` 同样走 localStorage）。

**写入**：
- Editor 文本变更后 **800ms 防抖**写入（与详情区同节奏）。
- 关弹窗 `close()` 与组件卸载时**强制 flush**。
- 文本为空 → 清草稿（不写空对象）。

**清除**（否则「删了重启又回来」）：
- 点橡皮擦清空 editor（`handleClearEditor`）→ 清草稿。
- 「+」成功落条目后（editor 已清空）→ 清草稿。
- Send 后**保留**草稿（发送≠归档，与现状一致）。

**还原**：
- 无 query 打开弹窗 → 读 localStorage 草稿（同进程与重启统一走这条路径；删除模块级 `composeDraft`，逻辑收敛为一条）。
- 外部 query 打开 → 不还原（行为不变）。

**可感知**：
- footer 复用 `saveStatus` 通道显示 `Draft saved · HH:MM`，1.5s 淡回 idle；锚点 `data-commontext-draft-status="idle|saving|saved"`。

## 非目标

- 不改「+」的语义（仍是「草稿升格为列表条目」），不改 Send、列表过滤、排序、tag、云同步。
- 不做草稿跨机同步 / 多窗口合并（localStorage 同源共享，last-writer-wins，接受）。
- 不自动将 Editor 文本落成列表条目（方案 B 已否决）。

## 验收标准（数字可判）

1. `npx vitest run frontend/app/commontext/` → 全绿；新增 dom 台断言：
   - type 文本 → 快进 800ms → `localStorage["commontext:editorDraft"]` 含该文本；
   - 卸载组件 → 重新挂载 → 无 query 打开 → textarea 值与光标还原；
   - 点橡皮 → localStorage 草稿键不存在；
   - 「+」成功落条目后 → 草稿键不存在；
   - localStorage 里是坏 JSON → 空编辑器正常打开、不抛错。
2. 红证：改动前的源码跑新 dom 台 → 相关断言失败（重启还原 / 800ms 落盘两条至少一红）。
3. `npx tsc --noEmit` 无新增错误；Prettier 干净。
4. 真机台 `commontext-source-notion` 补 `draft-*` 断言（本机启动器故障则为 skipped，由 dom 台兜住）。

## 工时

小任务：新小模块（纯 load/save/clear + 容错）+ 弹窗接线 + 测试。
