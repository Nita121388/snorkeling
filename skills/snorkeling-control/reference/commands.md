# Command reference

All commands accept `--json` and `--timeout <ms>`. Outside the app, add
`--token-file <path>` (or set `SNORKELING_AGENT_TOKEN_FILE`).

## Observe (scope `observe`)

| Command | What it answers |
|---|---|
| `wsh ui active` | `self` (calling block) vs `active` (window/workspace/tab/block the user sees) |
| `wsh ui state` | backend snapshot: windows/tabs/blocks + per-block runtime and agent state |
| `wsh block read <block\|this> [--tail N] [--max-bytes N]` | bounded content by view: term lines, file content, url, agent session |
| `wsh session live [--include-idle] [--max-rows N]` | every running agent session (TUI + GUI chat) |
| `wsh session get <key\|id\|this>` | one session: live state + card summary + hash |
| `wsh session list [--source] [--query] [--tag] [--project] [--limit]` | indexed sessions |
| `wsh session for-block [<blockid\|this>]` | which session a block is bound to |
| `wsh tab list [--workspace]` | tabs, marking the active one |
| `wsh agent card get <key\|id\|this>` | title/note/tags/props + hash (the hash is required to write) |

## Navigate (scope `navigate`)

| Command | Notes |
|---|---|
| `wsh block open --view <term\|web\|preview\|edit\|agent>` | `--tab active\|new\|<id>`, `--split right\|down\|left\|up` (mutually exclusive with `--replace <blockid>`), `--magnified`, `--no-focus`, `--wait`, `--dedupe`, `--file`, `--url`, `--cwd`, `--conn`, `--meta k=v` |
| `wsh tab create [--name] [--activate] [--wait]` | `--wait` polls backend `Workspace.ActiveTabId` |
| `wsh tab activate <tabid> [--wait]` | same backend-truth polling |

`block open` always goes through the same path as the UI, so the frontend sees
identical events. Check `syncState` (see SKILL.md).

## Data (scope `data`)

| Command | Notes |
|---|---|
| `wsh agent card set <key\|id\|this> [--note] [--title] [--tags-add\|--tags-set\|--tags-remove] [--prop k=type:v] [--force] [--dry-run \| --yes --expected-hash <h>]` | dry-run unless `--yes`; a real write needs `--expected-hash` from a fresh `card get`; `titleSource=user` is refused without `--force` |

## Token administration (inside the app only)

| Command | Notes |
|---|---|
| `wsh auth grant --name <n> --scope observe[,navigate,data] --ttl 30m --out <file>` | default TTL 30m, max 24h, file 0600, token never printed |
| `wsh auth list [--all]` | live tokens; `--all` includes expired/revoked |
| `wsh auth revoke --name <n> \| --jti <id> \| --all` | takes effect on the token's next call |

## MCP

```bash
wsh mcp serve --stdio --token-file <path>
```

Tools: `snorkeling_ui_active`, `snorkeling_ui_state`, `snorkeling_block_read`,
`snorkeling_block_open`, `snorkeling_tab_list`, `snorkeling_tab_create`,
`snorkeling_tab_activate`, `snorkeling_session_live`, `snorkeling_session_get`,
`snorkeling_session_list`, `snorkeling_agent_card_get`, `snorkeling_agent_card_set`.
Resources: `snorkeling://state`, `snorkeling://sessions/live`.
