# Markdown 预览/编辑：导出 HTML / PDF — 设计文档

> 设计时间：2026-09-03
> 目标功能：在 md 预览区/编辑区新增「导出为 HTML / PDF」，把当前文档按**干净的渲染成品**导出，而非导出源码。

---

## 0. 需求理解

**用户原意**：为 md 预览编辑能力补充导出 `pdf/html` 文件的功能，并明确**导出成品中哪些属性/元素展示、哪些隐藏**。

**本方案界定的范围**：
- 输入：当前打开的 `.md` 文档（含 frontmatter/Obsidian 属性、代码块、表格、Mermaid、图片、TOC、嵌套列表等）。
- 输出：
  1. **HTML**（单一 `.html` 文件，内联全部 CSS，图片用绝对路径或 base64 内联，双击即可在浏览器打开）。
  2. **PDF**（由渲染好的 HTML 通过 Electron `webContents.printToPDF` 打印生成，保真度与预览一致）。
- 非目标：不导出**正在编辑的临时草稿**（dirty draft）之外的状态；不做 `x.html.md` 之类的格式标签；不做多文件打包。

---

## 1. 现状调研

### 1.1 技术栈
- Electron `41.1.0`（支持 `webContents.printToPDF`，主进程可做 PDF 打印）。
- 前端 React 19 + `react-markdown@9` + rehype/remark 链：`transformBlocks → @@@块/!type[id]!!! → remark(mermaid/fileRefs/GFM) → rehype(slug/highlight/raw/sanitize) → ReactMarkdown`。
- 已有 frontmatter/Obsidian 属性渲染：`preview-plugin-registry` + md-properties 插件透传 `frontmatterBlock` + `waveBlockRenderers`（见 `obsidian-properties-plugin.md`）。
- 已有文件落地 IPC：`emain/emain-ipc.ts` 的 `save-text-file`（`dialog.showSaveDialog` + `fs.promises.writeFile`），可用作 HTML 落盘基座；PDF 需新增一条 `printToPDF` IPC。

### 1.2 可复用基础设施
| 能力 | 位置 | 用途 |
|------|------|------|
| 干净 HTML 渲染 | `Markdown` 组件 + preview 插件 | 直接输出可导出的 HTML |
| 保存对话框 + 写文件 | `emain-ipc.ts` `save-text-file` | 落盘 HTML |
| `webContents.printToPDF` | Electron 主进程 | HTML→PDF |
| `preview-plugin-registry` | `element/preview-plugin-registry.ts` | 让 frontmatter/自定义块在导出时同样生效 |

---

## 2. 总体方案（单条渲染管线，双输出格式）

复用**预览渲染管线**产出「导出专用 HTML 字符串」，再分叉为两条落盘路径：

```
当前 md 文本 (fileContent / 当前草稿)
   │  ① 组装（可选：保持 frontmatter / 剔除交互组件）
   ▼
渲染管线 ReactMarkdown（沿用 preview-plugin-registry）
   │  ② 序列化为静态 HTML 字符串（不依赖 React 运行时）
   ▼
============= 双输出分叉 =============
  ├─ HTML：内联 CSS + 标题/代码高亮 + 图片处理 → save-text-file 落盘 xxx.html
  └─ PDF ：把 HTML 注入一个隐藏 BrowserWindow → printToPDF → xxx.pdf
```

### 2.1 入口（三处，统一动作「导出」）
- 预览区顶部工具栏新增下拉：**导出 → 导出 HTML / 导出 PDF**。
- 命令面板 / 主菜单（`emain-menu.ts`）增加 `export: html|pdf` 命令，命中当前 preview 块。
- 编辑区（Monaco）内也可通过同一入口触发（导出当前源码渲染成品）。

### 2.2 HTML 导出实现要点
- 用**渲染管线 + `renderToStaticMarkup`** 或直接对预览根节点的 `outerHTML` 做一次脱壳取正文，去除交互 DOM（按钮、编辑器壳），保留语义节点。
- **CSS 内联化**：收集项目 markdown 样式（含 presentation/属性卡片样式）内联进 `<style>`，保证脱离应用后样式完整。
- **图片**：
  - 本地相对路径 → 解析为 `file://` 绝对路径（html 中可被浏览器打开）；可选 `base64` 内联（大文件体积顾虑，默认 `<img>` 引用路径）。
  - 远端图、Mermaid 已渲染 SVG、emoji 保持内联。
- **代码高亮**：沿用 `rehype-highlight` + shiki 产出的 HTML，导出时保留 `<code class="language-x">`。
- **文件名**：默认取 `文档名.html`；无扩展名时追加 `.html`。

### 2.3 PDF 导出实现要点
- 复用 2.2 的静态 HTML 字符串。
- 主进程开一个**不可见的离屏 `BrowserWindow`**（或复用现成 web 页 `printToPDF`），`loadURL(data:text/html,...)` 或写入临时文件后 `webContents.printToPDF({printBackground:true, pageSize:'A4', margins, printBackground})`。
- 空值兜底：A4、边距适中、背景色保留（深色主题需保证可读，见 §3 属性选择）。
- **不再另起 Chromium 进程**：直接走主进程打印，保真、可控。

---

## 3. 导出内容属性 —— 展示 / 隐藏清单（核心）

> 用户重点要求：明确「哪些属性需要展示、哪些不展示」。下表即唯一事实来源。

### 3.1 展示（保留）项 — 属于文档本体
| 内容 | 处理 |
|------|------|
| frontmatter / Obsidian 属性卡片 | **默认展示**（复用属性面板渲染），可单独开关 |
| TOC 目录（若开启） | 保留为静态目录（锚点跳转），可单独开关 |
| 标题、列表、嵌套有序列表 | 保留（含折叠状态的**展开态**展开全量内容） |
| 表格 | 保留 GFM 表格 |
| 代码块 | 保留带语言类名的高亮 |
| Mermaid 图 | 保留已渲染 SVG |
| 图片（本地/远端） | 保留，本地转绝对路径或 base64 |
| 行内样式（加粗/斜体/链接） | 保留 |
| 链接 | 保留 `href`（仓库内相对路径 → 绝对路径） |

### 3.2 隐藏（剔除）项 — 编辑器/预览的交互壳，不进成品
| 元素 | 理由 |
|------|------|
| 折叠/展开按钮、标题折叠箭头 | 编辑态交互，成品应展开 |
| 行内编辑按钮、保存/回滚提示、dirty 标记 | 仅编辑态 |
| 块侧栏、Widgets/右键菜单、命令面板 | UI 壳 |
| live-scroll 同步控件、presentation 全屏按钮 | 工具 |
| 空态占位、加载骨架、错误 overlay | 仅调试 |
| 复制代码按钮、tooltip、hover 卡 | 交互 |
| `md-properties` 的编辑入口（加/删属性按钮） | 编辑态，成品只读 |

/

### 3.3 可配置开关（导出设置面板）
让用户微调 §3.1 里的标黄项，避免一刀切：
- [ ] 包含 frontmatter 属性卡片　　（默认开）
- [ ] 包含 TOC 目录　　　　　　　　（默认随预览开）
- [ ] 图片内联 base64　　　　　　　（默认关，HTML 体积敏感）
- [ ] 应用当前深色主题　　　　　　（默认关，PDF 建议浅色以保证打印可读）
- [ ] 仅导出正文、剔除元数据　　　（默认关）

> 说明：「hi 展示/不展示」对应本表——**文档本体内容默认全部展示**；**编辑器交互壳与编辑态 UI 默认全部隐藏**；是否含 frontmatter/TOC/主题等由开关决定。深色主题默认不进入 PDF（打印可读性），如需可开启。

---

## 4. 新文件 / 改动清单

| 文件 | 改动 |
|------|------|
| `frontend/app/view/preview/preview-markdown.tsx` | 工具栏加「导出」下拉，串联导出流程 |
| `frontend/app/view/preview/preview-export.ts`（新） | 组装静态 HTML 字符串、图片/CSS/链接处理、导出设置模型 |
| `emain/emain-ipc.ts` | 新增 `export-html`（复用 save-text-file 思路）、`export-pdf`（printToPDF）两条 IPC |
| `emain/emain-menu.ts` | 增导出命令 |
| `hooks` 导出配置 atom | 记录导出开关偏好（jotai，本地持久化） |
| 测试 | `preview-export.test.ts`：frontmatter 是否保留、代码高亮类名、图片绝对路径化 |

---

## 5. 风险与注意
- **图片 base64 展开**：大文档体积骤增；默认关，文档内提示。
- **深色→PDF**：深色背景直接打印偏暗，默认关并在面板提示「建议浅色」。
- **frontmatter 双渲染**：导出时复用属性插件，避免 rerender 为 `---` 文本。
- **PDF 中文/emoji 字体**：需确认打印用字体含 CJK/emoji，否则乱码；走 printToPDF 与预览同字体源，风险低。

---

## 6. 交付建议
1. 先落地 **HTML 导出**（纯前端 + 复用 save IPC，见效快）。
2. 再落地 **PDF**（主进程 printToPDF，复用同一静态 HTML）。
3. 最后补**导出设置面板**与持久化，让 §3.3 开关可调。