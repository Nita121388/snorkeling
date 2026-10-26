# 各 agent 的模型来源实测（Windows 本机 + 上游文档）

目标：目录不能再靠「内置静态表」编造模型。每个 agent 都有自己的配置来源。

## pi

- 全局目录：`$PI_CODING_AGENT_DIR`，默认 `~/.pi/agent`。
- **已配置模型**：`models.json`
  ```jsonc
  { "providers": { "<provider>": { "name": "...", "models": [ { "id": "deepseek-v4-pro", "name": "..." } ] } } }
  ```
  这就是用户实际配置的 provider/model 清单（本机 4 个 provider）。
- **默认模型**：`settings.json` 的 `defaultProvider` + `defaultModel`（本机 `deepseek` / `deepseek-v4.1-flash`）。
- 可选动态来源：`pi --list-models`（含内置 provider 目录 + cc-switch provider），本机 **约 11.6s**，不适合放在 RPC 热路径。
- `models-store.json` 是内置 provider 的目录缓存（106KB），不是用户配置。

## codex

- 全局目录：`$CODEX_HOME`，默认 `~/.codex`。
- **可用模型目录**：`models_cache.json` → `models[]`，字段 `slug` / `display_name` / `visibility`。
  过滤 `visibility == "list"`（本机 5 个可见：gpt-5.5 / gpt-5.4 / gpt-5.4-mini / gpt-5.3-codex / gpt-5.2）。
- **默认模型**：`config.toml` 顶层 `model = "..."`（本机 `gpt-5.6-sol`，自定义 provider）。
- cc-switch 的 codex vendor 会带 `cc-switch-model-catalog.json`，同样可解析 `models[].slug`。
- `codex --help` 没有 list-models 子命令。

## claude

- 全局目录：`$CLAUDE_CONFIG_DIR`，默认 `~/.claude`。
- **已配置模型**：`settings.json` 的 `env`：
  - `ANTHROPIC_MODEL` = 默认模型
  - `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` = 各档位模型
  - `..._MODEL_NAME` 是显示名
- 本机全部指向 `glm-5.3`（cc-switch 的供应商）。
- 没有本地 list-models 命令；cc-switch vendor 的 env 也是同一来源。
- 无配置时不能凭空猜 `sonnet/opus/haiku`，退回自由输入。

## opencode

- 配置：`$OPENCODE_HOME` / `XDG_CONFIG_HOME/opencode` / `~/.config/opencode/opencode.json[c]`。
- **已配置模型**：`provider.<id>.models.<model-id>`，以及顶层 `model: "provider/model"`。
- 本机 `opencode.jsonc` 为空 → 目录无模型，只能自由输入。
- 动态来源：`opencode models`（本机 38 个，**约 6s**），同样不适合 RPC 热路径。

## gemini

- 配置：`~/.gemini/settings.json`（本机未安装、无目录）。
- 约定字段：`model`（字符串或 `{ name }`），`selectedModel` 兼容读取。
- 无配置 → 空列表。

## 结论

- 目录解析改为：`agent:profiles.<name>.models`（最高）→ **各 agent 本地配置 discovery** → 空。
- 删除 `builtinModelCatalogs` 静态表（就是用户看到的「写死」）。
- discovery 只读文件、不跑 CLI、不写用户数据；CLI 探测（`pi --list-models` / `opencode models`）留作后续异步 resolver，不进 RPC 同步路径。
