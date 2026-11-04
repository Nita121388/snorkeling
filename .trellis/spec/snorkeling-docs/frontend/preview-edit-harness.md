# Preview Edit Verify Harness — Rule Semantics & Pitfalls

> Entry: `scripts/verify/preview-edit/run.mjs` — the only public contract.
> `node scripts/verify/preview-edit/run.mjs --expect=fixed` (attach with `--attach`), single case with `--case=<id> --json`, regression-probe with `--legacy-css --expect=broken`.
> Exit codes: 0 = verdict matches expectation, 1 = mismatch, 2 = env/script error.

---

## Why this harness exists

To let an agent answer "did the inline-edit visual fix actually work" without a human looking at screenshots: real app + real pointer events + pixel evidence + machine-readable verdicts. Every rule below maps to a **real incident** that occurred in this codebase — do not weaken a rule without re-reading its incident note.

## Screenshot pipeline invariants (all were real incidents)

1. **`clip` capture is its own coordinate space.** When CDP honors the clip, the returned PNG **is already the target region** (at device resolution, typically 2x on retina). Never crop it again with absolute CSS coordinates — that produced 1×1 images and cascade false-reds. Normalize with `scalePng` (area-average) to CSS pixels instead.
2. **Verify clip was honored** (`png.width` within [0.9, 3]× of `clip.width`); otherwise treat the buffer as a full-window image: normalize by viewport width, then crop by CSS coordinates.
3. **`viewportSize()` must be valid before clipping.** If the viewport evaluates to 0, `clip` is clamped to 1×1 and `captureScreenshot` still succeeds — a silent lie. Fail the attempt into the trace instead.
4. **Full-window fallback is a degraded path**: the trace must surface in `report.warnings` (never swallow it).
5. **Never press Esc unconditionally.** If the overlay is already gone, a real Escape hits the app's global handler and closes the whole preview block; every following case then reports `no-root` (false-red cascade, block-closing incident 2026-11-04).
6. **Hide non-content UI before the `during` shot, scoped + transient**: caret/selection via `.inline-edit-overlay`-scoped style, plus `[data-selection-quick-action]` (the fixed-position orange quick-action button renders inside the text area and fakes parity failures). Inject before shot, remove after; `run.mjs`'s `finally` clears any leaked `style[id^="verify-"]`.
7. **Degenerate guards are hard failures**: crop NaN / ≤2px, PNG ≤2px — never persist a degenerate image for rules to misread.

## Rule semantics (ids are the contract)

| id | asserts | known blind spot |
|---|---|---|
| `text-zero-shift` | DOM rect: first text ink x/y identical before/during (≤1px) | style-only changes |
| `pixel-zero-shift` | per-row leftmost-ink profile identical (≤1.5px), no line-count loss | word-level re-wrap within same row count |
| `no-clip` | overlay content not clipped (children inside client box) | — |
| `pixel-visual-parity` | **structural** ink parity: line-band count, ink-mass ratio 0.82~1.18, mean ink luminance ≤8%, band edges ≤2px; pixel diff (±1px aligned) kept as evidence with a 15% catastrophe threshold | word-level inline changes are **diluted below threshold** — see `inline-style-parity` |
| `single-level-indent` | first-level list has no extra margin/padding indent | — |
| `marker-drawn` | list marker rendered (content ≠ none) and fully inside the overlay visible box; marker band derived from the ::before **computed `left`/`right` + border-left-width** (first-line mode positions by `left`, not by `right:100%`) | li with dynamic borders |
| `clean-exit` | after Esc: overlay gone, no `inline-edit-hidden/active` residue, target rect restored (±1px); **target rect must not be null** (null = block was closed — the old code passed it and deferred the failure by one case) | — |
| `no-measure-loop` | the inline-edit debug log shows no measure loop (needs `localStorage.snorkelingInlineEditDebug=1` + reload) | env-only warnings |
| `editor-kind` | `data-block-kind` matches expectation (wysiwyg vs textarea) | — |
| `inline-style-parity` | DOM-signature parity of every text-bearing inline token (`code, strong, b, em, i, kbd, samp, del, s, mark, a`): font-family, weight, style, color; tokens may not be added or lost. This is the **word-level** detector that pixel metrics cannot see (a single word losing bold shifts whole-image ink mass by only 2~5%). Icons (empty-text elements, e.g. the collapse chevron `<i>`) are filtered out. | — |

**Calibration record (2026-11-04)**: known-bad sample = `--legacy-css` (the pre-`f2661b96` list geometry). It must stay red (4/5; `paragraph` is legitimately unaffected because the legacy CSS targets lists only). Good runs must pass 5/5 **three consecutive times** before any change to this harness is considered verified.

## Product-side pitfalls discovered by this harness (do not reintroduce)

- **Never spread a DOMRect**: `{ ...rect, left, width }` loses `top`/`height` (prototype getters are not own enumerable properties) → `undefined.toFixed()` crashes the React tree and the error boundary kills the whole preview block. Use the explicit `listAnchorRect` helper (`frontend/app/element/markdown-inline-edit.tsx`), guarded by `markdown-inline-edit.test.ts` ("DOMRect spread pitfall").
- Debug/log code paths must format through `fmtPx`-style safe formatting — a log line must never be able to crash the app.
- Portaled overlays do not inherit `.markdown` scope: inline marks must be mirrored explicitly in `markdown.scss` (`.inline-edit-overlay[data-block-kind="wysiwyg"] .wysiwyg-editor`).

## Run artifacts

- `verify-runs/<ts>/report.json` (machine), `report.md` (human, embeds before/during/afterEsc/diff), per-case PNGs. Raw capture buffers are deleted unless `VERIFY_DEBUG_SHOT=1`.
- `verify-runs/` is gitignored. The verify instance is isolated: `.runcfg/verify`, vite 51799, CDP 9231. The user's own instance has no CDP and must never be touched.
