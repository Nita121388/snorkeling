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

Real apply creates SQLite backups before writing. If an operation fails after earlier operations already wrote, Snorkeling attempts a table-level restore from the backups created for that apply and records the result in the operation report and audit log.

## Backups

Patch backups are created with SQLite `VACUUM INTO`. Session backups cover the AI sessions SQLite index. Common Text backups cover the wstore SQLite database.

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
