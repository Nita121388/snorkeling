# overlay 结构性声明台账（parity-harness 切片 1）

作用域：`frontend/app/element/markdown.scss:681-896`（`.inline-edit-overlay`，216 行）

| 分类 | 数量 | 含义 |
|---|---|---|
| A 供能性 | 15 | caret / selection / hover / focus-visible / cursor / 容器布局 —— 合法 |
| **B 结构性镜像** | **54** | **待移除**：编辑态抄了一份预览渲染器样式（已逐条登记在测试台账里） |
| C textarea 回退 | 24 | `.inline-edit-textarea` 路径；textarea 天然无法与预览像素一致，单独成组 |

## B 类的分布（问题高度集中）
- **code 块（~30 条）**：`&[data-block-kind="code"] pre.codeblock { padding / border-radius / height / background }`、
  `> code.hljs { font-size / line-height / color }`，以及 **12 条 hljs 语法高亮配色**
  （`.hljs-quote` / `.hljs-string` / `.hljs-name` / language-diff 的 addition/deletion …）
  → 连颜色都复制了一份，属于「两套主题」。
- **WYSIWYG 背景覆盖（1 条）**：`&[data-block-kind="wysiwyg"] { background: … }`
- **编辑容器归零（~6 条）**：`.wysiwyg-editor h1-h6 { margin-left/right/width/box-sizing }`
- **overlay 容器自身（2 条）**：`box-sizing` / `overflow` → 判定为 `keep`（包裹层，非块内容）

完整机器可读台账：同目录 `overlay-structural-inventory.json`（本地保留，不入库）；
权威台账在测试里：`frontend/app/element/overlay-style-contract.test.ts` 的 `KNOWN_STRUCTURAL_MIRRORS`。

## 切片 2 的移除目标
所有 `todo: "parity-2"` 条目（52 条，`keep` 的 2 条除外）。移除方式：删掉镜像声明，让预览渲染器样式生效，
再用隔离沙箱做「编辑态 vs 预览态」computed style 比对确认零差异。

## 附带发现（token 台账，`todo="fix-token-2"`）
- `--wolai-quote-border-color`：0 定义，回退 `rgba(0,0,0,0.12)` → **暗色下引用块左边框几乎不可见**
- `--wolai-editor-color`：0 定义，回退 `rgba(0,0,0,0.85)` → **暗色下文字近黑**
- `--font-monospace`：0 定义且**无回退** → `font-family` 整条声明失效
- `--input-bg-color` / `--input-border-color` / `--text-placeholder`：0 定义，回退硬编码色值 → 浅色主题不匹配
- 无害：`--content-bg-color`（fallback 链）、`--markdown-tab-size`（回退 4）
