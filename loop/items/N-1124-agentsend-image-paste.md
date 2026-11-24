---
id: N-1124-agentsend-image-paste
title: "Overview composer 支持粘贴图片（落盘 + markdown 引用）"
type: feature
priority: P3
status: open
origin: internal
source: "2026-11-24T08:46:24Z"
task: 11-24-agentsend-image-paste
order: 100
touch: [frontend/app/commontext/**, frontend/app/session-overview/**, frontend/i18n/locales/**, docs/project/**, .trellis/**, loop/**]
rollback: null
budget: {minutes: 120, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T08:46:24Z"
---

# Overview composer 支持粘贴图片（落盘 + markdown 引用）

## 背景

用户 2026-11-24 反馈：发送信息的编辑框无法粘贴图片。现状：CardSendPanel 的 textarea 无 onPaste（overview-card-send-panel.tsx:338-361）。CommonText 已有完整链路可复用（commontext-paste-image.ts 的 pickPastedImages/validatePasteImage/writePasteImage/buildPasteImageMarkdown/spliceTextAtRange/materializePastedImages）。方案：writePasteImage 增可选 subdir（默认不变，CommonText 行为零变化）+ 新目录 overview-send-images + onPaste 落盘插 markdown + 远端块禁用 + 10MB 上限 + 落盘失败不留半截引用。

## 来源

- internal：（待补）

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/commontext-paste-image.test.ts && echo N1124_PASTE_LIB_OK` → `N1124_PASTE_LIB_OK`
- [ ] `npx vitest run frontend/app/session-overview/overview-send-paste.test.tsx && echo N1124_PASTE_UI_OK` → `N1124_PASTE_UI_OK`

## 记录

_（待补）_
