# Agent Data Patch

## Purpose

Agent Data Patch is the supported write path for local agents that need to edit Snorkeling user data. Agents should export current data, generate a constrained JSON patch, run a dry-run, then apply with explicit confirmation.

Agents must not write directly to the SQLite databases.

## On-Demand Agent Context

Snorkeling data guidance is intentionally loaded on demand. It is not injected into every Wave AI chat or every terminal agent session by default.

Use these built-in commands when an agent needs this capability:

```bash
wsh data guide
wsh data schema
wsh data examples
wsh data prompt
```

To append the compact guidance to the current Wave AI prompt explicitly:

```bash
wsh data import-ai
wsh data import-ai --new
wsh data import-ai --submit
```

## Export

```bash
wsh data export --domain sessions --out sessions.json
wsh data export --domain commontext --out commontext.json
wsh data export --domain all --out snorkeling-data.json
```

Each exported record includes a `hash`; records also include `updatedAt` when available. Use one of these values as a precondition in later update operations.

## Patch Format

Patch version 1 supports:

- `session_note.update`
- `common_text.update`
- `tag.rename`

```json
{
  "version": 1,
  "source": "codex",
  "operations": [
    {
      "type": "session_note.update",
      "sessionKey": "codex:abc:/path/session.jsonl",
      "note": "整理完成",
      "tags": { "add": ["已整理"], "remove": ["待整理"] },
      "expectedHash": "hash-from-export"
    },
    {
      "type": "common_text.update",
      "id": "88888888-8888-8888-8888-888888888888",
      "title": "新的标题",
      "content": "新的内容",
      "tags": { "set": ["prompt", "常用"] },
      "expectedUpdatedAt": 1700000000000
    },
    {
      "type": "tag.rename",
      "domain": "all",
      "from": "todo",
      "to": "待处理"
    }
  ]
}
```

For real apply, `session_note.update` and `common_text.update` require `expectedHash` or `expectedUpdatedAt`. This prevents silent overwrites after concurrent user edits. `tag.rename` does not require per-record preconditions.

`session_prop.update` props entries accept an optional `scope`: `"session"` (default,
empty behaves the same — the value is written per-session only, legacy behaviour),
`"agent"` (the definition is additionally upserted into the `agent:propertyschema`
config as `scope="agent:<provider>"`, all sessions of that agent see it) or
`"all"` (global template definition). The schema upsert itself happens in the
command layer (`agent card set`) after a successful apply, not in the data patch;
unknown scope values are rejected. Values always stay per-session.

`tags.set: []` is an explicit request to clear tags. `tags.add` and `tags.remove` can be used for incremental changes.

Unknown operation fields and unknown `tags` fields are rejected.

## Preview And Apply

Always dry-run first:

```bash
wsh data apply --dry-run patch.json
wsh data apply --dry-run patch.json --format summary
```

Dry-run does not write data. The report includes per-operation status, affected counts, field-level `before`/`after` changes, and warnings for updates that need apply preconditions.

Apply requires explicit confirmation:

```bash
wsh data apply patch.json --yes
wsh data apply patch.json --yes --format summary
```

Real apply snapshots before writing. If an operation fails after earlier operations already wrote, Snorkeling restores from that snapshot and records the result in the operation report and audit log.

## Backups

Two snapshot shapes exist. The shape is recorded as `kind` in the backup manifest.

| `kind` | File | Contains | Restore |
|---|---|---|---|
| `rows` (default) | `<type>-<ts>-<hash>.rows.sqlite` | only the rows the patch can write | only those rows are deleted and re-inserted |
| *(empty)* | `<type>-<ts>-<hash>.sqlite` | the whole database (`VACUUM INTO`) | whole-table restore (pre-125 behaviour) |

Row-scoped snapshots are the default because a whole-database copy made every note/tag write cost
O(database size): on an index with ~1M messages (2.8 GB) a single tag edit had to copy 2.8 GB, which
exceeded the 15 s RPC timeout and required disk space equal to the whole index.

What a row-scoped snapshot covers:

| Operation | Captured rows |
|---|---|
| `session_note.update` / `session_title.update` / `session_prop.update` | that session in `ai_session_meta`, `ai_session_tags`, **and `ai_session_props`** |
| `common_text.update` | that entry in `db_common_text` |
| `tag.rename` | every session / entry currently carrying the old tag |

Because the snapshot is keyed, a rollback only writes the rows the patch touched. Edits other
writers made to other sessions while the patch was running survive the rollback; a whole-table
restore would have erased them.

The whole-database path is still used when:

- the affected row set exceeds `scopedBackupRowLimit` (5000) — a tag rename can hit every session, and an unbounded `IN (...)` list is not worth building;
- `SNORKELING_AGENTDATA_BACKUP_MODE=full` is set. This is the one-line escape hatch for an incident: it restores the previous behaviour without touching code.

Backups written by older versions have no `kind` field and keep using the whole-table restore path.

```bash
wsh data backup list
wsh data backup list --format summary
wsh data backup prune --dry-run
wsh data backup prune --dry-run --format summary
wsh data backup prune --keep 10 --days 30 --yes
```

Prune defaults to dry-run unless `--yes` is passed. The default policy keeps at least 10 backups per type and backups newer than 30 days. Non-permanent prune moves backups to macOS Trash. Permanent deletion requires `--permanent --yes`.

Meta.json migration backups are separate and should be treated as long-lived migration safety backups.

## Audit Log

Real patch apply writes audit entries under the agent data directory:

```text
agent-data/audit/patch-audit.jsonl
```

Audit entries include time, source, success/error, operation reports, and backup paths.
