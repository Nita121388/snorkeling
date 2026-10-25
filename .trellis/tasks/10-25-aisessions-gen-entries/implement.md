# Implement: 前端 gen-store 与一键生成入口 + titleSource 视觉区分

## 0. 依赖

- 需要 `10-25-aisessions-gen-backend` 的 `AutoGenerate` 契约与 `aisessions:generationstatus` 类型
  （可由 `go generate` 产物提供；开发期可先按 design §5 的 TS 类型手写临时声明，联调前删除）。

## 1. 状态层

- [ ] 新建 `frontend/app/view/aisessions/aisession-gen-store.ts`（或 `frontend/app/store/`，与 design 对齐）。
- [ ] `ensureGenListener()` 订阅 `aisessions:generationstatus`，幂等单例。
- [ ] `useSessionGenerationStatus` + `autoGenerate` + `retry`。
- [ ] `done` 3s 回落；`failed` 保留。
- [ ] 批量聚合 selector。

## 2. 通用按钮 / badge / toast

- [ ] `gen-action-button.tsx`（三态 + 配置校验 + force 回调）。
- [ ] `title-source-badge.tsx`。
- [ ] `undo-toast.tsx`（模块单例 + CAS）。

## 3. 入口接入

- [ ] `element/info-card/session-note-section.tsx`：删阻塞提案面板，换 `GenActionButton`；
      note 覆盖 Undo。
- [ ] `view/aisessions/session-row.tsx`：hover wand（title）+ 标题 badge。
- [ ] `view/aisessions/session-detail.tsx`：头栏 wand（title）+ 标题 badge + `SessionMoreMenu` 两行。
- [ ] `view/aisessions/session-menu.tsx`：新增两个 `MenuRow`（props 透传）。
- [ ] `view/aisessions/session-batch-bar.tsx`：`AI title` / `AI note+tags` + 计数 + 上限。
- [ ] `view/aisessions/aisessions.tsx`：把 `selectedIds/connection` 传给批量栏。
- [ ] `block/use-block-session-title.ts` 返回 `{title,titleSource}`；`block/block.tsx` 标签渲染 badge。

## 4. 交互细节

- [ ] `titleSource=user` → 点击弹一次确认（复用 `Modal` 或 `modalsModel`），确认后 `force=true`。
- [ ] `ids > 50` → 前端 disabled + tooltip，不发 RPC。
- [ ] 模型未配置 → 本地错误 + `Open AI settings`。
- [ ] `done` 时 `ensureSessionNote(..., {force:true})` 背景刷新。

## 5. 验证

```powershell
npx tsc --noEmit
npx vitest run frontend/app/store frontend/app/view/aisessions frontend/app/element/info-card
```

- [ ] agent card 不闪不弹，标题数秒后更新。
- [ ] 列表 / Detail / 批量栏三态正确。
- [ ] badge 仅在 `ai` 出现。
- [ ] Undo 10s 有效且 CAS 生效。

## 6. 收尾

- [ ] eslint 改动文件。
- [ ] spec 更新：前端「AI 生成状态与入口」约定。
- [ ] commit（前端单条）。

## Review gate

- [ ] 点击路径无长 await（RPC 立即返回）。
- [ ] 事件驱动、无轮询。
- [ ] connection 隔离。
- [ ] 不新增全局依赖。
