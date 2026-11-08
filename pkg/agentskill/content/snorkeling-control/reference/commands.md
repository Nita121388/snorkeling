# Command reference

<!-- Generated from pkg/agentguide. Do not edit by hand: run `node scripts/run-task.mjs generate`. -->

All commands accept `--json` and `--timeout <ms>`. Outside the app, add
`--token-file <path>` (or set `SNORKELING_AGENT_TOKEN_FILE`).

## Observe

### `wsh ui active`

Where the calling block is versus where the user is looking.

Flags: `--json`

- Returns two objects: self (you) and active (the user). They usually differ.
- Prefer this over `ui state` for polling: it is a few hundred bytes.

### `wsh ui state`

Backend snapshot of windows, tabs, blocks and their runtime state.

Flags: `--json`

- Large. Do not poll it; use `ui active`.

### `wsh block read`

Bounded content of one block, by view type.

Flags: `<block|this>`, `--tail N`, `--max-bytes N`, `--json`

- A missing source is null, not an absent key.
- Check payload.warning: term-route-unavailable and remote-file-unsupported mean the read degraded.
- truncated: true means you hit --max-bytes.

### `wsh session live`

Every running agent session (TUI and GUI chat).

Flags: `--include-idle`, `--max-rows N`, `--json`

- issue.freshness == "stale" means the state is old, not that it is running now.

### `wsh session get`

One session: live state plus card summary and hash.

Flags: `<key|id|this>`, `--json`

### `wsh session list`

Indexed sessions with filters.

Flags: `--source`, `--query`, `--tag`, `--project`, `--limit`, `--json`

### `wsh session for-block`

Which session a block is bound to.

Flags: `[<blockid|this>]`, `--json`

### `wsh tab list`

Tabs in a workspace, marking the active one.

Flags: `--workspace`, `--json`

### `wsh agent card get`

Title, note, tags and props of a session card, plus its hash.

Flags: `<key|id|this>`, `--json`

- The hash is required to write: pass it back as --expected-hash.


## Navigate

### `wsh block open`

Open a block: file, url, terminal, preview or agent view.

Flags: `--view <term|web|preview|edit|agent>`, `--tab active|new|<id>`, `--split right|down|left|up`, `--replace <blockid>`, `--dedupe`, `--magnified`, `--no-focus`, `--wait`, `--file`, `--url`, `--cwd`, `--conn`, `--meta k=v`, `--json`

- --split and --replace are mutually exclusive.
- syncState: db-only = written; layout-queued = written but NOT drawn yet; layout-applied = on screen.
- Never report a block as open on layout-queued.

### `wsh tab create`

Create a tab (optionally activate it).

Flags: `--name`, `--activate`, `--wait`, `--json`

### `wsh tab activate`

Switch to a tab and confirm the backend agrees.

Flags: `<tabid>`, `--wait`, `--json`


## Data

### `wsh agent card set`

Update a session card: title, note, tags, props.

Flags: `--note`, `--title`, `--tags-add`, `--tags-set`, `--tags-remove`, `--prop k=type:v`, `--force`, `--dry-run`, `--yes`, `--expected-hash <h>`

- Dry-run unless --yes, and a real write needs --expected-hash from a fresh get.
- E_CONFLICT means someone else edited: re-read, do not pass --force.
- titleSource=user is refused without --force.


## Inside the app only

### `wsh auth grant`

Mint a short-lived scoped token for a process outside the app.

Flags: `--name`, `--scope observe,navigate,data`, `--ttl 30m`, `--out <file>`

- Run inside a Snorkeling block: the app embeds your socket, so the token can only point back here.
- The file is written 0600 and the token is never printed.
- Default TTL 30m, maximum 24h. destructive is never granted.

### `wsh auth list`

List granted tokens (never the token itself).

Flags: `--all`, `--json`

### `wsh auth revoke`

Revoke by name, jti prefix, or everything.

Flags: `--name`, `--jti`, `--all`

- Takes effect on the token's next call.

### `wsh mcp serve`

Serve the surface as MCP tools over stdio.

Flags: `--stdio`, `--token-file <file>`

- stdio only: no listener is opened.

### `wsh agent install-skill`

Install the bundled skill into local agent directories.

Flags: `--root <dir>`, `--dry-run`, `--json`

### `wsh agent mcp-config`

Print the MCP server entry for a host.

Flags: `--host claude|cursor|codex`, `--out <file>`

- The token goes in env, never in args.

## Errors

Stable codes; branch on them.

| Code | Meaning |
|---|---|
| `E_CONFLICT` | someone else changed it; re-read |
| `E_FORBIDDEN` | scope too low, or rate limited (60/min per token) |
| `E_INTERNAL` | bug; report it |
| `E_NOT_FOUND` | no such block / session / token |
| `E_NO_ROUTE` | no backend route; usually not inside the app |
| `E_TIMEOUT` | the app did not answer in time |
| `E_UNAUTHORIZED` | token revoked or expired; ask for a new one |
| `E_UNSUPPORTED` | this view cannot do that |
| `E_USAGE` | bad arguments |
