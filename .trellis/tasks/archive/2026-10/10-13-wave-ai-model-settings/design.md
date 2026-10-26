# Design: Wave AI 模型设置界面 + Note AI 合并

## 1. 现状梳理

### 1.1 Wave AI 配置模型(不变,只读)

```jsonc
// waveai.json — Record<string, AIModeConfigType>
{
  "custom@openai": {
    "display:name": "OpenAI",
    "ai:provider": "openai",
    "ai:apitype": "openai-responses",   // google-gemini | openai-responses | openai-chat
    "ai:model": "gpt-5-mini",
    "ai:endpoint": "https://api.openai.com/v1/responses",
    "ai:apitokensecretname": "OPENAI_KEY",
    "ai:thinkinglevel": "medium",
    "ai:verbosity": "medium",
    "ai:capabilities": ["tools", "images"]
  },
  "waveai@quick": { "display:name": "Quick", "waveai:cloud": true, ... }
}
```

Go 侧类型:`pkg/wconfig/settingsconfig.go` 的 `AIModeConfigType`。前端类型:`frontend/types/gotypes.d.ts` 生成。

### 1.2 数据流(现状)

```
waveai.json (磁盘)
  → 后端 watcher 读取 → waveai:modeconfig 事件 → globalStore.set(waveaiModeConfigAtom, configs)
  ← 前端保存: FileWriteCommand 写 waveai.json (visual tab 即时保存)
```

- `atoms.waveaiModeConfigAtom: PrimitiveAtom<Record<string, AIModeConfigType>>` — 唯一直读源
- 设置项:`waveai:defaultmode`(settings.json),读写走 `SetConfigCommand`

### 1.3 Lyra 参考(界面蓝本)

- `ModelSettings.tsx`:双栏布局(左 provider 列表 232px + 右编辑器,`@container @xl` 断点,窄窗堆叠)
- `ProviderEditor.tsx`:表单字段(名称重命名、API Format Segmented、Base URL、API Key + 内联测试按钮)
- `ProviderModels.tsx`:模型行(测试、默认标记、能力图标、菜单)
- `useProviders.ts`:数据操作封装(CRUD/test/fetch)
- `FetchModelsModal.tsx`:拉取模型弹窗

**适配**:Snorkeling 每 mode 自带单模型字段,不需要 Lyra 的 Provider→Models 两级。映射:
- 左栏列表项 = 一个 mode(key 如 `custom@openai`)
- 右栏表单字段 = `AIModeConfigType` 字段直接编辑
- "默认" = `waveai:defaultmode` 设置等于该 mode key

## 2. 架构

### 2.1 新前端文件

```
frontend/app/view/waveconfig/waveaivisual.tsx      // 重写:双栏主布局(替换 19 行占位)
frontend/app/view/waveconfig/waveai-modes.ts       // NEW: mode CRUD 数据操作(读 atom + FileWrite 写回)
frontend/app/view/waveconfig/waveai-test.ts        // NEW: 测试连接 / 拉取模型(纯逻辑 + RPC 封装)
frontend/app/view/waveconfig/waveai-templates.ts   // NEW: 模板定义(从分支移植 templates 数组)
```

waveconfig-model.ts 中 `Wave AI Modes` 配置项启用 `visualComponent: WaveAIVisualContent`(取消注释)。

### 2.2 新后端 RPC

在 `pkg/wshrpc/` 增加两个命令(放 `wshremote` 或现有 AI 相关 service):

```
TestAIConnectionCommand(ctx, { modeKey, endpoint, apitype, model, tokenSecretName })
  → { ok, latencyMs, message }

FetchAIModelsCommand(ctx, { endpoint, apitype, tokenSecretName })
  → { models: string[], error }
```

实现位置候选:
- `pkg/aiusechat/` 已有 `GetAIOptsForMode` / `RunCompletion`,测试连接可直接跑一次最小 completion(或直接 HTTP HEAD/GET /models)
- 拉模型:GET `{endpoint}/models`(OpenAI 兼容),需带 key 头,解析 `data[].id`
- **安全性**:token 从 secret store 读取(现有 `GetSecretsCommand`),不在请求/响应中明文回传

**测试连接两种方式权衡**:
1. 直接 HTTP:快、无副作用,但不能验证模型可用性
2. RunCompletion 最小消息:真实,但消耗一次 token
→ **采用**:测试连接用 RunCompletion(1 条 "ping" 消息,maxOutputTokens 小);拉模型用 HTTP GET /models。

### 2.3 Note AI 合入(从分支移植)

后端(已有实现,直接 cherry-pick 相关 commit 内容):
- `pkg/aiusechat/completion.go`(RunCompletion / GetAIOptsForMode / DefaultMetadataAIMode)
- `pkg/aisessions/metagenerate.go` + `_test.go`
- `pkg/service/aisessionsservice/aisessionsservice.go`:GenerateMetadata 方法 + 请求/响应类型
- `pkg/wshrpc/wshrpctypes.go` / client 类型:重新生成(走 `cmd/generate`)

前端:
- `frontend/app/view/term/agent-ai-config.ts` + `_test.ts`
- `frontend/app/view/term/agent-hover-card.tsx`:魔法棒按钮 + 提案预览(Apply/Regenerate/Dismiss)

### 2.4 冲突处理策略

分支 vs main 冲突的 6 个文件:
- `element/info-card/*`(3 个):**内容与 main 完全一致 → 丢弃分支版本**,保留 main
- `block.scss` / `block.tsx`:分支改动小(+14/-6 / +63/-84),**以 main 为主,手工补分支改动**(主要是魔法棒按钮位置样式,可能已无需)
- `agent-hover-card.tsx`:双方都大改,需要**人工合并**(分支的生成按钮逻辑 + main 的新卡片结构)

**实施方式**:不用整分支 merge,而是:
1. 从分支 checkout AI 相关文件到工作区(completion/metagenerate/agent-ai-config/模板)
2. agent-hover-card.tsx 手动合并
3. 其他冲突文件一律保留 main 版本

## 3. 界面设计(仿 Lyra 双栏)

```
┌─────────────────────────────────────────────┐
│ Wave AI Modes                    [添加模式 ▾] │
│ 配置 Wave AI 使用的模型。内置 Wave Cloud 模式 │
│ 直接可用;自定义 provider 使用系统钥匙串密钥。 │
├───────────────┬─────────────────────────────┤
│ 模式列表 (232px)│  选中模式编辑              │
│ ┌───────────┐ │  [头像] 名称(点击重命名)     │
│ │ ▸ Quick   │ │   API 类型 [Responses|Chat] │
│ │   Balanced│ │   Endpoint [____________]   │
│ │   Deep    │ │   模型名  [____________]     │
│ │   OpenAI  │ │   API Key secret [___] [测试]│
│ └───────────┘ │   [设为默认] [删除]          │
│               │   能力:tools images pdfs      │
├───────────────┴─────────────────────────────┤
│ (添加模式弹窗:模板卡片 openai/anthropic/...)  │
└─────────────────────────────────────────────┘
```

- 断点:复用 Lyra 的 `@container @xl` 思路——Snorkeling 用 Tailwind 类(与 waveconfig.tsx 现有样式体系一致)
- 保存策略:仿 Lyra **每键提交**(onChange 即写回),无 Save 按钮(visual tab 本就即时保存)
- 删除/重置默认:确认弹窗(复用现有 Confirm 组件)
- 添加模式:弹出模板选择(Popover/Modal),点模板 → 创建 mode → 左栏选中新项

## 4. 边界与安全

- 只改 `waveaivisual.tsx` + 新增 `waveai-*.ts` + waveconfig-model.ts 一行取消注释
- 后端新增独立 RPC,不动现有 `RunAIChat` / `waveai-model.tsx` 消费路径
- Note AI 是纯提案,不写库(分支设计已保证)
- 测试连接/拉模型带超时(5s/15s),不阻塞 UI
- token secret 只读不写不回传

## 5. 测试计划

- Go:`metagenerate_test.go`(分支已有)+ 新增 `TestAIConnection` / `FetchAIModels` 单测(mock HTTP)
- 前端:`agent-ai-config.test.ts`(分支已有)+ waveai-modes 纯逻辑测试 + waveai-templates 测试
- 手动:Settings 打开 Wave AI Modes visual tab,CRUD 全流程 + 测试连接真实走通

## 6. 实施顺序

1. **M1**:cherry-pick Note AI 后端(completion/metagenerate/service/RPC types 生成)→ go test
2. **M2**:前端 Note AI(agent-ai-config + agent-hover-card 合并)→ 编译 + 单测
3. **M3**:编辑器骨架(双栏 + 列表渲染,读 waveaiModeConfigAtom)
4. **M4**:编辑表单 + CRUD + 模板添加(写 waveai.json)
5. **M5**:测试连接 RPC + 拉模型 RPC(前端按钮接 RPC)
6. **M6**:收尾——全量测试、lint、typecheck、trellis-check、commit
