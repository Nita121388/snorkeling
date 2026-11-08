# 外部 Agent 接入：安装与配置（发布版）

> 面向**发布后的终端用户**。设计背景见 `design/plans/agent-control-surface.md` §10.5。
> 本文只讲「用户拿到 App 之后怎么用上」，不讲实现。

## 0. 前提：你已经有 App

不需要 clone 仓库，也不需要 Node/Go。`wsh` 随 App 一起分发：App 首次运行后会把
`wsh` 释放到数据目录的 `bin/` 下，block 内 `WAVETERM_WSHBINDIR` 指向它：

| 平台 | wsh 位置 |
|---|---|
| Windows | `%LOCALAPPDATA%\<app-data>\bin\wsh.exe` |
| macOS | `~/Library/Application Support/<app-data>/bin/wsh` |
| Linux | `~/.config/<app-data>/bin/wsh` |

想在任何 shell 里用，把它加进 PATH 或建个软链即可。**block 内不需要**：那里已经
配好了。

## 0.5 图形界面路径（不用终端）

**Settings → Agent Access** 一页做完所有事：

| 区块 | 作用 |
|---|---|
| Create a token | 填名字、勾 scope（Observe / Navigate / Data）、选 TTL、填保存路径 → **Create token** |
| Active tokens | 表格显示 name / scopes / 过期 / live·expired·revoked / jti 前缀，逐条 **Revoke**，或 **Revoke all** |
| Give your agent the skill | **Install** → 装进本机已存在的 `~/.claude`、`~/.codex`、`~/.agents` |
| Register the MCP server | 选 host（Claude Code/Cursor 或 Codex）→ **Build** → **Copy config** |

界面里**看不到 token 本身**，只有落盘路径。这是有意的：屏幕上的 token 会进截图、
聊天记录和剪贴板历史；路径不会。

它背后的 RPC 与 CLI 是同一套（`AgentAuthGrant/List/Revoke`、`AgentSkillInstall`、
`AgentMCPConfig`），且**只有应用内可调**——外部 scoped token 不能给别人签发或撤销
凭据，否则就是提权。

## 1. 授权（必须先做，否则外部进程没有任何凭据）

在 **Snorkeling 里任意一个 block** 里执行（block 内自带凭据，App 负责签名）：

```bash
wsh auth grant --name claude-code --scope observe --ttl 30m \
               --out ~/.config/snorkeling/agent-token.json
```

- `--scope`：`observe`（只读，默认）→ `navigate`（开块/建 tab）→ `data`（写会话卡）。
  按最小够用给，不要一次给满。
- `--ttl`：默认 30 分钟，上限 24 小时。**过期就失效**，需要重新 grant。
- 文件权限 `0600`，token 不会打印到终端。

管理：

```bash
wsh auth list            # 看有哪些有效 token（不显示 token 本身）
wsh auth list --all      # 含已过期/已撤销
wsh auth revoke --all    # 立刻全部失效（对下一次调用生效）
wsh auth revoke --name claude-code
```

`wsh auth list/revoke` 也**要在 block 内跑**（它们读本地登记表，但走的是 App 的
凭据链）。撤销后外部 agent 下一次调用会拿到 `E_UNAUTHORIZED`。

## 2. 装 skill（一条命令）

```bash
wsh agent install-skill
```

skill 内容**已编译进 `wsh` 二进制**（`pkg/agentskill` 用 go:embed），所以你不需要
仓库、不需要联网。

默认只装到**已存在的** agent 目录，不会凭空给你创建 `~/.claude`：

```
~/.claude/skills/snorkeling-control     (Claude Code)
~/.codex/skills/snorkeling-control      (Codex)
~/.agents/skills/snorkeling-control     (pi / 通用约定)
```

自定义位置：

```bash
wsh agent install-skill --root ~/my-skills      # 可重复 --root
wsh agent install-skill --dry-run               # 先看会写哪些
wsh agent install-skill --json                  # 给脚本用
```

重装是幂等的（覆盖同名文件），且**只写 `snorkeling-control/` 这一个目录**，不会碰
你其它 skill。

装了什么：

```
snorkeling-control/
  SKILL.md                  何时用 + 5 条红线
  reference/commands.md     完整命令面与 scope
  reference/recipes.md      常见配方 + MCP 注册示例
  scripts/ensure-token.sh   没 token 时打印确切的 auth grant 命令
  README.md                 本目录说明
```

## 3. 注册 MCP（推荐，比 shell 调用更稳）

```bash
wsh agent mcp-config --host claude     # Claude Code / Cursor / pi 通用形状
wsh agent mcp-config --host codex      # Codex 形状
wsh agent mcp-config --host claude --out ~/.claude/mcp.json
```

它会打印（或写入）这样的配置：

```json
{
  "mcpServers": {
    "snorkeling": {
      "command": "<wsh 绝对路径>",
      "args": ["mcp", "serve", "--stdio"],
      "env": { "SNORKELING_AGENT_TOKEN_FILE": "~/.config/snorkeling/agent-token.json" }
    }
  }
}
```

把这段并进你宿主的 MCP 配置即可。**token 放 `env`，不要放 `args`** —— 参数会出现在
宿主的进程列表和配置文件里。

MCP 暴露 12 个工具 + 2 个资源：

| 工具 | scope |
|---|---|
| `snorkeling_ui_active` / `snorkeling_ui_state` | observe |
| `snorkeling_block_read` | observe |
| `snorkeling_session_live` / `_get` / `_list` | observe |
| `snorkeling_tab_list` | observe |
| `snorkeling_agent_card_get` | observe |
| `snorkeling_block_open` | navigate |
| `snorkeling_tab_create` / `snorkeling_tab_activate` | navigate |
| `snorkeling_agent_card_set` | data |

资源：`snorkeling://state`、`snorkeling://sessions/live`。

## 4. 不装 MCP 也能用（纯 shell agent）

```bash
export SNORKELING_AGENT_TOKEN_FILE=~/.config/snorkeling/agent-token.json
wsh ui active --json
wsh session live --json
wsh block read this --tail 40 --json
```

token 来源优先级：`--token-file` > `SNORKELING_AGENT_TOKEN_FILE` >
`SNORKELING_AGENT_TOKEN`（不推荐）> block 内 `WAVETERM_JWT` > 默认路径。

## 4.5 一页式命令指南

```bash
wsh agent guide          # 人类/agent 可读：命令 + scope + 5 条红线 + 错误码
wsh agent guide --json   # 机器可读：command / scope / flags / notes / errors / redlines
```

这份指南与 skill 里的 `reference/commands.md` **由同一张表生成**（`pkg/agentguide`）。
改了命令却只改一边，`pkg/agentskill` 的测试会失败——所以不会出现「skill 让 agent 调
一个已经不存在或改了 flag 的命令」。

## 5. 排障

| 现象 | 原因 / 处理 |
|---|---|
| `no credentials: run inside Snorkeling, or pass --token-file` | 没 token：回 block 里 `wsh auth grant` |
| `E_UNAUTHORIZED: token was revoked` | 被 `auth revoke` 了，重新 grant |
| `E_UNAUTHORIZED` + token 未撤销 | 过期了（默认 30m），重新 grant |
| `E_FORBIDDEN: requires scope navigate` | scope 不够，重新 grant 时加 `--scope navigate` |
| `E_FORBIDDEN: rate limit exceeded` | 60 次/分钟用满：改成用 `ui active`（<2 KB）而不是轮询 `ui state` |
| 装了 skill 但 agent 看不到 | 目录不对：`--root` 指到该宿主真正的 skills 目录，并重启宿主 |

## 6. 安全边界（用户应知道的）

- 外部进程**拿不到** `WAVETERM_AUTH_KEY`（那是整个 App 的凭据）。
- token 短时、可撤销、按 scope 限权、按 `jti` 限流。
- 每次调用写审计：`<data>/agent-data/audit/control-audit.jsonl`
  （`ts / command / agentname / jti 前缀 / ok|denied / 原因`），**不含 token**。
- MCP **只走 stdio**，App 不新开任何监听端口。
