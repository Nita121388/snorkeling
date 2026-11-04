# Fix agent card model and vendor display

## Goal

Agent hover/card must show cc-switch vendor name and real model for TUI agents; fix identity resolution across hover and tab more card.

## Problem Statement

Agent hover card (`AgentHoverCard`) and tab "more" mini card (`TabMoreAgentCard`) were not truly displaying model and vendor/provider:
- Model was only resolved from `agent:requestedmodel` (launcher-only) or GUI chat's `LiveSessionState` (via `chatManager`). TUI agents were not in `chatManager`, hooks/`AgentStatusReport` don't report model, so model showed as "未指定".
- cc-switch vendor names (`agent:claudevendorname` / `agent:codexvendorname` / `agent:opencodevendorname` / `agent:pivendorname`) were written at launch but never read by cards, so vendor ("供应商") was not shown.
- `agent:provider` meta is cleared on agent exit; without live hook status provider could fall back to "Agent".

## Root Cause

1. **Model source**: `agent-hover-card.tsx:90-95` and `tab-more-agent-card.tsx` only used requested/live model. Terminal agents have no GUI chat session and often lack `agent:requestedmodel` meta.
2. **Vendor unused**: Launcher persists per-provider vendor names in block meta, but card code never consumed them.
3. **Session history not used**: AI session transcripts already parse model (e.g. `provider_claude.go`, `provider_opencode.go`), but cards never read session records.

## Additional Issue: Agent hover card Note must auto-save without requiring click outside

### Problem
In `AgentHoverCard` (`variant="hover"`), `SessionNoteSection` uses `onBlur={finishEditing}` to exit edit mode and save. Users have to click outside the card to trigger blur, which is inconvenient for hover cards.

### Root Cause
- `frontend/app/element/info-card/session-note-section.tsx:322` — textarea uses `onBlur={finishEditing}`
- `frontend/app/store/session-note-hook.ts` already has debounce auto-save when `dirty`, but the hover card relies on blur as the explicit "exit editing + save" path
- When the mouse quickly moves out of the hover card and it unmounts, the pending debounce save can be at risk of not firing in time

### Proposed Solution (Option A - Recommended)

**1) `frontend/app/store/session-note-hook.ts`**
- Add `flushSave()` that cancels any pending debounce timer and immediately calls `saveNote(noteDraft)` if there is unsaved `dirty` content
- On unmount cleanup, if `dirty` exists, call `flushSave()` as a fallback to avoid losing edits when the hover card unmounts

**2) `frontend/app/element/info-card/session-note-section.tsx`**
- For `variant === "hover"`: replace the direct `onBlur={finishEditing}` with a gentler handler. If `dirty`, trigger an immediate save (via flush/clear-timer + save) before exiting edit mode; otherwise just `setIsEditing(false)`. Keep behavior consistent with "save on pause" instead of requiring an outside click
- For `variant === "detail"`: keep existing `onBlur={finishEditing}` behavior unchanged to avoid regressions in `SessionDetailInfoCard` and other detail views

**3) Verification**
- Edit Note in agent hover card without clicking outside -> should auto-save after debounce (~800ms)
- Move mouse out quickly causing hover card to unmount -> no data loss (flush on unmount)
- Edit in session detail card -> existing blur/save behavior unchanged
- `frontend/app/block/block-info-card.test.tsx` passes

## Solution

### Frontend
- **New identity resolver**: `frontend/app/view/term/agent-identity.ts` - unified resolution for vendor name, provider label, and model with fallback chain (`live` → `session` → `requested`).
- **Hover card**: `frontend/app/view/term/agent-hover-card.tsx` - prefer `vendorName || providerLabel` for display (shows cc-switch vendor as "供应商"), use unified model resolution, fallback to `agentStatus.provider` even if meta cleared.
- **Tab more card**: `frontend/app/tab/tab-more-agent-card.tsx` - apply same vendor/model resolution to mini rows.
- **Runtime metadata store**: `frontend/app/agent-status/agent-runtime-metadata-store.ts` - accept model when `modelId`/`modelName` present regardless of `live` flag, support `source: "session"` for disk-resolved models.
- **Note auto-save (hover)**: Apply Option A above to make hover card Note saving work without requiring click outside

### Backend
- **LiveSessionState disk fallback**: `pkg/service/aisessionsservice/chatcontrol.go` - when no GUI `chatManager` session found, resolve via `aisessions.Manager` (`Summary` + `Load` last assistant message with `Model`), return model/provider for TUI agents. Kept GUI chat path unchanged.

## Requirements

- [x] Show cc-switch vendor name (供应商) in agent hover card and tab more mini card when present
- [x] Show real model (模型) for TUI agents when available from session history
- [x] Agent hover card Note auto-saves on debounce without requiring click outside
- [x] Agent hover card flushes pending Note save on unmount
- [x] Maintain backward compatibility with existing launcher/requested model flow
- [x] Keep SessionDetailInfoCard detail mode behavior unchanged
- [x] Don't block rendering on async resolution (existing fallback behavior preserved)

## Acceptance Criteria

- [x] Vendor name displayed from `agent:claude/codex/opencode/pi` vendor meta when set
- [x] Model shows from disk-resolved session when no live GUI session exists
- [x] Editing Note in hover card and moving mouse away saves without clicking outside
- [x] No regression to detail card Note editing/saving
- [x] Card still shows "未指定" only when no model source exists
- [x] `frontend/app/block/block-info-card.test.tsx` passes (includes term agent blocks to AgentHoverCard)
- [x] Go packages compile: `./pkg/service/aisessionsservice/... ./pkg/aisessions/...`
- [x] No new TypeScript errors introduced by changed files

## Verification

- `npx vitest run frontend/app/block/block-info-card.test.tsx` - 8/8 passed
- `go test ./pkg/aisessions/... ./pkg/service/aisessionsservice/...` - all ok (26s / 91s / 40s)
- `go vet ./pkg/service/aisessionsservice/...` - clean
- `go build ./pkg/service/aisessionsservice/... ./pkg/aisessions/...` - success
- `npx tsc --noEmit` - no errors in the five touched files (repo has pre-existing unrelated errors)
- `gofmt -l pkg/service/aisessionsservice/chatcontrol.go` - clean
- `npx vitest run frontend/app/store/session-note-hook.test.tsx` - 12/12 passed (2 new: unmount flush, flushSave cancels debounce)
- `npx tsc --noEmit` - clean for all six touched files
- Manual: hover card Note edit -> debounce save + unmount flush verified after implementation

## Note Auto-save Implementation (Option A, delivered)

- `frontend/app/store/session-note-hook.ts`
  - Added `flushSave()`: cancels the pending debounce timer and immediately calls `saveNote` when the draft is dirty.
  - Added `dirtyRef` / `saveNoteRef` so the once-only unmount cleanup uses the current `saveNote` closure instead of the stale first-render one.
  - Unmount cleanup now invalidates in-flight results (`saveSeqRef++`) and then flushes the dirty draft once.
  - `finishEditing` switched to `latestDraftRef.current` so it saves what the user actually sees.
- `frontend/app/element/info-card/session-note-section.tsx`
  - `variant="hover"`: `onBlur` now calls `flushSave()` then exits edit mode (leaving the textarea saves; no need to click outside the card).
  - `variant="detail"`: keeps `finishEditing` unchanged, so `SessionDetailInfoCard` behavior does not regress.
- Behavior composition: typing keeps the existing ~800ms debounce save; leaving the textarea flushes immediately; unmounting the hover card (fast mouse-out) still flushes once.
- Tests added in `frontend/app/store/session-note-hook.test.tsx`:
  - "flushes the pending draft immediately when the card unmounts (hover fast-exit)"
  - "flushSave() cancels the debounce timer and saves only once"

## Review Findings (2026-11-04 audit)

Issues found during audit of the first implementation pass and how they were resolved:

1. **[Fixed] `showMetaRow` regression**: first pass changed it to `displayProvider !== ""`, but `displayProvider` falls back to `"Agent"` and is therefore never empty — the header would render for empty sessions where it previously returned null. Restored the "has real information" test: `providerLabel !== "Agent" || model !== "" || modelLoading || statusPres != null`.
2. **[Fixed] `liveModel` semantics**: first pass wrote `runtimeEntry?.source === "live" ? runtimeEntry.model : runtimeEntry?.model`, which unconditionally read `model` and routed session-resolved models through the live slot. Now `liveModel` and `sessionResolvedModel` are each gated on their own `source`.
3. **[Fixed] Vendor name lost after agent exit**: cleanup (`agentRuntimeMetaClearUpdate` in `pkg/blockcontroller/shellcontroller.go`) clears `agent:provider` / `agent:sessionid` but NOT `agent:*vendorname`. Because the vendor lookup was keyed off the provider, a finished session lost its vendor name. Added `resolveAnyAgentVendorName()` provider-agnostic fallback so the cc-switch vendor survives provider meta clearing.
4. **[Fixed] Unused parameter**: `resolveAgentModel({ meta, ... })` never read `meta`. Parameter removed; both call sites updated.
5. **[Fixed] Dead Go branch**: `if resp.ModelID != "" || ... { resp.Live = false }` was a no-op (`Live` already defaults to false). Removed.
6. **[Fixed] Over-wide union type**: `AgentProviderKey` ended with `| string`, collapsing it to `string`. Simplified to `type AgentProviderKey = string`.

### Known limitations (accepted for this task)

- **`TabMoreAgentCard` mini rows do not subscribe to `AgentRuntimeMetadataStore`**, so they only show `agent:requestedmodel`; a session-resolved model surfaces in the full hover card but not in the compact tab-more row. Follow-up if the mini row needs parity.
- **`LiveSessionState` disk fallback calls `manager.Load`**, which reads the full session. Requests are deduplicated per block by `ensureAgentRuntimeMetadata`, but a per-provider light tail-scan (read only the last few KB / last message) would be the scalable version.
- **Codex/pi transcripts do not reliably expose a per-message `Model`** (only claude `message.model` and opencode session model do), so those sources may still fall back to `未指定` until a provider-level `LastModel` capability lands.

## Notes

- For agents never indexed or with no parseable model, fallback remains "未指定" (acceptable). Could add lighter tail-scan per provider if needed.
- Provider may still show as "Agent" in rare cases where all sources missing, but vendor name + status provider now have better fallbacks.
- Prefer Option A over document-level mousedown capture to keep changes minimal and avoid event-bubbling side effects.
- `agent:*vendorname` meta survives agent exit while `agent:provider` does not; treat vendor name as the durable identity signal for finished sessions.
