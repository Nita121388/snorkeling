// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it } from "vitest";
import {
    clearPreviewSharedDraftRecordsForTest,
    getOrCreatePreviewSharedDraftRecord,
    getPreviewSharedDraftRecord,
    makePreviewDraftKey,
    migratePreviewSharedDraftRecord,
    normalizePreviewDraftPath,
    registerPreviewSharedDraftEditor,
} from "./preview-shared-draft";

describe("preview shared draft", () => {
    beforeEach(() => {
        clearPreviewSharedDraftRecordsForTest();
    });

    it("normalizes draft paths and keys", () => {
        expect(normalizePreviewDraftPath(" C:\\Users\\nita\\notes\\today.md ")).toBe("c:/Users/nita/notes/today.md");
        expect(normalizePreviewDraftPath("/Users/nita//notes/today.md/")).toBe("/Users/nita/notes/today.md");
        expect(makePreviewDraftKey(null, "/Users/nita/notes/today.md")).toBe("wsh://local//Users/nita/notes/today.md");
        expect(makePreviewDraftKey("conn", "/srv//notes/today.md")).toBe("wsh://conn//srv/notes/today.md");
    });

    it("removes unused empty draft records", () => {
        const key = makePreviewDraftKey("local", "/tmp/note.md");
        const unregister = registerPreviewSharedDraftEditor(key, "editor-1");

        expect(getPreviewSharedDraftRecord(key)).not.toBeNull();
        unregister();
        expect(getPreviewSharedDraftRecord(key)).toBeNull();
    });

    it("keeps unmounted unsaved drafts available for another tab", () => {
        const key = makePreviewDraftKey("local", "/tmp/note.md");
        const unregister = registerPreviewSharedDraftEditor(key, "editor-1");
        const record = getOrCreatePreviewSharedDraftRecord(key)!;

        globalStore.set(record.stateAtom, (prev) => ({
            ...prev,
            draftContent: "unsaved",
            revision: prev.revision + 1,
        }));
        unregister();

        const preservedRecord = getPreviewSharedDraftRecord(key);
        expect(preservedRecord).not.toBeNull();
        expect(globalStore.get(preservedRecord!.stateAtom).draftContent).toBe("unsaved");
    });

    it("migrates an unsaved draft from an initial key to a canonical key", () => {
        const initialKey = makePreviewDraftKey("local", "~/notes/today.md");
        const canonicalKey = makePreviewDraftKey("local", "/Users/nita/notes/today.md");
        const initialRecord = getOrCreatePreviewSharedDraftRecord(initialKey)!;

        globalStore.set(initialRecord.stateAtom, {
            draftContent: "draft from initial key",
            savedContent: "saved from initial key",
            revision: 1,
        });

        migratePreviewSharedDraftRecord(initialKey, canonicalKey);

        const canonicalRecord = getPreviewSharedDraftRecord(canonicalKey);
        expect(canonicalRecord).not.toBeNull();
        expect(globalStore.get(canonicalRecord!.stateAtom)).toMatchObject({
            draftContent: "draft from initial key",
            savedContent: "saved from initial key",
        });
        expect(getPreviewSharedDraftRecord(initialKey)).toBeNull();
    });

    it("does not overwrite an existing destination draft during migration", () => {
        const initialKey = makePreviewDraftKey("local", "~/notes/today.md");
        const canonicalKey = makePreviewDraftKey("local", "/Users/nita/notes/today.md");
        const initialRecord = getOrCreatePreviewSharedDraftRecord(initialKey)!;
        const canonicalRecord = getOrCreatePreviewSharedDraftRecord(canonicalKey)!;

        globalStore.set(initialRecord.stateAtom, {
            draftContent: "source draft",
            savedContent: "source saved",
            revision: 1,
        });
        globalStore.set(canonicalRecord.stateAtom, {
            draftContent: "destination draft",
            savedContent: "destination saved",
            revision: 1,
        });

        migratePreviewSharedDraftRecord(initialKey, canonicalKey);

        expect(globalStore.get(canonicalRecord.stateAtom)).toMatchObject({
            draftContent: "destination draft",
            savedContent: "destination saved",
        });
    });
});
