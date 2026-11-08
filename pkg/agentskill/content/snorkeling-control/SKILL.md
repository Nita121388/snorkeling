---
name: snorkeling-control
description: Drive a running Snorkeling app from outside it — read what is on screen, inspect live agent sessions, open blocks/tabs, and edit a session card. Use when the user asks about "what is running in Snorkeling", "which sessions are live", "open this file in Snorkeling", or wants the agent to read/navigate their terminal app.
---

# Snorkeling Control

Snorkeling exposes a control surface through `wsh`. You use it to answer "what is
the user looking at", "what agents are running", and to open or navigate blocks.

**Two transports, one behaviour:** the `wsh` CLI (any shell) and `wsh mcp serve
--stdio` (MCP hosts). Both are thin facades over the same RPCs, so anything you
learn in one applies to the other.

## Prerequisites: you need a token

Outside the app there is no `WAVETERM_JWT`, so you need a scoped token. Ask the
user to run, **inside a Snorkeling block**:

```bash
wsh auth grant --name <your-agent-name> --scope observe --ttl 30m \
               --out ~/.config/snorkeling/agent-token.json
```

Then use it:

```bash
wsh --token-file ~/.config/snorkeling/agent-token.json ui active --json
# or let the default path be found automatically:
export SNORKELING_AGENT_TOKEN_FILE=~/.config/snorkeling/agent-token.json
```

Scopes are cumulative: `observe` < `navigate` < `data`. Ask for the smallest one
that does the job. Anything you attempt without the scope fails with
`E_FORBIDDEN` — do not retry with a different flag, ask for the scope.

## Red lines (do not violate)

1. **Never write a token into a skill file, script, repo, or commit.** Tokens are
   short-lived and personal; they belong in the file the user created.
2. **Dangerous operations go dry-run → ask → apply.** `block open --replace`,
   any delete, and `agent card set` must be previewed (and for card writes,
   `--dry-run` + `--expected-hash`) before a real write. Confirm with the user
   between preview and apply.
3. **Do not poll.** Prefer `wsh ui active --json` (< 2 KB). Never loop on
   `ui state` / `session live`; if you need change notifications, say so instead
   of spinning. The token is rate limited to 60 calls/minute and polling will hit
   it.
4. **If the token is missing, stop and ask.** Never look for `WAVETERM_AUTH_KEY`,
   swap tokens, or another way around the grant. That key is the whole app's
   credential.
5. **Assume the UI moved.** Read `ui active` before acting on "the current
   block", and use `--expected-hash` when writing so a concurrent edit becomes
   `E_CONFLICT` instead of data loss.

## The 30-second orientation

```bash
wsh --token-file <f> ui active --json        # where am I vs where is the user
wsh --token-file <f> session live --json     # what agents are running
wsh --token-file <f> block read this --tail 40 --json
```

Read `reference/commands.md` for the full surface and `reference/recipes.md` for
the common multi-step jobs.

## Interpreting results honestly

- `ui active` returns **two** objects: `self` (where you are) and `active` (where
  the user is). They usually differ. Say which one you used.
- `block open` returns `syncState`: `db-only` = written, nothing claimed;
  `layout-queued` = written but **not on screen yet**; `layout-applied` = the
  frontend applied it. Never report a block as "open" on `layout-queued`.
- A missing source is `null`, not an absent key. `warnings` explain degraded
  rows (`orphan-chat`, `term-route-unavailable`, `remote-file-unsupported`).
  "Could not read" is not "there is nothing there".

## Errors

Stable codes, branch on them: `E_USAGE`, `E_NOT_FOUND`, `E_CONFLICT`,
`E_FORBIDDEN` (scope/rate limit), `E_UNSUPPORTED`, `E_NO_ROUTE`, `E_TIMEOUT`,
`E_INTERNAL`, `E_UNAUTHORIZED` (revoked/expired token).

`E_UNAUTHORIZED` means the token is dead: ask the user to grant a new one. Do not
debug it by trying more calls.
