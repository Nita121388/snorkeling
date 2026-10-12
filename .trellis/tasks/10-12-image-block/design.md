# 设计：image-block

## 语法决策（对齐方案 C1）
- **写**：`![alt|WxH](path)`（Obsidian 约定；生态可读、git diff 干净）
- **读**：三种都认 → `![alt|WxH](path)`（首选）、`![alt](path =WxH)`（历史自研，只读兼容）、纯 `![alt](path)`
- **不再写** `=WxH`（避免 Obsidian 读不到）

## 数据安全（本任务的核心价值）
1. `serializeImage`：只要解析出尺寸就**必须**写回可被自己重新解析的形式，禁止产生"带尺寸但不可渲染"的输出
2. 解析失败 → **降级为纯 `![alt](path)`**（宁可丢尺寸，绝不丢图）
3. 新增单测覆盖三种语法 + 坏语法（当前零覆盖）

## 结构
- 包内（`md-core`）：`transform/image-size.ts`（解析/序列化尺寸）、`render/image.tsx`（渲染 + 拖拽手柄，宿主能力走 adapter）
- 宿主：`resolveImageSrc` / `openImageLightbox`（已存在）
