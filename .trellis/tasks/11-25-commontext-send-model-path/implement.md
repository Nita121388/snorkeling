# Implementation Plan — CommonText Send Model & Path

## Ordered Checklist

- [x] 1. Final planning review with user; record explicit approval.
- [x] 2. Refresh GitNexus index; run upstream impact for `previewSendTarget`, `executeCommonTextSend`, `SendTargetPanel`, and `CommontextSendButton`; report blast radius before edits. Impact: preview LOW/7, execute LOW/2, panel LOW/3, button HIGH/9 (CommonText + Element + Modals + App). Index rebuilt successfully with one worker; unrelated commits during indexing leave status stale but target symbols are present.
- [x] 3. Add red tests for model force-create, model override propagation, named Agent/model/path DOM, and path reset on Tab change.
- [x] 4. Implement `CommontextSendConfig.model`, preview force-create, and create-path model override.
- [x] 5. Implement model catalog loading and select/input fallback in `SendTargetPanel`.
- [x] 6. Replace logo-only Agent row with named chips; remove target card; add header and footer crumb.
- [x] 7. Replace folder dropdown with visible scrollable path list; preserve Tab reset and browse action.
- [x] 8. Add zh/en i18n keys; run parity check.
- [x] 9. Update geometry DOM test and real Electron verify script; keep assertions strict for new behavior.
- [ ] 10. Run targeted tests, verify area, and narrow viewport checks; capture evidence. **Blocked:** targeted Vitest 21/21 and i18n parity pass; real Electron verify exhausted 2 retries with environment-only failures (Vite chunk parse race, then 0x0 target / initPromise timeout), 0 product assertions ran; loop parked `human-wall`.
- [ ] 11. Update relevant spec / prototype status if implementation reveals a reusable contract.
- [ ] 12. Run GitNexus `detect_changes`, review scope, commit only this package.

## Validation Commands

```bash
npx vitest run frontend/app/commontext/commontext-send-existing.test.ts frontend/app/commontext/commontext-send-create-path.test.ts frontend/app/commontext/commontext-send-popover-geometry.dom.test.tsx && echo CT_SEND_UNIT_OK
node scripts/i18n/check-parity.mjs && echo CT_I18N_OK
node scripts/verify/index.mjs --area commontext-send-agent-block && echo CT_SEND_VERIFY_OK
node .gitnexus/run.cjs detect-changes
```

Expected markers:

- `CT_SEND_UNIT_OK`
- `CT_I18N_OK`
- `CT_SEND_VERIFY_OK`

## Red Proof Plan

Known-bad samples before implementation:

1. `previewSendTarget` with `mode=focused`, matching profile/tab/folder, and non-empty `model` currently returns `existing`; expected `create`.
2. `executeCommonTextSend` create path currently calls `createAgentBlockDefForProfile` without a model argument; expected 7th argument to equal selected model.
3. DOM currently has no model control and no visible path rows; expected both to exist.
4. Switching Tab currently updates a dropdown value; expected visible path rows to be replaced and default selection reset.

Store red output under `loop/red/N-1125-commontext-send-model-path.txt` via the loop gate command after tests are written.

## Touch Whitelist

- `frontend/app/commontext/commontext-send-button.tsx`
- `frontend/app/commontext/commontext-send-existing.test.ts`
- `frontend/app/commontext/commontext-send-create-path.test.ts`
- `frontend/app/commontext/commontext-send-popover-geometry.dom.test.tsx`
- `frontend/i18n/locales/zh/commontext.json`
- `frontend/i18n/locales/en/commontext.json`
- `scripts/verify/commontext-send-agent-block/verify.mjs`
- `.trellis/tasks/11-25-commontext-send-model-path/**`
- `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md` (only if a reusable lesson is confirmed)
- `design/prototypes/commontext/commontext-send-agent-unify/**`
- `docs/project/verify-ledger.md`
- `loop/**`

## Risk / Rollback Points

- GitNexus stale index: refresh before symbol edits; if unavailable, stop rather than guessing impact.
- Large JSX rewrite: keep execution functions intact and change only preview/config call signature plus panel rendering.
- Verify script old selectors: update in the same batch; do not weaken assertions to preserve obsolete UI.
- Any out-of-whitelist change: stop and park `out-of-scope`.
- Rollback: revert this package commit; no data migration exists.

## Review Gates

- User approves final planning summary.
- G1 signed from `prd.md`.
- G2 red proof recorded.
- Targeted tests + i18n + real Electron verify green.
- `detect_changes` matches expected symbols/files.
- User G7 acceptance after delivery.
