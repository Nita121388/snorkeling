# Agent 配置机制（OpenCove 风格）

更新时间：2026-04-17

## 设计目标

- 通过“profile 映射”管理 Agent 启动配置，而不是把命令硬编码在 UI 层
- 保持默认可用（`codex`），并允许按 profile 切换到其他 Agent CLI
- 配置项可进入 `settings.json`，便于版本化和迁移

## 配置键

在 `settings.json` 中可使用以下键：

- `agent:defaultprofile`：默认 profile 名称
- `agent:profiles`：profile 映射表
  - `cmd`：执行命令（例如 `codex` / `claude` / `gemini` / `opencode`）
  - `args`：固定参数数组
  - `model`：模型名
  - `modelflag`：模型参数标记，默认 `--model`
  - `env`：环境变量映射（写入 `cmd:env`）

## 示例

```json
{
  "agent:defaultprofile": "claude",
  "agent:profiles": {
    "codex": {
      "cmd": "codex",
      "modelflag": "--model",
      "model": "gpt-5-codex"
    },
    "claude": {
      "cmd": "claude",
      "modelflag": "--model",
      "model": "sonnet-4",
      "args": ["--dangerously-skip-permissions"],
      "env": {
        "ANTHROPIC_API_KEY": "$ENV:ANTHROPIC_API_KEY"
      }
    }
  }
}
```

## 运行时行为

- 当 profile 存在时，Agent 启动命令按 profile 组装：
  - `cmd`
  - `args`
  - `modelflag + model`（若配置了 model）
  - `env` -> `cmd:env`
- 当 profile 不存在或配置缺失时，会回退到内置默认 profile（`codex`）

## 与智能打开结合

- 单终端场景：直接使用当前终端上下文启动
- 多终端场景：先选目标终端，再按 profile 配置启动
