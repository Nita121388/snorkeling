# Agent Catalog 单一事实来源契约

> 适用范围：定时计划（Scheduled Tasks）、`wsh agent list`、以及后续「agent 创建 agent Block」。

## 不变量

1. **「有哪些 agent、每个 agent 能用哪些模型」只在 `pkg/agentcatalog` 定义一次。**
   任何需要 agent profile / 默认模型 / modelflag / 模型列表的代码（前端编辑器、调度执行器、
   CLI、未来的 Block 创建）必须消费该目录，不得再自行读 `agent:profiles` 或硬编码数组。
2. **目录只读配置。** `agentcatalog.List()` / `Resolve()` 合并内置 profile 与 `agent:profiles`，
   不探测外部 CLI、不写用户数据、不做缓存（合并是纯内存操作）。
3. **模型解析优先级固定**（高 → 低）：
   `agent:profiles.<name>.models` → **各 agent 本地配置 discovery** → 已注册 `ModelResolver`（慢速 CLI 探测预留）→ `agent:profiles.<name>.model` 单值 → 空。
   - `models[].default: true`（来自 config）是最高优先的默认标记；
   - 其次是 `profile.model`，再其次是 discovery 的 default 标记，最后取列表第一项；
   - `profile.model` 不在列表中时会被补入（`source=profile-model`），保证默认模型永远可选。
   - **禁止内置静态模型表**：目录里的模型必须来自用户配置或 agent 自己的配置文件，不得凭空写死 ID。

   discovery 只读本地文件、不跑子进程、不写用户数据：

   | agent | 来源 | 默认模型 |
   |---|---|---|
   | `pi` | `$PI_CODING_AGENT_DIR/models.json` | `settings.json` 的 `defaultProvider` + `defaultModel` |
   | `codex` | `$CODEX_HOME/models_cache.json`（`visibility=list`）+ `config.toml` 顶层 `model` | 顶层 `model` |
   | `claude` | `$CLAUDE_CONFIG_DIR/settings.json` 的 `ANTHROPIC_*MODEL` env | `ANTHROPIC_MODEL` |
   | `opencode` | `$OPENCODE_HOME/opencode.json[c]` 的 `provider.*.models` | 顶层 `model` |
   | `gemini` | `$GEMINI_CONFIG_DIR/settings.json` 的 `model` / `selectedModel` | 同左 |

   `pi --list-models`（约 11s）与 `opencode models`（约 6s）不进入同步 RPC 路径，只留作后续 resolver。
4. **目录输出结构是跨端契约**：`ProfileInfo{name,label,cmd,args,modelflag,defaultModel,models[],source}`。
   新增字段只能增量，不能重命名或改变语义。
5. **未知 model 不阻断执行。** 调度器只在日志中告警；UI 用「保留当前值 option」呈现，不能静默丢弃。

## 消费路径

| 消费者 | 入口 | 说明 |
|---|---|---|
| 定时计划编辑器 | `AgentProfileListCommand` → `frontend/app/workspace/agent-catalog.ts` | agent 下拉与模型下拉同源 |
| 调度执行器 | `agentcatalog.Resolve(name)` | 空 model 用 `DefaultModel`，modelflag 来自目录 |
| 任意 agent | `wsh agent list [--json]` | 发现 profile 与模型；与 UI 同源 |
| 未来 Block 创建 | 复用 `agentcatalog.Resolve` | 契约见任务 design.md §8，本期不实现 |

## 配置形状

```jsonc
{
  "agent:profiles": {
    "pi": {
      "label": "Pi",
      "cmd": "pi",
      "modelflag": "--model",
      "model": "deepseek-v4-pro",
      "models": [
        { "id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "provider": "deepseek", "default": true },
        { "id": "gpt-5", "label": "GPT-5", "provider": "openai" }
      ]
    }
  }
}
```

- `models` 缺省时行为等同旧配置（只用 `model` 或内置表）。
- 自定义 profile 只有配置了 `cmd` 才会出现在 `List()` 中（否则不可启动，不对外宣称）。
- 新增 `resolver` 扩展点时不改 RPC 结构：`agentcatalog.RegisterModelResolver`。
