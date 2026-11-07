# Agent Control Surface

## Purpose

Agents (pi, codex, claude-code, opencode) run inside Snorkeling blocks but cannot see
what the app knows about them. The Agent Control Surface is the supported, read-first
way for an agent to answer "what is running right now, whose is it, and what is the
state of its session card" without touching the app databases.

Full design: `design/plans/agent-control-surface.md`.
Task tree: `.trellis/tasks/11-01-agent-control-surface/`.

## Current scope (P0.0, read-only)

`pkg/agentcontrol` merges four sources of truth into one flat record list:

| Source | What it contributes |
|---|---|
| `agentstatus.Get(blockId)` | TUI agent live state: state / phase / tool / message / freshness / seq |
| `chat.Manager` | GUI chat sessions: state, lastUsed, provisional flag |
| `aisessions.Manager` | sessionKey, title, titleSource, note, tags, props, projectPath, hash |
| `wstore` block meta + `blockcontroller` | which blocks exist and whether a controller is running |

Nothing here writes: no DB write, no wps event, no frontend file.

## Commands

```
wsh session live [--include-idle] [--max-rows N] [--json]
wsh session get <sessionKey|sessionId|this> [--block <id>] [--json]
wsh session list [--source ..] [--query ..] [--tag ..] [--project ..] [--marked ..] [--limit N] [--json]
wsh session for-block [<blockid|this>] [--json]
```

`this` resolves through block meta `agent:sessionid`, then `agentstatus.SessionId`.
Outside an agent block it returns `E_NOT_FOUND` with a hint rather than a guess.

## Record shape

See the golden snapshot `pkg/agentcontrol/testdata/session_live.golden.json` — it is
the executable contract for field names, `null`-vs-omitted semantics and redaction.

Key semantics:

- `issue` / `chat` / `card` are always present; a missing source is `null`, never an
  omitted key, so an agent can distinguish "unknown" from "not applicable".
- `issue.freshness` is `stale` once `expiresAt <= now`. Stale rows are surfaced, not
  dropped: an agent needs to know the state *was* working and is now uncertain.
- Default output drops `idle` rows; `--include-idle` keeps everything.
- `card.hash` comes from `agentdata.HashSession`, so it is directly usable as the
  `expectedHash` precondition for a future `agent card set`.
- Degradation is per-row via `warnings`: `orphan-chat` (chat alive, block gone),
  `summary-unavailable`, `remote-summary-unavailable` (remote block: agentstatus
  arrives over wsh but the summary cannot be parsed on the app host).

## Scan budget contract

`pkg/agentcontrol` must not turn a session count into a scan count. The rule
(`.trellis/spec/snorkeling-docs/backend/aisessions-scan-contract.md`) is enforced by
`aisessions.Manager.ResolveSummaries`:

1. live-registry lookup (in-memory, free),
2. one SQLite open, one primary-key `GetSession` per unresolved identifier,
3. bounded-concurrency `Summary` only for what the index genuinely does not know.

Never call `Manager.Summary` in a loop over live sessions — each cache miss runs
`resolveSession` → `refreshAllSummaries` → a budgeted full scan.

## Concurrency limits

- `GetState` (GUI chat): 4 in flight, 1.5s each. Failure drops model/thinking/context
  fields only, never the row.
- Summary batch: 4 in flight, 2s each.

## Adding a surface

1. Add the DTO to `pkg/wshrpc/wshrpctypes.go` next to the existing `Session*` types.
2. Add a thin read-only handler in `pkg/wshrpc/wshserver/session_commands.go`.
3. Walk the CLI in `cmd/wsh/cmd/wshcmd-session.go`.
4. Run `node scripts/run-task.mjs generate` to refresh the wshclient + TS bindings.
5. Advertise the command in `pkg/agentcap` (`GuideText`, `ExternalAgentPrompt`) —
   an undiscoverable capability does not exist.
6. Extend `pkg/agentcontrol/testdata/session_live.golden.json` if the wire shape changed.
