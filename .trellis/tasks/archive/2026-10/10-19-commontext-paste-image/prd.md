# CommonText 支持粘贴图片

## Goal

在 CommonText 编辑/撰写场景中，支持直接粘贴剪贴板图片，落成文件并插入可用的图片引用。

## 现状

- `frontend/app/commontext/` 下为 `commontext-compose-modal.tsx`、`commontext-insert.ts`、`commontext-model.ts`
- 当前无图片粘贴分支
- 项目里已有图片附件先例：聊天输入 `chat-composer.tsx` 与 `chat/events.go` 的 `ImageContent`（base64）

## Requirements

### 粘贴

- 在 CommonText 编辑区 `Cmd/Ctrl+V` 粘贴剪贴板中的图片时，识别图片并处理
- 支持常见格式（png / jpeg / gif / webp）
- 粘贴纯文本行为保持不变

### 落盘与插入

- 图片需先落成文件（放到合适的附件目录），再在文本中插入引用
- 插入后立即在预览/渲染中可见
- 文件名需稳定可读（沿用项目已有命名约定，参考 `waveterm_paste_*` 模式）
- 落盘失败时不插入半截引用，需给出可理解的错误提示

### 边界

- 多张图片同时粘贴时按顺序全部处理
- 图片过大（例如 >10MB）需给出提示或拒绝，避免卡死
- 不破坏现有纯文本插入与撤销行为

## Acceptance Criteria

- [ ] 在 CommonText 中粘贴截图，能插入图片引用并可见
- [ ] 粘贴纯文本行为无变化
- [ ] 一次粘贴多张图片全部生效
- [ ] 落盘失败时有明确错误提示，且不留下坏引用
- [ ] 超大图片有保护
- [ ] 有测试覆盖粘贴事件分发（图片 vs 文本）