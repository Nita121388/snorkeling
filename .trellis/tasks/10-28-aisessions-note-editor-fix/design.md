# Design: Session Note 编辑弹窗交互修复

## 改动范围

仅 `frontend/app/view/aisessions/session-detail.tsx`（inline 弹窗 JSX ~2122 + 其依赖的 hooks/回调 ~278–378、~1160–1205、~1640–1655）。
不涉及 `aisessionnotemodal.tsx`、后端、schema。

---

## 改动 1：chips 单一事实源 + 可移除（AC1 / AC2）

现状：`nextTags = merge(session.tags, parsedNoteDraft.tags, aiTags)`，`<SessionTagChips tags={nextTags} />`（默认 removable=false → disabled 伪装按钮）。

方案：
- 给 inline 弹窗的 `SessionTagChips` 加 `removable` + `onRemove(tag)`。
- `onRemove` 实现：`setNoteDraft((d) => removeSessionTagFromNote(d, tag)); setAiTags((t) => t.filter((x) => x !== tag));`（移除正文 `#tag` 与 aiTags 残留）。
- 因为 `nextTags` 派生自 `noteDraft` + `aiTags`，正文改动会实时反映到 chips；chips × 改动正文也会实时反映。单一事实源成立。
- 视觉：removable=true 后 `SessionTagChips` 已带 × 图标与 hover 态，不再是误导的 disabled 按钮。

注意：`summary.tags`（服务端现存 tag）与正文解析出的 tag 会合并显示；移除一个只改正文/aiTags，不动 `summary.tags` 本身——这没问题，因为下次 parse 时 `summary.tags` 仍会补回来形成完整 set；真正落盘在 `saveNote` 里重算合并，结果一致。

---

## 改动 2：副标题 / 徽标（AC3）

现状：`{summary.title || summary.id}`，长路径 fallback 截断。

方案：复用 modal 版抬头结构：
- 主标题：`Session Note`（保留）。
- 副标题行：`<source 徽标 if summary.source>` + `summary.title || "ID: " + shortSessionId(summary.id)`；`title` 有值用 truncate + `title` 全名 tooltip（title attr），无 title 直接显示 `ID: xxxx`。
- 不再 fallback 到 `summary.id`（那是长路径会话 id 串）。

需确认：`shortSessionId` 已在 `session-detail.tsx` 顶部 import（来自 `./utils`，与 modal 版同源）。

---

## 改动 3：error 透传（AC4）

现状：inline 版 `saveNote` 仅 `setNoteSaveStatus("error")` + statusText="Save failed"，吞掉 `model.updateNote` 的失败原因。

方案：
- `saveNote` 增加 `setNoteError(errMsg)`（仿 modal 版 `setError`）。
- JSX 在 `SessionTagChips` 之后、textarea 之前加红色 banner（复用 modal 版写法）：
  ```tsx
  {noteError ? (
      <div className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error">{noteError}</div>
  ) : null}
  ```
- statusText 保留 "Save failed" 简短态，banner 给详细原因。

---

## 改动 4：保存后回写 noteDraft（AC5）

现状：inline `saveNote` 没有 modal 版那段
```ts
if (currentDraftSaved) { setNoteDraft(updated.note ?? ""); latestNoteDraftRef.current = updated.note ?? ""; }
```

方案：inline `saveNote` 补同一段。当前 inline 用 `model.updateNote(summary, parsed.note, tags)` 返回 boolean 而非对象，需改为拿回 updated note：
- 若 `model.updateNote` 只回布尔，则保存成功后直接用 `parsed.note` 回写（等价于 updated.note，因为服务端不会改写 note 文本，只抽取 tags）。
- 更稳：回写 `parsed.note`（trim 后）到 `noteDraft` + `latestNoteDraftRef.current`，使 unchanged 判定稳定。
- `currentDraftSaved` 判定：inline 用 `extractSessionTagsFromNote(latestNoteDraftRef.current).note === parsed.note`，保存成功的那条即 latest，恒 true，故回写无条件执行（saving=false 分支）。

---

## 改动 5 + 7：关闭语义 + 消除竞争（AC6 / AC7）

现状三路径互相踩：
- `onBlur`：blur 时若未不变且非 saving → `saveNote(trimmed)`，不等结果。
- autosave effect：stop typing `NoteAutoSaveDelayMs` 后 `saveNote(trimmed)`。
- `closeNoteEditor`：非 saving 且有改动 → `saveNote().then(saved => saved && close)`；saving 中直接 return（卡死）。

问题：close 时若 autosave 正在飞，`noteSaveStatus==="saving"` → close 的 `saveNote` return false → 不关也不提示。

方案（不引入新状态机，最小改动）：
1. `closeNoteEditor` 改为不依赖「close 的那次保存成功」：
   - 有未保存内容：触发一次保存（若已在 saving 则跳过重复触发，但标记 `pendingCloseRef=true`）。
   - 保存成功 effect（或在 `saveNote` then 里）检测到 `pendingCloseRef` → 关窗。
   - 保存失败：`pendingCloseRef` 不清，显示 error banner，弹窗保持（用户可重试 Close 或 ESC 丢弃）。
2. backdrop / ESC（`onClose` / `onClickBackdrop`）区分于 Close 按钮：
   - 当前 `onClose={closeNoteEditor}`，即 backdrop/ESC 也走「保存并关」。改为独立 `requestDismiss`：
     - 无改动 → 直接关。
     - 有改动 → 不静默存盘，标 `dirtyDismiss=true` 在 footer 附近显示一行提示「未保存，关闭将丢弃草稿」（或改用 Confirm 弹窗）。用户二次点 Close/ESC 或点「丢弃」才关。
   - 由于 Modal 顶层 `onClose` 同时服务 x 按钮、ESC、backdrop，逻辑统一进 `requestDismiss`。

   简化落点：把 `onClickBackdrop` 与 Modal 的 `onClose`（x/ESC）都指向 `requestDismiss`；Close 按钮保留 `saveAndClose`。`saveAndClose` 复用改动后的非卡死关闭逻辑（pendingClose）。

3. `dirty` 提示实现：footer 的 statusText 区或 Close 按钮上方加一行：
   ```tsx
   {dirtyDismiss && !noteSaving ? (
     <span className="text-xs text-warning">未保存的改动将在关闭时丢弃</span>
   ) : null}
   ```
   （warning 色，非 error）。

---

## 改动 6：saving 中关闭不卡死（AC7 收尾）

- `saveAndClose`：若 `noteSaving` → 置 `pendingCloseRef=true`（保存完成回调里关），不 return 卡死。
- 保存成功回调：
  ```ts
  if (pendingCloseRef.current) { pendingCloseRef.current = false; setNoteEditorOpen(false); }
  ```
- 这样 autosave 与 close 不再竞争丢失：两者都走同一个 `saveNote`，saving 期间后来的触发只置 pendingClose，最终只关一次。

---

## 验证

- 手动：开 Detail → Note → 输入 `#新tag` 看 chips 出现 → 点 × 看正文 `#新tag` 消失 → Close 落盘 → 重开确认。
- 手动：编辑后点 backdrop → 应见 dirty 提示而非静默存盘；再 ESC 丢弃确认关闭。
- 手动：编辑后点 Close → saving 态按钮禁用 → 完成后自动关；模拟失败（断网/后端错）→ 见 error banner 且弹窗不卡死。
- 回归：列表行 / agent TUI 的 `AISessionNoteModal` 行为不变（本任务未触及其文件）。
- `tsc --noEmit` 通过；`eslint` 通过。
