# Technical Design — CommonText Send Model & Path

## Change Boundary

Smallest behavior gap: the send popover cannot choose a per-send model and only exposes the folder as a dropdown, while the approved prototype and New Agent use a model control plus a visible path list.

Behavior owner: `frontend/app/commontext/commontext-send-button.tsx` (`CommontextSendConfig`, `previewSendTarget`, `executeCommonTextSend`, `SendTargetPanel`, `CommontextSendButton`). Path candidate ownership remains in `commontext-send-target.ts`; model catalog ownership remains in `workspace/agent-catalog.ts`; block construction remains in `workspace/agent-launch.ts`.

Expected files:

- `frontend/app/commontext/commontext-send-button.tsx` — config field, model catalog state/control, named Agent chips, visible path list, footer summary, model override propagation.
- `frontend/i18n/locales/{zh,en}/commontext.json` — new model / path labels and default copy.
- `frontend/app/commontext/commontext-send-existing.test.ts` — model forces create and typed config fixture.
- `frontend/app/commontext/commontext-send-create-path.test.ts` — model override reaches block constructor.
- `frontend/app/commontext/commontext-send-popover-geometry.dom.test.tsx` — new DOM contract and geometry.
- `scripts/verify/commontext-send-agent-block/verify.mjs` — real Electron interactions and layout assertions.

Explicitly not changing `resolveSendTarget`, backend RPCs, `agent-launch.ts`, Overview New Agent, vendor behavior, scheduling, or persistence.

## Data Flow

```text
Agent chip ─┐
Tab picker ─┼─> CommontextSendConfig {profile, model, tab, folder, background}
Path row ───┘              │
                           ├─> previewSendTarget()
                           │      └─ model != null => forceCreate
                           │
                           └─> executeCommonTextSend()
                                  ├─ existing: unchanged AgentSend/paste path
                                  └─ create: createAgentBlockDefForProfile(..., modelOverride)
                                             └─ AgentSendCommand
```

Model catalog:

```text
loadAgentCatalog() → AgentProfileInfo[]
findAgentProfile(catalog, selectedProfile) → modelOptionsFor() → select/input
```

Path candidates:

```text
config.tab → collectSendFolderCandidates(config) → visible path list
folder=null → first candidate (follow Tab)
folder=<path> → explicit candidate
```

## Contracts

### CommontextSendConfig

Add `model: string | null`.

- `null` means profile/vendor default.
- Non-empty string means explicit per-launch override.
- Runtime callers that patch the atom with an older object may omit the field; reads use `config.model ?? null` so no migration or storage rewrite is required.
- Switching Agent sets `model=null`.
- Switching to focused mode sets `model=null`.

### previewSendTarget

- Keep `resolveSendTarget` unchanged.
- Pass `forceCreate: config.mode === "create" || (config.model ?? null) != null`.
- This makes model selection create-only even if a stale UI state leaves `mode=focused`.

### executeCommonTextSend

- Existing path ignores model because `previewSendTarget` cannot return existing when model is non-null.
- Create path calls:

```ts
createAgentBlockDefForProfile(
    preview.profileName,
    settings,
    context,
    undefined,
    undefined,
    undefined,
    config.model ?? undefined
);
```

- No change to dispatch, wait, background activation, or error handling.

## UI Structure

Mirror the approved prototype:

1. Header: title + focused/create chips + close.
2. Agent section: named 30px chips with 2px selected rail; model select/input underneath.
3. Location section: Tab picker + new Tab button; visible scrollable path list; browse directory row.
4. Background switch.
5. Footer: single target crumb + cancel + dynamic send button.

Remove the duplicated target card and folder dropdown. Preserve probe attributes where semantics still exist:

- `data-commontext-agent-row`
- `data-commontext-agent-chip`
- `data-commontext-tab-row`
- `data-commontext-tab-trigger`
- `data-commontext-dir-row` (now the path section)
- `data-commontext-send-footer`
- `data-commontext-send-submit`

Add:

- `data-commontext-model-row`
- `data-commontext-model-select`
- `data-commontext-path-list`
- `data-commontext-path-row`

## Model Fallback

- Catalog has models: native select with default option and model IDs.
- Catalog has no models: text input with the same placeholder; entered value becomes `config.model`.
- Catalog load failure: `loadAgentCatalog` already resolves to `[]`; UI remains usable.

## Path List Behavior

- `folderCandidates` is already memoized from `collectSendFolderCandidates(config)`.
- Selected path is `config.folder ?? folderCandidates[0]?.path ?? ""`.
- Each row is a native button with `role=option` and `aria-selected`.
- Clicking a row sets `folder` and `mode=create`.
- Tab changes keep existing `applyTab()` reset semantics.
- Browse uses the existing `browseFolder()` function.

## Compatibility & Rollback

- No persisted config shape changes; atom is in-memory.
- No backend or generated type changes.
- Rollback is a single revert of the CommonText send button, tests, i18n keys, and verify script.
- Existing send execution tests remain the guard that dispatch semantics did not change.

## Verification Strategy

1. Red tests first: model force-create, model constructor argument, model/path DOM contract.
2. Targeted Vitest for existing/create/geometry.
3. i18n parity.
4. Real Electron `commontext-send-agent-block` verify with updated selectors and height budget.
5. GitNexus `detect_changes` before commit.
