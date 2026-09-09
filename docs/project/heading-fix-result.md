# Heading Visual Bug Fix — Result

## Changes Made

### Bug 1: 标题被挤到右侧

**File**: `frontend/app/element/markdown.scss`

**Root cause**: `.heading-collapse-button` had `width: 1.286em; flex: 0 0 1.286em;` which occupied space even when `opacity: 0` (hidden). The flex layout kept the invisible button's width, pushing `.heading-title` rightward.

**Fix**:
- Default state: `width: 0; flex: 0 0 0; padding: 0; overflow: hidden;` — button occupies zero space
- Visible state (hover/collapsed/focus): `width: 1.286em; flex: 0 0 1.286em; padding: 0;` — button expands into view
- Added `transition: width 0.15s ease, opacity 0.15s ease;` for smooth reveal

### Bug 2: 左侧横线在无 emoji badge 时也显示

**File**: `frontend/app/element/markdown.scss`

**Root cause**: Selector `.markdown.markdown .content .markdown-render-root .heading:first-of-type::before` matched ALL first headings, regardless of whether a doc emoji badge existed.

**Fix**: Changed selector to require a `.markdown-doc-emoji-badge` sibling or ancestor:
```scss
.markdown-doc-emoji-badge ~ .markdown-render-root .heading:first-of-type::before,
:has(.markdown-doc-emoji-badge) .markdown-render-root .heading:first-of-type::before
```

## Files Changed
- `frontend/app/element/markdown.scss` (3 blocks replaced)

## Verification
- Read back both modified sections — edits applied correctly
- No TypeScript compilation needed (CSS-only changes)

## Residual Risks
- `:has()` selector is supported in Chromium 105+ (Electron 25+). Snorkeling's Electron is recent enough; no compat issue.
- Transition on collapse button is 150ms — may feel slightly laggy on very fast mouse movements, but acceptable for hover affordance.
