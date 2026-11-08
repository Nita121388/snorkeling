# skills/snorkeling-control

External-agent skill for the Snorkeling control surface (design
`design/plans/agent-control-surface.md` §10.5.6 = L3).

| File | Purpose |
|---|---|
| `SKILL.md` | When to use it, which transport, and the five red lines |
| `reference/commands.md` | The full command surface (scopes, flags) |
| `reference/recipes.md` | Multi-step jobs: running sessions, "where is the user", opening files, card tidy-up, MCP registration |
| `scripts/ensure-token.sh` | Fails loudly with the exact `wsh auth grant` command when no token exists |

## Install

Copy or symlink the directory into your agent's skills location:

```bash
# Claude Code
ln -s "$PWD/skills/snorkeling-control" ~/.claude/skills/snorkeling-control
# Codex / pi (whatever your skills dir is)
ln -s "$PWD/skills/snorkeling-control" ~/.agents/skills/snorkeling-control
```

The skill assumes `wsh` is on `PATH` (it ships with the app; inside a block
`WAVETERM_WSHBINDIR` points at it).

## Getting a token

Run **inside a Snorkeling block**:

```bash
wsh auth grant --name claude-code --scope observe --ttl 30m \
               --out ~/.config/snorkeling/agent-token.json
```

`wsh auth list` shows what is live; `wsh auth revoke --all` kills everything
immediately. The token file is created `0600` and the token is never printed.
