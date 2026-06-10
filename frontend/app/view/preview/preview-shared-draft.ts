// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { isBlank } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { atom, type PrimitiveAtom, type Setter } from "jotai";

export type PreviewSharedDraftState = {
    draftContent: string | null;
    savedContent: string | null;
    revision: number;
};

export type PreviewSharedDraftRecord = {
    stateAtom: PrimitiveAtom<PreviewSharedDraftState>;
    editorRefs: Set<string>;
};

export const previewSharedDraftRecordsVersion = atom(0);

const previewSharedDraftRecords = new Map<string, PreviewSharedDraftRecord>();

export function normalizePreviewDraftPath(filePath: string | null | undefined): string {
    const trimmed = filePath?.trim() ?? "";
    if (trimmed === "") {
        return "";
    }
    let normalized = trimmed.replace(/\\/g, "/");
    normalized = normalized.replace(/\/+/g, "/");
    if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.replace(/\/+$/, "");
    }
    if (/^[a-zA-Z]:\//.test(normalized)) {
        normalized = normalized[0].toLowerCase() + normalized.slice(1);
    }
    return normalized;
}

export function makePreviewDraftKey(
    connection: string | null | undefined,
    filePath: string | null | undefined
): string | null {
    const normalizedPath = normalizePreviewDraftPath(filePath);
    if (isBlank(normalizedPath)) {
        return null;
    }
    const normalizedConnection = isBlank(connection) ? "local" : connection!.trim();
    return formatRemoteUri(normalizedPath, normalizedConnection);
}

function bumpPreviewSharedDraftRecordsVersion(set?: Setter): void {
    if (set != null) {
        set(previewSharedDraftRecordsVersion, (version) => version + 1);
        return;
    }
    globalStore.set(previewSharedDraftRecordsVersion, (version) => version + 1);
}

export function getPreviewSharedDraftRecord(fileKey: string | null): PreviewSharedDraftRecord | null {
    if (isBlank(fileKey)) {
        return null;
    }
    return previewSharedDraftRecords.get(fileKey) ?? null;
}

export function getOrCreatePreviewSharedDraftRecord(
    fileKey: string | null,
    set?: Setter
): PreviewSharedDraftRecord | null {
    if (isBlank(fileKey)) {
        return null;
    }
    const existingRecord = previewSharedDraftRecords.get(fileKey);
    if (existingRecord != null) {
        return existingRecord;
    }
    const newRecord: PreviewSharedDraftRecord = {
        stateAtom: atom<PreviewSharedDraftState>({
            draftContent: null,
            savedContent: null,
            revision: 0,
        }) as PrimitiveAtom<PreviewSharedDraftState>,
        editorRefs: new Set<string>(),
    };
    previewSharedDraftRecords.set(fileKey, newRecord);
    bumpPreviewSharedDraftRecordsVersion(set);
    return newRecord;
}

export function cleanupPreviewSharedDraftRecordIfUnused(fileKey: string | null): void {
    const record = getPreviewSharedDraftRecord(fileKey);
    if (record == null || record.editorRefs.size > 0) {
        return;
    }
    const state = globalStore.get(record.stateAtom);
    if (state.draftContent != null) {
        return;
    }
    previewSharedDraftRecords.delete(fileKey!);
    bumpPreviewSharedDraftRecordsVersion();
}

export function registerPreviewSharedDraftEditor(fileKey: string | null, editorRef: string): () => void {
    const record = getOrCreatePreviewSharedDraftRecord(fileKey);
    if (record == null) {
        return () => {};
    }
    record.editorRefs.add(editorRef);
    return () => {
        const currentRecord = getPreviewSharedDraftRecord(fileKey);
        if (currentRecord == null) {
            return;
        }
        currentRecord.editorRefs.delete(editorRef);
        cleanupPreviewSharedDraftRecordIfUnused(fileKey);
    };
}

export function discardPreviewSharedDraftIfUnshared(fileKey: string | null): void {
    const record = getPreviewSharedDraftRecord(fileKey);
    if (record == null || record.editorRefs.size > 1) {
        return;
    }
    globalStore.set(record.stateAtom, (prev) => {
        if (prev.draftContent == null) {
            return prev;
        }
        return {
            ...prev,
            draftContent: null,
            revision: prev.revision + 1,
        };
    });
    cleanupPreviewSharedDraftRecordIfUnused(fileKey);
}

export function migratePreviewSharedDraftRecord(fromKey: string | null, toKey: string | null): void {
    if (isBlank(fromKey) || isBlank(toKey) || fromKey === toKey) {
        return;
    }
    const fromRecord = getPreviewSharedDraftRecord(fromKey);
    if (fromRecord == null) {
        return;
    }
    const fromState = globalStore.get(fromRecord.stateAtom);
    if (fromState.draftContent == null && fromState.savedContent == null) {
        cleanupPreviewSharedDraftRecordIfUnused(fromKey);
        return;
    }
    const toRecord = getOrCreatePreviewSharedDraftRecord(toKey);
    if (toRecord == null) {
        return;
    }
    globalStore.set(toRecord.stateAtom, (prev) => {
        const nextDraftContent = prev.draftContent ?? fromState.draftContent;
        const nextSavedContent = prev.savedContent ?? fromState.savedContent;
        if (prev.draftContent === nextDraftContent && prev.savedContent === nextSavedContent) {
            return prev;
        }
        return {
            ...prev,
            draftContent: nextDraftContent,
            savedContent: nextSavedContent,
            revision: prev.revision + 1,
        };
    });

    if (fromRecord.editorRefs.size === 0) {
        globalStore.set(fromRecord.stateAtom, (prev) => ({
            ...prev,
            draftContent: null,
            savedContent: null,
            revision: prev.revision + 1,
        }));
        cleanupPreviewSharedDraftRecordIfUnused(fromKey);
    }
}

export function clearPreviewSharedDraftRecordsForTest(): void {
    previewSharedDraftRecords.clear();
    bumpPreviewSharedDraftRecordsVersion();
}
