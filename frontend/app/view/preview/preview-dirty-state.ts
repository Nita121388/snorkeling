// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Per-block dirty atom for inline-tab labels.  Derived from the existing
 * PreviewSharedDraftRecord: when `draftContent` is non-null the block has
 * unsaved edits.  Works for every tab in a group regardless of ViewModel
 * lifecycle (ViewModels are disposed/recreated on tab switch, but the
 * draft record lives in the Map-based store).
 */
import { isBlank } from "@/util/util";
import { makeORef, getWaveObjectAtom } from "@/app/store/wos";
import { atom, type Atom } from "jotai";
import {
    makePreviewDraftKey,
    getPreviewSharedDraftRecord,
    getPreviewSharedDraftRecordVersionAtom,
} from "./preview-shared-draft";

const blockDirtyAtoms = new Map<string, Atom<boolean>>();

export function getBlockDirtyAtom(blockId: string): Atom<boolean> {
    let a = blockDirtyAtoms.get(blockId);
    if (a == null) {
        a = atom((get) => {
            const block = get(getWaveObjectAtom<Block>(makeORef("block", blockId)));
            if (block?.meta?.view !== "preview") {
                return false;
            }
            const conn = block.meta?.connection as string | undefined;
            const file = block.meta?.file as string | undefined;
            if (isBlank(file)) {
                return false;
            }
            const fileKey = makePreviewDraftKey(conn, file);
            if (fileKey == null) {
                return false;
            }
            get(getPreviewSharedDraftRecordVersionAtom(fileKey));
            const record = getPreviewSharedDraftRecord(fileKey);
            if (record == null) {
                return false;
            }
            return get(record.stateAtom).draftContent != null;
        });
        blockDirtyAtoms.set(blockId, a);
    }
    return a;
}
