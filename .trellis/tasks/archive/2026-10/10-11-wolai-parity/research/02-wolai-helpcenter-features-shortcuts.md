# Lane 2/4 — Wolai 帮助中心：特性 / 快捷键 / 块能力（研究记录）

**唯一交付物（正式报告）**：
`/Users/nita/Primary/obsidians/Obsidian/My Projects/Snorkling/方案/Block-Editor 笔记编辑体验升级/参考-Wolai对标/02-帮助中心-特性与快捷键.md`
（896 行，含抓取范围/覆盖率、快捷键全表、slash 命令全表、22 类块逐项、行内元素、块菜单与多选、导入导出、对本项目的 5 条结论、附录复现命令）

**原始产物**：`research/wolai-helpcenter-raw.tgz`（971 KB，解压含 `raw/` 103 个页面块树 JSON、`txt/` 渲染文本、`titles_map.json`、`sub.json`、`crawl_all.py`、`render.py`、`coverage.md`）

---

## 关键结论（供汇总文档直接用）

### 1. 抓取方法（可复现，无需登录）

Wolai 帮助中心有**公开只读 API**，比抓 DOM 可靠得多（DOM 会因网络抖动退回「网络可能有一点问题」错误页）：

- `POST https://api.wolai.com/v1/pages/getPageChunks` → 块树（类型 + 富文本 + setting）
- `POST https://api.wolai.com/v1/pages/getSharedSubPages` → 整棵子页面树

**最大的坑**：分页必须回传上一次响应的 `data.position`，`position.stack` 为空才结束。只用 `chunkNumber` 递增会漏约 45% 的块（Mac 快捷键页 101 → 实际 184 块）。

### 2. 覆盖率

侧边栏 97 条 **100% 抓到**；加根页面 + 5 个非侧边栏关键页（Mac/Windows/iPad 快捷键、快捷命令列表、Markdown 与快捷输入）= **103 页**，无 404。

### 3. 快捷键（§2，全表在正式报告）

- Mac / Windows / iPad 三页结构完全一致，diff 只差修饰键（`cmd↔ctrl`、`opt↔alt`）→ **我们只需维护一套 + 机械替换两套**。
- 全局：`cmd+P` 搜索、`cmd+shift+P` 关系图、`cmd+shift+L` 标题目录、`cmd+L` 锁屏、`cmd+shift+C` 编辑保护、`cmd+shift+U` 显示块虚线框。
- 编辑器：`esc` 选中块、`tab/shift+tab` 缩进、`cmd+/` 块菜单、`cmd+D` 克隆块、`cmd+shift+@` 移动到、`cmd+shift+G` 嵌入到、`cmd+shift+↑↓` 移动块、`cmd+opt+T` 全页折叠列表开合。
- 块选中态多选：`shift+↑↓` 相邻多选、`cmd+点击` 任意多选、`cmd+A` 全选、`opt+拖动` 复制副本、单键 `A`/`B` 上/下插入一行、单键 `C` 切对齐、`Q` 复制嵌入引用、`` ` `` 复制行内引用、`F` 复制块链接。
- 颜色：`cmd+1..6` 背景色、`cmd+7/8/9` 文字色红绿蓝、`cmd+0` 默认。
- 快速转换：`cmd+opt+0..9` + `cmd+opt+-` / `cmd+opt++`。
- 文本样式：`cmd+B/I/U`、`cmd+shift+S` 删除线、`cmd+E` 行内代码、`cmd+K` 链接、`cmd+shift+R` 页面引用、`cmd+shift+X` 行内公式。

### 4. Slash 命令（§3）

**通用规则**：所有块都支持**拼音缩写 / 全拼 / 英文**三路匹配（`/ym` `/yemian` `/page` `/页面` 等价）。这是最容易被我们漏掉的设计点。

命令总量约 90 条，覆盖：新建块（含 H1–H9、6 种数据表格视图）、块转换（`/zh`+缩写）、行内元素、脚注注释、媒体附件、引用、wol.AI、快速输入、分栏、简单表格、15 个第三方应用、快速功能、颜色（文字色 9 种 + 背景色 11 种）。

### 5. 块类型真值表（§5）

**Wolai 内部 `type` 字段实测值**（从 5126 个块统计，非推测）：
`text` `bullList` `enumList` `todoList` `todoListPro` `toggleList` `page` `quote` `callout` `code` `blockEquation` `divider` `simpleTable` `table` `tableCell` `row` `column` `database` `chart` `progressBar` `toc` `image` `video` `audio` `file` `embed` `bookmark` `bilibiliVideo` `xiguaVideo` `neteaseMusic` `header` `midHeader` `subHeader` `tinyHeader` `fiveHeader` `toggleSubHeader` `toggleTinyHeader`

值得抄的高价值可配置项：
- `progressBar`：颜色（9 具名 + **自定义 hex**）、隐藏数字、**自动模式**（统计同级待办完成度）
- `callout`：图标（Emoji/FA/动态图标/图片链接/上传）、背景色、**跑马灯模式**；下次创建沿用上次图标与背景
- `code`：语言自动识别、自动换行、**代码连字**、显示行号、说明文字、折叠/拖拽调高；特殊语言 `Mermaid` / `ybsz`
- `simpleTable`：**合并单元格**、单元格内可插块（不支持插数据表格与分栏）
- 按钮：5 种动作类型 + 变量 `<%DATE%>` 等 + 一次性模板
- 仪表数字：`title 名称 format 数字 decimal 颜色` 6 段 DSL，单块最多 5 个

### 6. Markdown 可表示性（§4 + §7）— **本车道最重要的产出**

**Wolai 自己承认的边界**：
- 支持标准 md：`#`..`######`、`[] `、`1. `、`* ` `- `、`> `、`---`、```` ``` ````、```` ```lang ````、`$$ `、`$$...$$`、`**`/`*`/`~`/`` ` ``
- **明确不支持 md 表格语法**（原文：不支持 Markdown 的表格语法直接输入，要插入数据表格用 `/jdbg` 或 `/3x3`）
- **非标准扩展语法**：`#######`–`#########`（H7–H9）、`+#`（折叠标题）、`+`（折叠列表）、`()`（高级待办）、`+[]`/`+()`、`" `/`| `（引述）、`!!`（callout）、`!!!`（跑马灯）、`[[`/`((`/`{{`/`#`（引用）、`::`（Emoji）、`;;`（FA）、`[toc]`（页面目录）
- **完全无 md 表达**：数据表格、统计图表、进度条、按钮、会议、思维导图、仪表数字、分栏、嵌入第三方

### 7. ⚠️ 未验证项（必须登录实测）

**Wolai 导出 markdown 的逐块降级语法拿不到**，原因已穷尽：
1. 导出是**服务端**行为：`POST https://api.wolai.com/v1/exportMarkdown`（需登录，匿名返回 `user not in space`）；客户端 73 个 JS chunk（19MB）全部下载检索后确认**没有 markdown 序列化器**，只有解析/粘贴。
2. 帮助中心只说了 ZIP 结构（`<空间名>.md` 索引 + `pages/` + `images/` + `video/` + `file/`）和「数据表格导出为原始数据，不包含视图」，**没有逐块语法**。
3. 公开网络上没有逐块规范。

**已确认的导出事实（可放心引用）**：
- 格式：Markdown(.zip) / HTML(.zip) / Word(.docx) / CSV / XLSX / PDF
- Markdown 选项：`包含子页面`、`树状目录`（默认开）、`生成目录`（跟随标题目录设置 / 不生成 / 全部生成）
- 接口 body：`{"pageId","pageTitle","options":{"recoverTree","generateToc":"auto","includeSubPage"}}`
- 导出文件名形如 `<标题>_<21或22位ID>.md`；**页面间链接写的是线上 `https://www.wolai.com/...` 地址，不是相对 .md 路径**（第三方迁移脚本实证）
- 整空间导出：仅创建者、每 7 天 1 次、仅 markdown、下载链接 3 天有效

正式报告 §7.4 给了**15 条最小验证实验清单**，实现阶段登录后跑一遍即可得到真值表。

---

## 给其他车道的接口

- 车道 3（思源对标）：Wolai 的块类型名清单 + 可配置项清单可直接对齐；`callout` 对标思源无对应块，`todoListPro` 4 状态也无对应。
- 车道 4（本项目现状与可表示性）：本报告 §7.3 的「强约束表」是**文件格式能写什么**的直接上限；§8 的 5 条结论可直接进设计文档。
