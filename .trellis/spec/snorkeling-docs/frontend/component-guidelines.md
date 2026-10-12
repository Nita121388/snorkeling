# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

(To be filled by the team)

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

### 1. A changed `key` disposes the subtree — view-model constructor side effects re-run

`frontend/app/block/block.tsx` renders the active inline tab with a changing key:

```tsx
<BlockInner key={activeBlockId + ":" + viewType} … />
```

`BlockInner`'s `useEffect(…, [])` cleanup calls `unregisterBlockComponentModel(blockId)` +
`viewModel.dispose()`. So **switching inline tabs, magnifying, or switching workspace/tab
back disposes and re-creates the view model** — the constructor runs again.

Consequence: any constructor side effect that is meant to happen **once** (usage counting,
analytics, registration, "first open" bookkeeping) will silently run again on every re-mount.

Real example: the Files path-hub recorded a preview block's initial path from the
`PreviewModel` constructor. Merely toggling between inline tabs inflated that path's use
count, which promoted it into the "Frequent" list without the user re-opening anything.

Fix pattern — keep the effect but gate it on a **stable identity** that survives the remount
(the block id, never the model instance), and only keep the claim when the effect actually
succeeded:

```ts
const initialRecordedBlockIds = new Set<string>();

export function recordInitialPathUsage(blockId, path, kind, connection?) {
    if (!claimInitialPathRecord(initialRecordedBlockIds, blockId)) return;
    if (!recordPathUsage(path, kind, connection)) {
        initialRecordedBlockIds.delete(blockId); // let a later mount retry
    }
}
```

Keep genuinely *event-driven* work ungated: the path-hub's `metaFilePath` subscription
(real navigation) calls the ungated `recordPathUsage`, so navigation still counts.

**How to check before adding a constructor side effect**: grep the component for its `key`
and for the unmount cleanup, then ask "can this component unmount without the user doing the
thing I'm counting?". See `frontend/app/block/block.tsx` (`SingleBlock` / `InlineTabBlock`),
`frontend/app/view/preview/path-usage-store.ts`,
`frontend/app/view/preview/preview-model-path-usage.test.ts`.

### 2. Testing module-level mutable state

When a module keeps state at module scope (buffers, debounce timers, `Set`/`Map` claims),
a test must re-import a **fresh module instance** per case (`vi.resetModules()` + dynamic
`import()`), otherwise cases leak into each other. See
`frontend/app/view/preview/path-usage-store.test.ts`.
