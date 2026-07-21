# Snorkeling Design System

Status: Active  
Owner: Snorkeling frontend  
Last updated: 2026-07-19

This document is the single source of truth for Snorkeling's foundational UI. Component code, theme CSS, mockups, and feature surfaces must conform to this document. When implementation and this document disagree, either fix the implementation or update this document in the same reviewed change.

The interactive visual reference is `.mockup/design-system.html`.

## 1. Scope

This system governs the Electron renderer under `frontend/app/`:

- App chrome, workspaces, Blocks, WidgetsBar, overlays, and modals.
- Shared buttons, icon buttons, inputs, textareas, toggles, menus, and status messages.
- Dark, light, and monochrome app themes.
- Default, hover, active, focus-visible, disabled, loading, selected, warning, and error presentation.

It does not redefine terminal ANSI colors, syntax highlighting, provider logos, user-selected workspace colors, or third-party rendered content. Those values may remain domain-specific, but their surrounding UI must use semantic tokens.

## 2. Principles

1. **Semantic ownership.** Feature UI consumes semantic tokens, never a palette shade chosen for one theme.
2. **Theme parity.** A component is complete only when it remains legible and identifiable in dark, light, and monochrome.
3. **State parity.** Mouse, keyboard, loading, disabled, selected, and error states must preserve the component's dimensions.
4. **Quiet operational density.** Snorkeling is a repeated-use work surface. Prefer compact controls, clear alignment, and restrained surfaces.
5. **Native behavior first.** Use native `button`, `input`, `textarea`, `select`, and `dialog` behavior unless an existing component owns the interaction.
6. **No color-only meaning.** Error, warning, success, and selected states also require text, an icon, a border, or another persistent cue.

## 3. Theme Contract

The root theme is selected with `data-theme="dark|light|monochrome"`. `system` is a preference mode and must resolve to dark or light before rendering.

Monochrome is white-dominant and follows the light path for binary renderers such as Monaco, Shiki, Mermaid, terminal rendering, and native `color-scheme`.

| Role | Dark | Light | Monochrome |
| --- | --- | --- | --- |
| Canvas | `#222222` | `#ebe5d9` | `#fafafa` |
| Primary text | `#f7f7f7` | `#4c3924` | `#0a0a0a` |
| Secondary text | `#c3c8c2` | `#675033` | `#4a4a4a` |
| Primary action | `#58c142` | `#7c49a1` | `#1a1a1a` |
| Primary action text | `#000000` | `#ffffff` | `#ffffff` |
| Error | `#e54d2e` | `#d32f2f` | `#2a2a2a` |

These values document the current palette. Features must consume roles rather than copying values.

## 4. Semantic Tokens

### 4.1 Content and surfaces

| Meaning | CSS variable | Tailwind token | Use |
| --- | --- | --- | --- |
| App canvas | `--main-bg-color` | `bg-background` | Root and unframed page bands |
| Primary content | `--main-text-color` | `text-primary` / `text-foreground` | Titles and primary values |
| Secondary content | `--secondary-text-color` | `text-secondary` | Metadata, labels, inactive icons |
| De-emphasized content | `--grey-text-color` | `text-muted` | Tertiary or placeholder content |
| Panel | `--panel-bg-color` | `bg-panel` | Sidebars and tool panels |
| Soft surface | `--color-surface-soft` | `bg-surface-soft` | Subtle grouping |
| Surface | `--color-surface` | `bg-surface` | Repeated rows and controls |
| Strong surface | `--color-surface-strong` | `bg-surface-strong` | Selected or raised local regions |
| Overlay | `--overlay-bg-color` | `bg-overlay` | Menus, popovers, floating tools |
| Modal | `--modal-bg-color` | `bg-modalbg` | Dialog body |
| Border | `--border-color` | `border-border` | Default separators and outlines |
| Hover | `--hover-bg-color` | `bg-hover` | Subtle row/control hover |
| Strong hover | `--hover-bg-color-strong` | `bg-hoverbg` | Compact icon-button hover |

`white`, `black`, `gray-*`, `zinc-*`, and opacity variants of those utilities are prohibited for feature-owned surfaces and text. They are permitted only in documented terminal, image, shadow, backdrop, and third-party-content exceptions.

### 4.2 Actions and states

| Meaning | CSS variable | Tailwind token |
| --- | --- | --- |
| Primary action background | `--action-bg-color` | `bg-action` |
| Primary action hover | `--action-hover-bg-color` | `hover:bg-actionhover` |
| Primary action text | `--action-text-color` | `text-actiontext` |
| Soft selected/action background | `--action-soft-bg-color` | `bg-actionsoft` |
| Soft selected/action text | `--action-soft-text-color` | `text-actionsofttext` |
| Soft selected/action border | `--action-soft-border-color` | `border-actionsoftborder` |
| Accent/focus | `--accent-color` | `text-accent`, `border-accent`, `ring-accent` |
| Error | `--error-color` | `text-error`, `border-error`, `bg-error` |
| Warning | `--warning-color` | `text-warning`, `border-warning`, `bg-warning` |
| Success | `--success-color` | `text-success`, `border-success`, `bg-success` |

Primary action buttons use:

```text
bg-action text-actiontext hover:bg-actionhover cursor-pointer
disabled:cursor-default disabled:opacity-50
```

Do not use the accent ramp as an action background. Accent remains available for focus, selection, links, and non-filled emphasis.

## 5. Typography

| Role | Size | Weight | Notes |
| --- | --- | --- | --- |
| Page/tool title | 18px | 600-700 | Only for the primary title of a full view |
| Panel title | 14px | 600 | Compact panel and modal headings |
| Body/default | 14px | 400 | Product content |
| Control/metadata | 12px | 400-600 | Dense controls and secondary labels |
| Micro status | 10px | 500-600 | Badges and counters only |
| Terminal/code | 12px | 400 | `Hack`, monospace |

Use `Inter` for product UI and `Hack` for terminal/code. Letter spacing is `0`. Font size must not scale with viewport width.

## 6. Geometry

- Base radius: `6px`; larger repeated items may use `8px`. Do not exceed `8px` for foundational UI.
- Compact icon controls: stable square dimensions of `20px`, `28px`, or `32px`.
- Standard control height: `32px`; dense control height: `28px`.
- Control spacing: `4px`, `8px`, `12px`, `16px`, then `24px`.
- Borders: `1px`; focus rings may add a non-layout-shifting `1px` or `2px` ring.
- Components must not change width, height, border width, or padding between states.

## 7. Interaction States

### 7.1 Hover and active

- Hover must change background, border, or content color using semantic tokens.
- Active/pressed may use `bg-hoverbg` or a small translate only when dimensions remain stable.
- Selected items use `bg-actionsoft text-actionsofttext border-actionsoftborder` or an accent indicator plus semantic text.
- Touch and disabled controls must not depend on hover to communicate state.

### 7.2 Keyboard focus

Every keyboard-focusable custom control must have a visible `:focus-visible` treatment. The default contract is:

```text
focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent
```

Inputs may use `focus:border-accent` when the full control boundary changes visibly. Never remove the native outline without an equivalent replacement.

### 7.3 Disabled and loading

- Disabled controls use `cursor-default`, never `cursor-not-allowed` or `cursor-help`.
- Use `opacity: 0.5-0.6` and suppress hover changes.
- Native controls retain the `disabled` attribute and leave the tab order naturally.
- Loading controls keep their label width or stable dimensions and expose progress without shifting adjacent controls.

### 7.4 Error

- Inputs use `aria-invalid="true"`, `border-error`, and a nearby `text-error` message.
- Error text states what failed and, where useful, how to recover.
- Destructive commands are not primary actions; use the destructive role and require confirmation where data loss is possible.
- In monochrome, error must remain distinguishable through an icon, label, and border because hue is intentionally absent.

## 8. Component Contracts

### Button

- Primary: semantic action tokens.
- Secondary: semantic surface/border/text tokens.
- Ghost: transparent base, semantic hover, stable padding.
- Destructive: error role, not a copied red palette shade.
- Icon-only buttons require an accessible name and stable square dimensions.

### Input and Textarea

- Use semantic form background, text, border, placeholder, focus, disabled, and error roles.
- Grouped inputs put focus/error indication on the group owner, not both group and child.
- Placeholder text is secondary; entered text is primary.

### Toggle and Checkbox

- Use native checkbox semantics.
- Checked uses the action or selected role; unchecked uses border/surface roles.
- Focus-visible appears around the complete switch.
- Label click targets the input. Disabled state applies to both switch and label.

### Modal, Popover, and Menu

- Modal uses semantic backdrop, modal surface, border, and shadow.
- Dialog layout is header, scrollable content, and footer. Footer actions do not move when content overflows.
- Menus and popovers use overlay tokens and retain keyboard focus visibility.
- Do not place cards inside modal cards; use unframed sections within the modal surface.

## 9. Exceptions

The following may use non-semantic colors when the value itself carries domain meaning:

- Terminal ANSI palettes and xterm internal CSS.
- Syntax highlighting and diff insertion/deletion colors.
- Provider/agent brand colors and user-selected workspace colors.
- Image masks, transparent black backdrops, and neutral shadows.
- Third-party rendered content that cannot inherit app tokens.

An exception must remain legible in all three themes and should be isolated to the smallest owner. An exception is not permission to hard-code its surrounding surface or text.

## 10. Verification Gate

Every foundational UI batch must include:

1. GitNexus upstream impact analysis before modifying a symbol.
2. A targeted runnable check for new or changed non-trivial logic.
3. Relevant Vitest tests and `npm run build:prod`.
4. GitNexus `detect_changes` against `main` before commit.
5. Electron CDP screenshots for dark, light, and monochrome.
6. Keyboard verification of focus-visible plus disabled and error state inspection.
7. Layout checks at the active desktop viewport and a narrow/resized viewport where the surface supports it.

## 11. Repository Violation Register

Search results are candidates until the runtime owner and deterministic correction are proven.

| ID | Status | Rule | Confirmed scope | Batch |
| --- | --- | --- | --- | --- |
| DS-001 | Confirmed | Feature surfaces must use semantic theme tokens | `frontend/app/aipanel/` fixed `zinc/gray/white` palette produces low contrast in Light | 2 |
| DS-002 | Confirmed | Removing focus outline requires an equivalent focus-visible indicator | `frontend/app/aipanel/aipanelheader.tsx` More options | 2 |
| DS-003 | Confirmed | Disabled controls use `cursor-default` | Eight occurrences across AI Sessions and Wave Config | 3 |
| DS-004 | Confirmed | Feature surfaces must use semantic theme tokens | `frontend/app/view/waveconfig/secretscontent.tsx` fixed dark surfaces/text | 3 |
| DS-005 | Candidate | Feature surfaces must use semantic theme tokens | 49 of 202 scanned UI files remained after the initial exception pass | 4 |
| DS-006 | Confirmed / fixed | Informational announcements use the app action/accent family | `frontend/app/aipanel/byokannouncement.tsx` and telemetry notice used fixed blue surfaces/text | 4 |
| DS-007 | Confirmed / fixed | Shared feature surfaces and status text use semantic tokens | Onboarding FakeChat, Suggestion, AI Sessions search, Common Text, Durable flyover, WidgetsBar, resize handles, Clipboard, and WebView bookmark empty states | 5 |
| DS-008 | Confirmed / deferred | Foundational modal border remains a stable `1px` | `frontend/app/modals/modal.scss` uses `0.5px`; global Modal/FlexiModal impact is CRITICAL and is isolated for a dedicated batch | 6 |
| DS-009 | Confirmed / deferred | Shared modal error copy uses `text-error` | `frontend/app/tab/tab-target-modal.tsx` uses `text-red-400`; function impact is HIGH and is isolated for a dedicated batch | 6 |

Candidate DS-005 must be classified into confirmed violation, brand/domain color, terminal/syntax exception, third-party style, or false positive. Do not bulk-replace fixed colors.

## 12. Batch Status

| Batch | Scope | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Theme variables, semantic Tailwind aliases, and visual reference | Complete | `theme.scss`, `tailwindsetup.css`, `.mockup/design-system.html` |
| 2 | Shared buttons, icon buttons, inputs, textareas, and toggles | Complete | `frontend/app/element/*`, foundation state tests |
| 3 | AI Sessions and Wave Config confirmed state violations | Complete | `frontend/app/view/aisessions/*`, `frontend/app/view/waveconfig/*`, targeted Vitest |
| 4 | AI Panel surfaces, announcements, messages, tool states, and violation register | Complete | `frontend/app/aipanel/*`, `docs/ui-violations.md`, Playwright visual checks |
| 5 | Onboarding, shared suggestion/session/status chrome, WidgetsBar, Clipboard, and WebView empty states | Complete | Targeted Vitest, onboarding Preview screenshots, Electron Light search-state screenshot, production build |
| 6 | HIGH/CRITICAL shared modal changes | Pending isolated review | `TabTargetModal` HIGH and `Modal/FlexiModal` CRITICAL impact must be reviewed before editing |

The current violation register is an audit snapshot, not a permission to replace every palette match. The remaining candidates are tracked in `docs/ui-violations.md` with their runtime owner, exception classification, and next review boundary.
