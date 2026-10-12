# 设计：footnote-math

## 脚注
- remark-gfm 产出 `footnoteReference` / `footnoteDefinition` → 渲染器注册表新增两项
- 定义区：文末聚合，样式复用既有 `<hr>`/小字号 token
- 编辑：定义块按「普通段落块 + 前缀保护」处理（复用 callout 的 `capturePrefix/applyPrefix` 模式：`[^1]: ` 前缀原文保真回写）
- 角标点击 → 滚动到定义（宿主滚动能力走 adapter）

## 数学（思源范式）
- 渲染：`rehype-katex` + KaTeX CSS（或自持最小样式，避免引入新颜色）
- 编辑：`math` 块 → 预览 KaTeX 渲染 + 下方源码输入区（`<textarea>` 或 codemirror-lite）；提交写回源码
- 禁止直接 contenteditable 编辑公式源码（KaTeX 生成的 DOM 不可直接编辑）

## schema 纪律
- 新增放行项**逐条**写入 `markdown-sanitize-schema.ts`（同一 tag 同属性只一条）
- 测试必须 import 真实 schema（不得写镜像 schema）
