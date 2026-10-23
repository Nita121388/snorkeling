# AI Prompt Config Contract

> `aiprompts.json`（按功能区分、用户可覆盖的 AI 提示词）的后端契约。

---

## 1. 文件与类型

- 位置：`<WaveConfigDir>/aiprompts.json`
- Go 类型：`pkg/wconfig.AIPromptConfigType`
- 读取路径：`FullConfigType.AIPrompts map[string]AIPromptConfigType`（json tag `aiprompts`）
- `ReadFullConfig()` 按 json tag 反射读取同名文件，`filewatcher` 变更后经 `fullconfig` 事件广播到前端
  `atoms.fullConfigAtom.aiprompts`。**不要为它新增独立 watcher。**
- 文件缺失 / 字段缺失 / JSON 损坏：字段保持零值，`ConfigError` 记录在 `configerrors`，
  生成功能回退到内置默认，不得因此报错或阻断。

```jsonc
{
  "session-note-tags": {
    "systemPrompt": "",        // 空 = 内置默认；非空 = 完全覆盖
    "extraInstructions": "",   // 追加在 system prompt 之后
    "aiMode": "",              // 空 = 用户默认模式 → waveai@quick
    "maxNoteChars": 160,       // 0/缺省 = 默认；夹取 [40, 2000]
    "maxTags": 5,              // 0/缺省 = 默认；夹取 [1, 10]
    "enabled": true            // 缺省 = 启用；显式 false 禁用该功能
  },
  "session-title": {
    "systemPrompt": "",
    "extraInstructions": "",
    "aiMode": "",
    "maxTitleChars": 40,       // 0/缺省 = 默认；夹取 [10, 120]
    "enabled": true
  }
}
```

`Enabled` 是 `*bool`：**unset ≠ false**。只在显式写 `false` 时禁用。

## 2. 解析顺序（唯一实现）

`pkg/aisessions/promptregistry.go`：

```
ResolvePrompt(feature, cfg):
    base = cfg.SystemPrompt（非空白）? : built-in default
    base += "\n\nAdditional instructions:\n" + cfg.ExtraInstructions（非空白）
    base += 硬上限说明（note/tags 或 title）
    clamp 到 MaxPromptChars = 8000
ResolveAIMode(cfg): aiusechat.DefaultMetadataAIMode(cfg.AIMode)
```

**优先级**：`aiprompts.json` 的 `aiMode` > 调用方传入的 `aiMode`（前端可用性预检选出的模式）
> 用户默认模式 > `waveai@quick`。设置页显式选择模型后，会覆盖卡片侧预检选择的模式。

**默认截断兼容**：未配置 `maxNoteChars` 时，prompt 仍要求 160 字符，但解析侧沿用历史的
500 rune 截断（`metadataDefaultNoteRunes`），因此删除 `aiprompts.json` 与改造前一致。
配置了`maxNoteChars` 后，prompt 与解析截断都使用该值（上限 2000）；`maxTags` 同理（上限 10）。

- 新增 AI 功能必须在这里注册 feature key + 默认提示词 + 参数边界，**不得**在调用点复制一份 resolve 逻辑。
- feature key 常量在 Go 侧定义，前端 `aiprompt-model.ts` 的 `PROMPT_FEATURE_ORDER` 必须与之同步。
- `PromptTemplates` RPC 返回默认提示词与参数元数据，供设置页「恢复默认 / 预览」。

## 3. 生成链路不变量

- **只提案，不落库。** `GenerateMetadata` / `GenerateTitle` 返回 suggestion；写库只发生在用户
  Apply 之后的既有 `NoteAndTags` / `Title` RPC。
- `enabled=false` 时 RPC 直接返回明确错误（`... is disabled in AI Prompts settings`）。
- 数值上限既写进 prompt，也在解析结果时强制截断（双保险）；防御性上限
  `metadataMaxNoteRunes` / `metadataMaxTags` 仍是硬 ceiling。
- 输出必须是单个 JSON 对象；容忍 markdown fence；解析失败返回明确错误。
- 生成的标题只取 `suggestion.title`，去掉首尾引号与句点，再夹取长度。

## 4. 前端契约

- 唯一写入点：`frontend/app/view/waveconfig/aiprompt-model.ts#savePromptConfig`
  （整文件 `FileWriteCommand` + 串行写队列；先更新本地投影，避免 watcher 回广播把删除项复活）。
- 设置页只写「与默认不同」的字段；`Reset to default` 通过写空 payload 删除该 feature key。
- `PromptTemplates` 返回的 `defaultPrompt` 是**原始内置文案**（不含 extra / hard limits）；
  设置页预览负责追加一次约束，`ResolvePrompt` 在生成时追加一次。任何一侧都不要重复拼接。
- `previewPrompt` 必须与后端 `ResolvePrompt` 的拼接顺序一致（默认 → extra → hard limits）。
- 会话卡片标题提案复用 `session-note-hook.ts` 的 proposal 状态机，Apply 后才调用 `Title`。

## 5. 验证清单

- [ ] 删除 `aiprompts.json` 后行为与改造前一致
- [ ] 只写 `extraInstructions` 能影响输出且不丢内置规则
- [ ] `maxNoteChars` / `maxTags` / `maxTitleChars` 越界被夹取
- [ ] `enabled=false` 时两个生成入口均被拒绝
- [ ] 设置页保存 → watcher 回广播 → 再生成使用新提示词
