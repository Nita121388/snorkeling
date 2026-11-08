# Recipes

## "What is running right now?"

```bash
wsh --token-file <f> session live --json \
  | jq '.records[] | {provider, state: .issue.state, phase: .issue.phase, title}'
```

`issue.freshness == "stale"` means the state *was* working and the hook stopped
reporting — say "stale", not "running".

## "Where is the user looking?"

```bash
wsh --token-file <f> ui active --json | jq '{self, active}'
```

If `self.tabid != active.tabid`, the user is elsewhere. Do not assume "the
current block" means what they see.

## "Read what is in that block"

```bash
wsh --token-file <f> block read <blockid> --tail 40 --json
```

`payload.lines` for terminals, `payload.content` for files,
`payload.warning` when it degraded (`term-route-unavailable`,
`remote-file-unsupported`). `truncated: true` means you hit `--max-bytes`.

## "Open this file for me"

```bash
# preview first
wsh --token-file <f> block open --view preview --file /repo/README.md \
    --split right --dedupe --wait --j
