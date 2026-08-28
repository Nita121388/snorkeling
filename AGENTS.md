# Snorkeling Codex Instructions

@.kilocode/rules/rules.md

Read and honor the existing project guidance in `CLAUDE.md` and any referenced skill guides when the task matches them.

## Local toolchain self-check

- Do not conclude Go/Task/npm is unavailable from the raw Codex process PATH alone. Run `npm run setup` to install the pinned toolchain under `.tools/`; Task commands should go through `node scripts/run-task.mjs <task>`.
- Before Go/Task/npm self-tests on Windows, run them in a child PowerShell process that dot-sources the local env, for example:
  `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/remote"`
- Keep this environment scoped to the command process. Do not persistently edit machine/user PATH, Go env, npm config, or device-debugging global variables.
- When assigning temporary env vars inside a nested PowerShell `-Command` string, escape `$env:` as `` `$env:FOO='bar'`` so the outer shell does not expand it before the child process starts.
- Prefer targeted package tests for the touched area first. If the toolchain is still unavailable after `npm run setup` and loading `scripts/use-local-env.ps1`, report those exact checks and blocker.

## Electron UI inspection

- For actual Electron UI layout, style, hover/click, and modal overflow issues, inspect the running app through CDP instead of asking the user to open DevTools and report DOM details.
- Use `node scripts/inspect-electron-ui.mjs ...` from the repo root. The app must be running with a CDP port, usually `--remote-debugging-port=9222`.
- Use `http://127.0.0.1:9222/json/list` to verify targets when the script cannot find the app.
- The right vertical widget strip is called `WidgetsBar`, or the right Widgets bar.
- Do not use `opencli operate state` for this workflow; it controls OpenCLI's own automation browser and may return `about:blank`.

Useful commands:

```powershell
node scripts/inspect-electron-ui.mjs state
node scripts/inspect-electron-ui.mjs elements --limit 40
node scripts/inspect-electron-ui.mjs style "Common Text"
node scripts/inspect-electron-ui.mjs click 1796 296
node scripts/inspect-electron-ui.mjs screenshot
```

For style bugs, gather both visual and layout evidence: `getBoundingClientRect()`, `clientHeight`, `scrollHeight`, computed `display`, `flex`, `minHeight`, `height`, `maxHeight`, `overflow`, `overflowY`, element text, `aria-label`, `title`, classes, and coordinates.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **snorkeling** (23890 symbols, 70960 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/snorkeling/context` | Codebase overview, check index freshness |
| `gitnexus://repo/snorkeling/clusters` | All functional areas |
| `gitnexus://repo/snorkeling/processes` | All execution flows |
| `gitnexus://repo/snorkeling/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
