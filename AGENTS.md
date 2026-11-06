# Snorkeling Codex Instructions

## 👉 接手先读 `HANDOFF.md`

仓库根目录的 **`HANDOFF.md`** 是当前状态页（哪批功能到哪了、下一步做什么）。开工前先读它。

## 🔁 开发流程 = `loop/` 门链，不是"直接改代码"

**动手之前先确认自己在队列里是哪一包。** 没有工作项就先建，不为"顺手"开工。

```bash
node loop/queue.mjs list            # 全景：谁在哪个门、今晚队列有哪些
node loop/queue.mjs pending         # 值班第一步：人写了批注还没人回的（必须逐条三选一）
node loop/queue.mjs run --id X --dry-run   # 取件前的准入校验；门不清会被直接拒
node loop/queue.mjs prove --id X    # 跑判据采数字（不接受"我看了一下没问题"）
```

四条硬规则（违反即停，不要自己找理由绕过）：

1. **门不清不许取件** —— `bug/fix-small` 只要 G2 器具 + G7 人验收；`feature/redesign/new-surface` 还有 H 门等白天签。
2. **判据必须有数字** —— 新增/修改行为前先写得出「命令 → 期望输出」。写不出 = 该包永远进不了队列。
3. **白名单外不写** —— 每包有 `touch` 路径白名单，写出界即 `out-of-scope` park。
4. **子 agent 不记台账、不提交、不动看板** —— 只有主 agent 写。

- 规则全文：`loop/RUNBOOK.md`（3 分钟读完）
- 契约（改 `loop/**` 前必读）：`.trellis/spec/guides/day-night-loop-contract.md`
- 看板：`node E:/primary/projects/loop-board/scripts/start.mjs` → `http://127.0.0.1:7799`

@.kilocode/rules/rules.md

Read and honor the existing project guidance in `CLAUDE.md` and any referenced skill guides when the task matches them.

## Design Asset Routing

When generating or editing design-related files (designs, prototypes, research docs), follow the routing rules in `design/DESIGN-GOVERNANCE.md`. Quick reference:

- **Brainstorm/research/plan** → Obsidian `My Projects/Snorkling/`
- **Mature design doc** → `design/plans/`
- **Interactive prototype (HTML/CSS/JS)** → `design/prototypes/`
- **Implementation facts** → `docs/project/`

## Local toolchain self-check

- Do not conclude Go/Task/npm is unavailable from the raw Codex process PATH alone. Run `npm run setup` to install the pinned toolchain under `.tools/`; Task commands should go through `node scripts/run-task.mjs <task>`.
- Before Go/Task/npm self-tests on Windows, run them in a child PowerShell process that dot-sources the local env, for example:
  `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/remote"`
- Keep this environment scoped to the command process. Do not persistently edit machine/user PATH, Go env, npm config, or device-debugging global variables.
- When assigning temporary env vars inside a nested PowerShell `-Command` string, escape `$env:` as `` `$env:FOO='bar'`` so the outer shell does not expand it before the child process starts.
- Prefer targeted package tests for the touched area first. If the toolchain is still unavailable after `npm run setup` and loading `scripts/use-local-env.ps1`, report those exact checks and blocker.

## 真机验证（自验证，收尾必做）

验证结论必须**可机器判定 + 有证据**，不允许"我看了一下没问题"。

- 改 UI / 交互 / 跨面一致性 → 收尾跑对应验证台；先 `node scripts/verify/index.mjs` 看有哪些 area 和最近结论。
- 台账 `docs/project/verify-ledger.md` **入库**（一行结论）；明细与截图在 `verify-runs/`（gitignore）。
- 新 area：复制 `scripts/verify/_template/verify.mjs`，能力只从 `scripts/verify/lib/` 拿
  （`cdp` / `launch` / `probes` / `report` / `pixel`），别写第二份 CDP client 或 report 逻辑；
  登记到 `scripts/verify/README.md` 的 area 表。
- 出口统一：`0` 全绿 / `1` 断言失败 / `2` 环境错误；有意没覆盖的面写进 `skipped`，不要静默省略。
- 验证实例是**真的 Electron 窗口**：默认跑完自动关（端口→PID），只有 `--keep-open` 才留；
  不打招呼不要批量起实例。
- 经验沉淀位置：硬约束进 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`，
  方法论进 `docs/project/ui-verify-playbook.md`；**每次验证踩到新坑都要回写其中一处**。

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

This project is indexed by GitNexus as **snorkeling** (25382 symbols, 72316 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
