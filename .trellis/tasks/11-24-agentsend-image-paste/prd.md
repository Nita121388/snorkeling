# PRD：Composer 支持粘贴图片

> 父任务 `11-24-overview-agent-batch`。需求 R9，方案 `../11-24-overview-agent-batch/design.md` §7，步骤 `implement.md` P5。

## Goal

在 Overview 卡片 composer 里粘贴剪贴板图片 → 落盘为真实文件 → 光标处插入 markdown 图片引用 → 随文本一起发给 agent。

## 现状

`CardSendPanel` 的 `<textarea>` 只有 `onChange` / `onKeyDown`，**无 `onPaste`**（`overview-card-send-panel.tsx:338-361`）→ 粘贴图片无任何反应。CommonText 侧已有完整链路可复用：`pickPastedImages` / `validatePasteImage` / `writePasteImage` / `buildPasteImageMarkdown` / `spliceTextAtRange` / `materializePastedImages`（`commontext-paste-image.ts`）。

## 需求

- R9.1 `writePasteImage(blob, { subdir })` 增可选参数（默认仍是 `commontext-images`，CommonText 行为零变化）。
- R9.2 新增 `overview-send-images` 子目录（父 PRD D3），新增薄适配 `materializeOverviewSendImages`。
- R9.3 `CardSendPanel` 接 `onPaste`：有图片才 `preventDefault`，落盘后按光标位置插入 markdown；失败内联提示；插入后光标移到串尾。
- R9.4 远端块（`connection !== ""`）禁用图片粘贴，给内联提示。
- R9.5 纯文本粘贴行为零变化；单图上限 10MB；多图串行保序；落盘失败不留半截引用。

## 验收判据

```bash
npx vitest run frontend/app/commontext/commontext-paste-image.test.ts && echo PASTE_LIB_OK
```
→ `PASTE_LIB_OK`

```bash
npx vitest run frontend/app/session-overview/overview-send-paste.test.tsx && echo PASTE_UI_OK
```
→ `PASTE_UI_OK`

单测覆盖：默认子目录不变（回归锁）、图片粘贴落盘并插入 markdown、纯文本不拦截、超限提示、落盘失败无半截引用、远端禁用。

## 非目标

不做图片在 agent 侧的渲染；不做截图工具；不把图片回写 CommonText。
