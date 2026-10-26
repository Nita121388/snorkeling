# PRD: AI 提示词按功能区分 + 可配置提示词设置页

## 背景

当前 Agent 会话卡片（`AgentHoverCard` / `SessionDetailInfoCard`）的 Note AI 能力，其系统提示词硬编码在
`pkg/aisessions/metagenerate.go:51` 的 `metadataSystemPrompt` 常量中：

- 用户无法修改提示词、无法追加语言/风格约束；
- 无法为不同功能使用不同提示词（目前只有 note+tags 一个功能）；
- 无法选择生成使用的模型（固定 `waveai@quick` 优先）；
- 无法调整 note 长度、tag 数量等约束。

同时，会话标题当前只有「首条用户消息截断」与「手动重命名」，没有 AI 生成能力。

## 目标

1. **提示词按功能区分**：以 feature key 为索引注册提示词配置，首版支持两个功能：
   - `session-note-tags`：生成会话 note + tags（已有能力，改造为可配置）
   - `session-title`：生成会话标题（**新增能力**）
2. **用户可编辑提示词**：新增 `aiprompts.json` 配置 + Settings 可视化页面；支持「覆盖系统提示词」「追加额外指令」「选择模型」「调整约束」「恢复默认」。
3. **设置页风格统一**：与现有 `Wave AI Modes` / `Agent Notifications` 设置页一致（waveconfig 侧栏页 + 双栏布局 + Tailwind token），不引入新的设计系统。

## 范围（用户确认）

只做两个功能：Session Note & Tags、Session Title。

## 非目标

- 不做 commit message、会话摘要等其它 feature（注册表预留扩展点，但 UI 不展示、后端不实现）
- 不改 `waveai.json` 结构与现有 `AIModeConfigType` 消费者
- 不改 note/tags 的存储格式（仍为 `SessionSummary.note/tags`）
- 不实现「自动/定时生成」，保持手动触发（用户点击魔法棒）
- 不做多语言提示词模板市场

## 用户故事

1. 作为用户，我想在 Settings → AI Prompts 看到按功能区分的提示词列表，并分别编辑两个功能的提示词。
2. 作为用户，我想追加「用中文输出」这类指令，而不必重写整个系统提示词。
3. 作为用户，我想为 note/tags 生成指定模型，并调整 note 长度上限与 tag 数量。
4. 作为用户，我想一键恢复某个功能的默认提示词。
5. 作为用户，我想在 Agent 会话卡片上点击按钮，让 AI 生成会话标题，确认后写入。
6. 作为用户，当配置缺失或损坏时，功能应回退到内置默认而不是报错。

## 验收标准

- [ ] 新增 `aiprompts.json`（configDir 下），后端通过全量配置 watcher 读取并广播；文件缺失时行为与现状一致
- [ ] `session-note-tags` 的 systemPrompt / extraInstructions / aiMode / maxNoteChars / maxTags 生效
- [ ] `session-title` 的提示词生效，AI 生成的标题是建议值，用户 Apply 后才写入
- [ ] Settings 新增「AI Prompts」页，左栏两个功能项，右栏表单可编辑并持久化
- [ ] 支持「恢复默认」（清空覆盖字段）与「预览最终提示词」
- [ ] 空/超长/非法配置自动回退默认，不阻塞功能
- [ ] 会话卡片标题行提供 AI 生成标题入口（建议 → Apply / Dismiss）
- [ ] Go 单测覆盖 prompt resolve、参数夹取、title 解析；前端单测覆盖设置页状态与脏标记
- [ ] lint、typecheck、相关单测通过
- [ ] 窄窗口（≥700px）布局不溢出，与现有设置页视觉一致

## 里程碑

- M1 后端：`AIPromptConfigType` + FullConfig 读取 + prompt registry + 默认提示词
- M2 后端：`session-note-tags` 接入可配置；新增 `GenerateTitle` 能力与 RPC
- M3 前端：Settings → AI Prompts 双栏页面
- M4 前端：会话卡片标题 AI 生成入口（建议/应用/忽略）
- M5 测试、视觉核对、spec 更新与提交
