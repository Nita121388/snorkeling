# 会话批注 Block 与 Obsidian 导出

> 父任务：`10-25-aisessions-annotation-timeline`。格式契约见父任务 `design.md` §6。

## Goal

把「哪些会话被我认真批注过」变成一个可浏览、可导出的入口；导出成 Obsidian 可直接消化的 md，且导出重活不占主线程。

## Requirements

### 会话批注 Block

- 新 view `aiannotations`，`makeAnnotationsBlockDef()`；注册默认 widget `DefaultAnnotationsWidgetId` + `widgets.json` 默认条目（icon `highlighter`）。
- 列表数据来自 `AnnotationSessions`（只含 `status='accepted'`）。
- 每行：标题、项目、来源、批注数、标签云、最近批注时间、首条批注预览。
- 行内操作：打开会话详情（跳到该批注节点）、预览、导出。
- 顶部：搜索 + 标签筛选 + 项目前缀筛选。
- 预览：抽屉内渲染 md（复用 `markdown.tsx`，不改其核心）。

### Obsidian 导出

格式（严格按父任务 design.md §6 的快照）：

- frontmatter：`title/session_id/session_key/project/cwd/model/source/started/annotation_count/exported_at/tags[]`
- 正文：消息流（角色 emoji + 时间 + 工具输出 `<details>` 截断）
- 每条批注：`> [!annotation] 标题` + 正文 + `#标签`
- 文末 `## 🧭 批注时间线`：`- [[#m-12|21:12 · 标题]]` wikilink 列表
- 只有 `accepted` 进导出；草稿永不导出
- 文件名 `{project}/{date}_{time}_{title}.md`，Windows 保留名 / 尾部点空格清洗

### 异步、不影响主程序

- 渲染器是**纯函数**（无 IO，可单测）；worker 只做「读库 → 调渲染 → 写盘」。
- 逐条 message 追加写 `bufio.Writer`，**禁止全量 `strings.Join`**（60MB 会话是已知踩坑）。
- 并发 1–2，`context` 可取消，进度经 wps 事件推前端。
- 主界面只显示进度并在完成后给「打开文件 / 复制路径」。

## Acceptance Criteria

- [ ] 批注 Block 只列出有已采纳批注的会话，计数与详情页一致
- [ ] 列表可搜索、按标签/项目筛选，结果正确
- [ ] 行内「打开会话」能定位到该批注所在节点
- [ ] 导出的 md 在 Obsidian 中：frontmatter 被识别为属性、`[!annotation]` 渲染为 callout、`#annotation/xxx` 进标签面板、文末 wikilink 可跳
- [ ] 草稿零泄漏：导出文件里不出现任何 `status='draft'` 内容
- [ ] 导出 60MB 会话期间 UI 全程可交互，进度可见，可取消
- [ ] 取消后不留半截文件（临时文件 + 原子 rename）
- [ ] `go test ./pkg/aisessions -run AnnotationExport` 与 `npx vitest run frontend/app/view/annotation-block` 全绿

## 明确不做

- 增量/双向同步 Obsidian vault（只单向导出）
- 多选批量导出（等列表多选任务沉淀后再接）
- 导出为 HTML/PDF
- 修改 provider 会话文件
