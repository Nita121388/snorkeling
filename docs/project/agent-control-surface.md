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

## Session card (P0.1, read/write)

```
wsh agent card get <sessionKey|sessionId|this> [--block <id>] [--json]
wsh agent card set <...> [--note <s>] [--title <s>] [--tags-set|--tags-add|--tags-remove <s>...]
                         [--prop key=type:value]... [--force]
                         [--dry-run | --yes --expected-hash <hash>]
```

There is no second write path. `agent card set` translates its flags into one
`agentdata.Patch` and calls `agentdata.ApplyPatch`, so it inherits validation,
dry-run, SQLite backup, `patch-audit.jsonl` and `expectedHash` preconditions.
Note+tags share one `session_note.update` operation (they are stored together and
must stay atomic); title and props get their own operations so each keeps its own
force and precondition semantics.

Write safety:

- Dry-run unless `--yes`. A real apply additionally requires `--expected-hash`
  (or `--expected-updated-at`) taken from a fresh `agent card get`; without it the
  call fails with `E_USAGE` before touching anything.
- `titleSource == "user"` is refused with `E_CONFLICT`; `--force` overwrites and
  lands as `titleSource = "ai"` (title contract: `user > ai`).
- A custom property whose `source == "user"` is skipped, reported in `skipped[]`;
  `--force` overwrites.
- Built-in keys (`note`/`tags`/`starred`/`title_source`/`created_at`/`updated_at`)
  are refused outright — they are virtually mapped by the UI, never custom props.
- A stale hash (the user edited the card meanwhile) fails with `E_CONFLICT` and no
  partial write happens.

`persona` is always `null`: avatar/persona live only in frontend localStorage
(design §15 D3), so the backend cannot read or write them.

### Precondition semantics (important)

`ApplyPatch` validates every operation's precondition against the **pre-patch**
state, before applying anything. Per-operation re-validation inside
`applyOperation` would compare the caller's hash against state already mutated by
earlier operations of the same patch, which makes multi-operation patches
impossible to apply. Do not reintroduce it.

## Cross-surface acceptance script

The two P0 surfaces are only useful together: discover a live session, read its
state, then read/write its card — all with `wsh`, from inside a block.

```bash
# 1. discover
wsh session live --json | jq '.records | length'          # matches the UI's running agents
wsh session live --json | jq '.records[] | {provider, state: .issue.state, phase: .issue.phase, title}'

# 2. resolve the session of the block you are standing in
wsh session get this --json
wsh session for-block this --json

# 3. read the card + the hash you need to write it
wsh agent card get this --json                            # -> .hash

# 4. preview, then write
wsh agent card set this --note "整理完成" --tags-add 已整理 --dry-run
wsh agent card set this --note "整理完成" --tags-add 已整理 --yes --expected-hash <hash>

# 5. prove the write is auditable
wsh data backup list --format summary
tail -1 <userdata>/agent-data/audit/patch-audit.jsonl

# 6. prove user content is protected
wsh agent card set this --title "x" --yes --expected-hash <hash>              # user title -> E_CONFLICT
wsh agent card set this --title "x" --force --yes --expected-hash <hash>      # lands as ai
```
