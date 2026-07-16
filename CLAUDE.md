@.kilocode/rules/rules.md

---

## Electron UI inspection

For actual Electron UI layout, style, hover/click, and modal overflow issues, inspect the running app through CDP instead of asking the user to open DevTools and report DOM details.

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

### Launching `task dev` with a CDP port

`task dev` (= `electron-vite dev`) does **not** read `ELECTRON_EXTRA_LAUNCH_ARGS`, so setting that env var alone won't open `--remote-debugging-port=9222` on the launched Electron — the main process command line stays `electron.exe .` with no CDP switch. Two reliable ways to get CDP in dev:

1. **One-shot env override (preferred, no code change):** set `SNORKELING_CDP_PORT=9222` *before* launching `task dev`, and ensure the main process reads it. As of this writing there is no built-in hook for that env var; option 2 is the documented path.
2. **Temporary main-process switch:** add, in `emain/emain.ts` right after `const electronApp = electron.app;`:
   ```ts
   if (isDev && process.env.SNORKELING_CDP_PORT) {
       electronApp.commandLine.appendSwitch("remote-debugging-port", process.env.SNORKELING_CDP_PORT);
   }
   ```
   `isDev` (from `emain/emain-platform.ts`) is a **boolean const** (`!app.isPackaged`), not a function — don't call it. Remove this snippet before committing.

To run dev detached from a background shell (so the Bash `&` exit doesn't kill the dev process tree), launch via `Start-Process` in a PowerShell script — `Start-Process powershell -ArgumentList ...local-task.ps1,dev -WindowStyle Minimized`. Killing prior dev instances safely: filter `Get-CimInstance Win32_Process` by `CommandLine -like '*Snorkeling (Dev)*'` (matches the dev user-data-dir) before `Stop-Process`.

After main rebuild, verify with `curl -s http://127.0.0.1:9222/json/version`. Two page targets are normal — pick the one titled `Wave Terminal - T<id>` (the real UI; the bare `Wave` target is a spare/empty window).

## `session.note` semantics — tags live *inside* the note string

In `frontend/app/view/aisessions/`, `session.note` is a **single freeform string that may contain `#tag` tokens inline** (e.g. `"#fix #snorkeling\nnext: hook"` or just `"#减熵"`). It is *not* a structured `{ body, tags }` object, and pure-tags notes are stored as the literal `"#tag1 #tag2"` string — non-empty even though there's no prose.

This means **`Boolean(session.note)` is not "has note content"**. To check whether a note has real prose (text beyond tags), use `stripSessionTagHashes(session.note).trim().length > 0` (helper in `session-tags.ts`). Tag extraction is `extractSessionTagsFromNote`, hash-stripping for display is `stripSessionTagHashes`. Treat any visual decoration that should mean "this session has a note" (e.g. the accent stripe on the row) as a *prose* check, not a *note field present* check — pure-tag notes will otherwise wrongly light up the decoration.

## Sinking implementation details (user-triggered)

When the user says something like *"记一笔" / "把这次细节沉淀一下" / "落到开发细节"* after a code change, sink a `devdoc` note into the Obsidian vault at `E:\File\NitaFile\Obsidians\Obsidian\My Projects\Snorkling\开发细节\<业务模块>\` — **do not ask for confirmation; just write it**. The full rule set (when to sink, business module list, frontmatter, six-section body, file naming, README indexing) lives in `开发细节/README.md` in that vault; read it before the first sink. Subdirectory names mirror the `方案/` subdirs (`UI布局与Block`, `Sessions与列表`, `Common Text`, `Agent状态与识别`, `Agent数据与标签`, `wsh安装与上传`, `架构与文档`, `竞品与生态调研`). Do **not** sink unless asked — this is user-triggered, not hook-driven.

## Skill Guides

This project uses a set of "skill" guides — focused how-to documents for common implementation tasks. When your task matches one of the descriptions below, **read the linked SKILL.md file before proceeding** and follow its instructions precisely.

| Skill        | File                                     | Description                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add-config   | `.kilocode/skills/add-config/SKILL.md`   | Guide for adding new configuration settings to Wave Terminal. Use when adding a new setting to the configuration system, implementing a new config key, or adding user-customizable settings.                                               |
| add-rpc      | `.kilocode/skills/add-rpc/SKILL.md`      | Guide for adding new RPC calls to Wave Terminal. Use when implementing new RPC commands, adding server-client communication methods, or extending the RPC interface with new functionality.                                                 |
| add-wshcmd   | `.kilocode/skills/add-wshcmd/SKILL.md`   | Guide for adding new wsh commands to Wave Terminal. Use when implementing new CLI commands, adding command-line functionality, or extending the wsh command interface.                                                                      |
| context-menu | `.kilocode/skills/context-menu/SKILL.md` | Guide for creating and displaying context menus in Wave Terminal. Use when implementing right-click menus, adding context menu items, creating submenus, or handling menu interactions with checkboxes and separators.                      |
| create-view  | `.kilocode/skills/create-view/SKILL.md`  | Guide for implementing a new view type in Wave Terminal. Use when creating a new view component, implementing the ViewModel interface, registering a new view type in BlockRegistry, or adding a new content type to display within blocks. |
| electron-api | `.kilocode/skills/electron-api/SKILL.md` | Guide for adding new Electron APIs to Wave Terminal. Use when implementing new frontend-to-electron communications via preload/IPC.                                                                                                         |
| waveenv      | `.kilocode/skills/waveenv/SKILL.md`      | Guide for creating WaveEnv narrowings in Wave Terminal. Use when writing a named subset type of WaveEnv for a component tree, documenting environmental dependencies, or enabling mock environments for preview/test server usage.          |
| wps-events   | `.kilocode/skills/wps-events/SKILL.md`   | Guide for working with Wave Terminal's WPS (Wave PubSub) event system. Use when implementing new event types, publishing events, subscribing to events, or adding asynchronous communication between components.                            |

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **snorkeling** (26154 symbols, 70972 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "refactor/snorkeling"})`.
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
