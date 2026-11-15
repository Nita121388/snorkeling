# VCS History Swim-Lane Graph Contract

> Established 2026-11-15 (task `11-15-vcs-history-graph`).
> Prototype of record: `design/prototypes/vcs/vcs-history-graph/`.

## Data contract (Go → frontend)

`wshrpc.VcsCommitInfo` carries optional `parents` (`%P`), `refs` (`%D` raw token
list, e.g. `HEAD -> main`, `tag: v2.4`, `origin/main`) and `authoremail`
(`%ae`). The git-log pretty format **appends** new fields after the four
legacy ones (`%H %an %ad %s | %ae %P %D`) so old/new callers interoperate:
`parseGitCommits` keeps working with 4-field records. **Never reorder the
legacy fields.**

`parseGitRefs` lives on the frontend (`vcs-commit-meta.ts`), not in Go: `%D`
tokens are presentation concerns (head/branch/tag/remote typing).

`VcsCommitFileInfo.Added/Deleted` come from a **second** `git show --numstat`
call — `--numstat` and `--name-status` are mutually exclusive diff output
formats (passing both yields only name-status). Rename lines (`{a => b}`,
`old => new`) are deliberately **not** matched: exact-path-only merge, missing
stats are fine, wrong stats are not.

## Layout invariants (`graph-layout.ts`)

The swim-lane algorithm is a pure function; its invariants are pinned by
`graph-layout.test.ts`:

1. every commit gets exactly one row
2. a row's bottom lanes never wait for the same hash twice
3. the last row has no dangling lanes
4. every parent edge has a drawable parent lane (parents outside the current
   page/filtered slice are unknown and simply draw nothing — documented
   trade-off, not a bug)
5. when a parent is already awaited by another lane, the **node lane takes
   over** (this is what keeps the main line colour stable through merges)
6. lane colours come from branch identity (`colorForCommitRefs`), never from
   allocation order — pages and filtered views stay colour-stable

When changing the algorithm, update the prototype's `graph.test.cjs`
expectations in the same change or state why the prototype diverged.

## Rendering conventions

- The graph cell is inline SVG built from `rowShapes()` geometry; row height is
  `GRAPH_GEO.rowHeight` (46px) and **must** stay in sync with the row CSS.
- Ref badge colour, HEAD ring colour and lane colour all come from the same
  branch→colour mapping (`colorByBranch` built from the rendered layout), so a
  badge and its lane can never disagree.
- Expanded file panels draw `CommitGraphGutter` lane continuations in the left
  gutter so lines do not visually break.
- The commit list is a container query (`@container`): hash chip appears at
  ≥420px, hover actions at ≥440px, author name at ≥520px. Subject keeps
  `flex-1 min-w-0` priority; ref badges cap at `max-w-[45%] overflow-hidden`.

## Verification

Real-machine gate: `node scripts/verify/vcs-history-graph/verify.mjs`
(17 assertions; fixture: two-lane git repo built under `tmp/`). Go side:
`go test ./pkg/wshrpc/wshremote` covers the extended parse and numstat merge.
