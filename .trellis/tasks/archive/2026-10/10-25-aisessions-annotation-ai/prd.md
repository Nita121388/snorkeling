# 批注 AI 生成（草稿 / 采纳 / 重新生成）

> 父任务：`10-25-aisessions-annotation-timeline`。契约见父任务 `design.md` §3、§5。

## Goal

只在用户点击时调用 AI，给本会话产出时间线批注；结果一律先落草稿，由用户裁决；重新生成永不覆盖人的东西。

**本阶段不做任何自动触发**（turn 闭合 / 空闲 / 扫描），那是 M3。

## Requirements

### 生成入口（手动，全部覆盖）

| 入口 | scope |
|---|---|
| rail 顶部「✨ 生成时间线」 | `timeline` |
| 编辑器「标题」旁 ✨ | `entry-title` |
| 编辑器「正文」旁 ✨ | `entry-body` |
| 编辑器「标签」旁 ✨ | `entry-tags` |
| 会话笔记旁 ✨ | `session-note`（**不重复实现**，接入 `10-25-aisessions-ai-gen` 的 AutoGenerate 通道；该任务未落地前此入口不做） |

**不变量：凡是需要手动输入的地方，都必须有这个 ✨。** 这是本子任务的验收主线。

> 协作边界：会话级 note/tags 的 AI 生成已由 `10-25-aisessions-ai-gen`（及其 `10-25-aisessions-note-ai-inline` 子任务）覆盖。本子任务**只做批注自己的四个 ✨**，会话笔记入口等它落地后接线，禁止另写一套 note 生成逻辑。

### ✨ 行为规范（唯一实现 `<AIAssistButton>`）

- 只填当前字段，不覆盖其它已填字段，不自动保存。
- 结果带 `AI · 未保存` 角标 + 「撤销 AI 结果」。
- 运行中 `⟳` + 字段只读；再点 = 取消（`context.Cancel` 贯通前后端）。
- 失败：字段下方内联一行，不清空用户已有内容；**不自动重试**。
- 未配置模型：置灰 + tooltip 指向设置页。

### 草稿与采纳

- AI 结果 `status='draft'` **落库**（不是内存），关掉详情页再回来还在。
- 草稿不计入批注角标、不参与导出。
- 单条采纳 / 丢弃 / 编辑；支持「全部采纳」「全部丢弃」。
- 采纳后 → `accepted + source='ai' + user_edited=0`（仍可被重新生成替换）。
- 用户编辑任一 AI 条目 → `user_edited=1`（从此不可替换）。

### 重新生成

- 确认弹层必须显示将被替换 / 将被保留的条数，并提供「保留我编辑过的条目」「同时清除未采纳草稿」两个开关。
- 替换在单事务内完成，失败整体回滚。
- 替换集合严格等于后端 `CanReplace()` 的判定结果，前端不得自行推导一套。

### prompt 与防腐

- `PromptFeatureSessionAnnotations` 注册进 `promptregistry.go`，`aiprompts.json` 支持 `maxAnnotations` / `maxBodyChars` / `maxTags`，夹取范围遵守 `ai-prompt-config-contract.md`。
- 模型只能从后端给的锚点清单里选，**服务端落库前二次校验**，非法 `anchorKey` 丢弃并计数。
- JSON 解析失败重试 1 次，仍失败返回错误，不写半成品。

### 异步

- `AnnotationAssist` 立即返回 `jobId`，后台 per-index-path 串行 worker 执行，单条 90s 超时，可取消。
- 入队 O(1)，AI 调用永不出现在请求路径上（仿 `titleautogen.go`）。
- 进度/结果经 wps 事件推送，前端按 `jobId` 填回对应字段。

## Acceptance Criteria

- [ ] 会话无批注时点「✨ 生成时间线」，产出 ≥1 条草稿，rail 显示草稿刻度
- [ ] 生成过程不阻塞消息流，可中途取消，取消后无残留半成品
- [ ] 三处批注 ✨（标题 / 正文 / 标签）可用，且不覆盖其它已填字段
- [ ] 「撤销 AI 结果」能恢复生成前内容
- [ ] 关闭详情页再打开，草稿仍在
- [ ] 重新生成：手写条目与 `user_edited=1` 条目**一条不动**（前后端各测一次）
- [ ] 非法 `anchorKey`/`kind` 被丢弃，不落库
- [ ] 未配置模型时 ✨ 置灰并给设置入口，不弹错误
- [ ] 会话笔记的 ✨ 只做接线，不重复实现 note 生成（归属 `10-25-aisessions-ai-gen`）
- [ ] JSON 破损场景只重试一次，失败不留脏数据
- [ ] `go test ./pkg/aisessions -run Annotation` 与 `npx vitest run frontend/app/view/aisessions` 全绿

## 明确不做

- 自动触发（M3）
- 批量 / 多选 AI 生成（等 `10-24-list-multiselect-batch-actions`）
- 跨会话批量重生成（M2 之后）
- 修改 provider 会话文件
