# Foundation UI semantic-token cleanup

Written against: `8ceaaa06fe5c84f8ecc9714ae5f30d2fc4526ba2` and the current working tree

## Evidence chain

- Surface: Electron renderer feature chrome and the linked Preview surfaces in `frontend/app/`
- Design evidence: `docs/design-system.md` sections 4, 7, 8, and 10
- Scope: confirmed fixed-palette occurrences from the occurrence-level audit; terminal ANSI, brand, user-selected, diff, and transparent-backdrop exceptions remain excluded
- Uncertainty: onboarding `InitPage` and `VTab`/`WorkspaceSwitcher` have HIGH upstream impact and require the stated regression gate

## Design decision

Use the existing semantic surface, action, state, and focus tokens at the owning component boundary. Preserve all event handlers, state transitions, dimensions, and content.

## Changes

1. `frontend/app/onboarding/onboarding.tsx`
   - Replace feature-owned `text-white/50` icons with `text-accent` and `accent-gray-500` with `accent-accent`.
   - Preserve onboarding copy, links, checkbox semantics, and layout.
   - Verify InitPage in dark/light/monochrome and keyboard checkbox focus.
2. `frontend/app/view/aisessions/aisessions.tsx` and `session-detail.tsx`
   - Replace the filter-count badge with action-soft tokens and the destructive confirmation text with `text-actiontext`.
   - Preserve filtering and deletion behavior.
3. `frontend/app/view/term/term-tooltip.tsx`
   - Reuse the shared overlay/border/foreground token contract from `element/tooltip.tsx`.
   - Preserve tooltip placement, dimensions, and shadow.
4. `frontend/app/session-overview/session-overview.scss`, `frontend/app/tab/workspaceswitcher.scss`, and `frontend/app/tab/vtab.tsx`
   - Replace confirmed destructive/status fixed colors and the workspace divider/edit surface with existing error/success/warning/border/foreground tokens.
   - Add only the required focus-visible treatment to the editable tab surface; preserve rename behavior.

## Scope

- Inherit: existing callers of `InitPage`, `AiSessionsView`, `SessionDetailPane`, `TermTooltip`, `AgentStatusChip`, `WorkspaceSwitcher`, and `VTab`.
- Verify: their Preview/Electron render paths, narrow viewport layout, hover/focus/disabled/error states.
- Exclude: business logic, RPC/IPC, startup scripts, terminal ANSI, provider/agent brand colors, user workspace colors, syntax/diff colors, and transparent backdrops.

## Validation

- Product: run focused Vitest contracts for semantic tokens and existing affected-area tests.
- Interface: capture dark/light/monochrome screenshots; assert computed tokens, no overflow, and focus-visible/disabled/error states.
- Repository: `git diff --check`, `npm run build:prod`, and `gitnexus detect-changes --scope all --repo snorkeling --branch feat/light-theme`.

## Stop conditions

- Stop an individual change if GitNexus exposes HIGH/CRITICAL risk not already reported, if the correction changes behavior, or if rendered evidence shows a valid domain exception.

## Design documentation

- After validation, update `docs/design-system.md`, `docs/ui-violations.md`, and the two linked Obsidian records with the final classification and evidence.
