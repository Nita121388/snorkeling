# PRD: Wave AI 模型设置界面(仿 Lyra)+ Note AI 生成功能合并

## 背景

- main 上 `frontend/app/view/waveconfig/waveaivisual.tsx` 只是一个 19 行的占位("Visual editor coming soon..."),waveconfig 里 "Wave AI Modes" 只有 JSON 视图可用。
- `feat/ai-session-metadata` 分支(2026-09-13)做了两件事:
  1. Wave AI 设置可视化(模板选择 + 复制 JSON)——半成品,体验是"选模板→复制→粘进 JSON",不是真正的可视化编辑
  2. **Note AI 生成**:AI 为 Agent 会话生成 note + 标签(后端 `metagenerate.go` + `completion.go` + `GenerateMetadata` RPC + 前端魔法棒按钮)
- 用户要求:界面参考 `~/Primary/projects/Lyra` 的 `ModelSettings` 系列(双栏 provider 管理 UI),把 Wave AI 配置做成**真正的可视化编辑器**(列表 + 编辑表单 + 测试连接 + 拉取模型),并把分支的 Note AI 生成功能一并合入 main。

## 目标

1. **Wave AI Modes 可视化编辑器**(替换占位):
   - 左栏:mode/provider 列表(名称、状态、默认标记)
   - 右栏:选中 mode 的编辑表单(名称、API 类型、Endpoint、模型名、Secret、能力、测试连接、设为默认、删除)
   - 添加模式:复用分支 templates(openai/anthropic/gemini/openrouter/groq/custom),点选即建
   - 测试连接:真实走通(成功显示延迟,失败显示原因)
   - 拉取模型列表:从 endpoint 的 `/v1/models` 拉取(可选下拉填充)
2. **合并 Note AI 生成功能**到 main:
   - `pkg/aiusechat/completion.go`(RunCompletion 无头文本生成)
   - `pkg/aisessions/metagenerate.go`(会话元数据生成)
   - `GenerateMetadata` RPC + 前端 `agent-ai-config.ts` 可用性判断 + agent-hover-card 魔法棒按钮

## 非目标

- 不改 Wave AI 运行时配置格式(`AIModeConfigType` / `waveai.json` 结构不变),AI 面板 `waveai-model.tsx` 等既有消费者零改动
- 不合并分支里的 VCS 分支管理 UI(d6222939,无关功能)
- 不合并 info-card 相关重复实现(main 已有 34bbac28,内容一致)
- 不动 agentstatus hooks / codex / claude / opencode 集成

## 用户故事

1. 作为用户,我想在 Settings → Wave AI Modes 看到可视化的模式列表,而不是手写 JSON
2. 我想添加一个自定义 provider(选模板或手填),不需要复制 JSON 到剪贴板
3. 我想测试连接,确认 endpoint + key + 模型可用,并看到延迟/错误
4. 我想从 endpoint 自动拉取可用模型列表,不用记住模型名
5. 我想为 Agent 会话一键生成 note + 标签(分支已有功能,合并进来)

## 验收标准

- [ ] Wave AI Modes 可视化编辑器可完整 CRUD 模式,配置写回 `waveai.json`(经 FileWriteCommand,向后兼容)
- [ ] 添加模式走模板引导,无需手写 JSON
- [ ] 测试连接真实调通(成功显示延迟,失败显示原因),有超时保护
- [ ] 拉取模型列表可用(成功填充,失败显示原因)
- [ ] Note AI 生成:agent-hover-card 魔法棒可生成 note/tags 提案并应用,配置为空/遥测关闭时有引导
- [ ] 前端/后端均有单元测试
- [ ] lint + typecheck 通过
- [ ] 不影响 waveai-model.tsx 运行时模式切换

## 里程碑

- M1: Note AI 后端 + RPC 合入(completion.go/metagenerate.go/GenerateMetadata + 生成 client types)
- M2: 前端 Note AI(agent-ai-config.ts + agent-hover-card 魔法棒)
- M3: Wave AI 可视化编辑器骨架(双栏布局 + 列表)
- M4: 编辑表单 + CRUD + 模板添加
- M5: 测试连接 RPC + 拉取模型 RPC
- M6: 收尾(测试、lint、check、发布准备)
