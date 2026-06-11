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
const PreviewSharedDraftDebugStorageKey = "snorkelingPreviewDraftDebug";
const PreviewSharedDraftStoragePrefix = "snorkeling:preview-shared-draft:";
const PreviewSharedDraftStorageVersion = 1;

type PreviewSharedDraftStoragePayload = {
    version: typeof PreviewSharedDraftStorageVersion;
    fileKey: string;
    kind: "draft" | "clear";
    draftContent: string | null;
    savedContent: string | null;
    updatedAt: number;
    sequence: number;
    sourceId: string;
    reason: string;
};

type PreviewSharedDraftPayloadVersion = Pick<PreviewSharedDraftStoragePayload, "updatedAt" | "sequence" | "sourceId">;

const previewSharedDraftAppliedVersions = new Map<string, PreviewSharedDraftPayloadVersion>();
const previewSharedDraftClientId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}:${Math.random()}`;
let previewSharedDraftSequence = 0;
let previewSharedDraftStorageListenerInstalled = false;

type PreviewDraftContentSummary = {
    type: "null" | "undefined" | "text";
    length?: number;
    hash?: string;
};

type PreviewSharedDraftDebugSnapshot = Array<{
    key: string;
    editorRefs: number;
    revision: number;
    draftContent: PreviewDraftContentSummary;
    savedContent: PreviewDraftContentSummary;
}>;

function isPreviewSharedDraftDebugEnabled(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        return window.localStorage?.getItem(PreviewSharedDraftDebugStorageKey) === "1";
    } catch (_e) {
        return false;
    }
}

function hashPreviewDraftContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i += 1) {
        hash = (hash << 5) - hash + content.charCodeAt(i);
        hash |= 0;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function summarizePreviewDraftContent(content: string | null | undefined): PreviewDraftContentSummary {
    if (content === null) {
        return { type: "null" };
    }
    if (content === undefined) {
        return { type: "undefined" };
    }
    return {
        type: "text",
        length: content.length,
        hash: hashPreviewDraftContent(content),
    };
}

export function summarizePreviewSharedDraftRecord(
    record: PreviewSharedDraftRecord | null
): Record<string, unknown> | null {
    if (record == null) {
        return null;
    }
    const state = globalStore.get(record.stateAtom);
    return {
        editorRefs: record.editorRefs.size,
        revision: state.revision,
        draftContent: summarizePreviewDraftContent(state.draftContent),
        savedContent: summarizePreviewDraftContent(state.savedContent),
    };
}

export function getPreviewSharedDraftDebugSnapshot(): PreviewSharedDraftDebugSnapshot {
    return Array.from(previewSharedDraftRecords.entries()).map(([key, record]) => {
        const state = globalStore.get(record.stateAtom);
        return {
            key,
            editorRefs: record.editorRefs.size,
            revision: state.revision,
            draftContent: summarizePreviewDraftContent(state.draftContent),
            savedContent: summarizePreviewDraftContent(state.savedContent),
        };
    });
}

function installPreviewSharedDraftDebugSnapshot(): void {
    if (typeof window === "undefined") {
        return;
    }
    const debugWindow = window as Window & {
        snorkelingPreviewDraftDebugSnapshot?: () => PreviewSharedDraftDebugSnapshot;
    };
    debugWindow.snorkelingPreviewDraftDebugSnapshot = getPreviewSharedDraftDebugSnapshot;
}

export function previewSharedDraftDebugLog(event: string, details: Record<string, unknown> = {}): void {
    if (!isPreviewSharedDraftDebugEnabled()) {
        return;
    }
    installPreviewSharedDraftDebugSnapshot();
    console.info("[preview-shared-draft]", event, {
        ...details,
        snapshot: getPreviewSharedDraftDebugSnapshot(),
    });
}

function encodePreviewSharedDraftStorageKey(fileKey: string): string {
    return `${PreviewSharedDraftStoragePrefix}${encodeURIComponent(fileKey)}`;
}

function decodePreviewSharedDraftStorageKey(storageKey: string): string | null {
    if (!storageKey.startsWith(PreviewSharedDraftStoragePrefix)) {
        return null;
    }
    try {
        return decodeURIComponent(storageKey.slice(PreviewSharedDraftStoragePrefix.length));
    } catch (_e) {
        return null;
    }
}

function canUsePreviewSharedDraftStorage(): boolean {
    return typeof window !== "undefined" && window.localStorage != null;
}

function isPreviewSharedDraftStoragePayload(value: unknown): value is PreviewSharedDraftStoragePayload {
    if (value == null || typeof value !== "object") {
        return false;
    }
    const payload = value as Partial<PreviewSharedDraftStoragePayload>;
    return (
        payload.version === PreviewSharedDraftStorageVersion &&
        typeof payload.fileKey === "string" &&
        (payload.kind === "draft" || payload.kind === "clear") &&
        (payload.draftContent == null || typeof payload.draftContent === "string") &&
        (payload.savedContent == null || typeof payload.savedContent === "string") &&
        typeof payload.updatedAt === "number" &&
        Number.isFinite(payload.updatedAt) &&
        typeof payload.sequence === "number" &&
        Number.isFinite(payload.sequence) &&
        typeof payload.sourceId === "string" &&
        typeof payload.reason === "string"
    );
}

function parsePreviewSharedDraftStoragePayload(rawValue: string | null): PreviewSharedDraftStoragePayload | null {
    if (rawValue == null) {
        return null;
    }
    try {
        const payload = JSON.parse(rawValue);
        return isPreviewSharedDraftStoragePayload(payload) ? payload : null;
    } catch (_e) {
        return null;
    }
}

function readPreviewSharedDraftStoragePayload(fileKey: string): PreviewSharedDraftStoragePayload | null {
    if (!canUsePreviewSharedDraftStorage()) {
        return null;
    }
    try {
        return parsePreviewSharedDraftStoragePayload(
            window.localStorage.getItem(encodePreviewSharedDraftStorageKey(fileKey))
        );
    } catch (e) {
        previewSharedDraftDebugLog("storage:read-error", { fileKey, error: `${e}` });
        return null;
    }
}

function isPreviewSharedDraftPayloadNewer(
    fileKey: string,
    payload: PreviewSharedDraftStoragePayload,
    current: PreviewSharedDraftPayloadVersion | null = previewSharedDraftAppliedVersions.get(fileKey) ?? null
): boolean {
    if (current == null) {
        return true;
    }
    if (payload.updatedAt !== current.updatedAt) {
        return payload.updatedAt > current.updatedAt;
    }
    if (payload.sequence !== current.sequence) {
        return payload.sequence > current.sequence;
    }
    return payload.sourceId !== current.sourceId;
}

function markPreviewSharedDraftPayloadApplied(fileKey: string, payload: PreviewSharedDraftStoragePayload): void {
    previewSharedDraftAppliedVersions.set(fileKey, {
        updatedAt: payload.updatedAt,
        sequence: payload.sequence,
        sourceId: payload.sourceId,
    });
}

function applyPreviewSharedDraftStoragePayload(
    payload: PreviewSharedDraftStoragePayload,
    reason: string,
    set?: Setter
): boolean {
    if (isBlank(payload.fileKey)) {
        return false;
    }
    const currentVersion = previewSharedDraftAppliedVersions.get(payload.fileKey) ?? null;
    if (!isPreviewSharedDraftPayloadNewer(payload.fileKey, payload, currentVersion)) {
        previewSharedDraftDebugLog("storage:apply-skip", {
            fileKey: payload.fileKey,
            reason: "stale-payload",
            payload: {
                kind: payload.kind,
                updatedAt: payload.updatedAt,
                sequence: payload.sequence,
                sourceId: payload.sourceId,
                draftContent: summarizePreviewDraftContent(payload.draftContent),
                savedContent: summarizePreviewDraftContent(payload.savedContent),
            },
            currentVersion,
        });
        return false;
    }

    const record = getOrCreatePreviewSharedDraftRecord(payload.fileKey, set);
    if (record == null) {
        return false;
    }
    let didApply = false;
    const nextDraftContent = payload.kind === "clear" ? null : payload.draftContent;
    globalStore.set(record.stateAtom, (prev) => {
        if (prev.draftContent === nextDraftContent && prev.savedContent === payload.savedContent) {
            return prev;
        }
        didApply = true;
        previewSharedDraftDebugLog("storage:apply", {
            fileKey: payload.fileKey,
            reason,
            kind: payload.kind,
            sourceId: payload.sourceId,
            updatedAt: payload.updatedAt,
            sequence: payload.sequence,
            previous: {
                revision: prev.revision,
                draftContent: summarizePreviewDraftContent(prev.draftContent),
                savedContent: summarizePreviewDraftContent(prev.savedContent),
            },
            next: {
                revision: prev.revision + 1,
                draftContent: summarizePreviewDraftContent(nextDraftContent),
                savedContent: summarizePreviewDraftContent(payload.savedContent),
            },
        });
        return {
            ...prev,
            draftContent: nextDraftContent,
            savedContent: payload.savedContent,
            revision: prev.revision + 1,
        };
    });
    markPreviewSharedDraftPayloadApplied(payload.fileKey, payload);
    if (payload.kind === "clear") {
        cleanupPreviewSharedDraftRecordIfUnused(payload.fileKey);
    }
    return didApply;
}

function handlePreviewSharedDraftStorageEvent(event: StorageEvent): void {
    if (event.storageArea !== window.localStorage) {
        return;
    }
    if (event.key == null || decodePreviewSharedDraftStorageKey(event.key) == null) {
        return;
    }
    const payload = parsePreviewSharedDraftStoragePayload(event.newValue);
    if (payload == null) {
        return;
    }
    if (payload.sourceId === previewSharedDraftClientId) {
        return;
    }
    applyPreviewSharedDraftStoragePayload(payload, "storage-event");
}

function ensurePreviewSharedDraftStorageListener(): void {
    if (!canUsePreviewSharedDraftStorage() || previewSharedDraftStorageListenerInstalled) {
        return;
    }
    window.addEventListener("storage", handlePreviewSharedDraftStorageEvent);
    previewSharedDraftStorageListenerInstalled = true;
}

export function restorePreviewSharedDraftFromStorage(fileKey: string | null, set?: Setter): void {
    if (isBlank(fileKey)) {
        return;
    }
    ensurePreviewSharedDraftStorageListener();
    const payload = readPreviewSharedDraftStoragePayload(fileKey);
    if (payload == null) {
        previewSharedDraftDebugLog("storage:restore-miss", { fileKey });
        return;
    }
    applyPreviewSharedDraftStoragePayload(payload, "restore", set);
}

export function publishPreviewSharedDraftToStorage(
    fileKey: string | null,
    state: Pick<PreviewSharedDraftState, "draftContent" | "savedContent">,
    reason: string
): void {
    if (isBlank(fileKey) || !canUsePreviewSharedDraftStorage()) {
        return;
    }
    ensurePreviewSharedDraftStorageListener();
    const payload: PreviewSharedDraftStoragePayload = {
        version: PreviewSharedDraftStorageVersion,
        fileKey,
        kind: state.draftContent == null ? "clear" : "draft",
        draftContent: state.draftContent,
        savedContent: state.savedContent,
        updatedAt: Date.now(),
        sequence: ++previewSharedDraftSequence,
        sourceId: previewSharedDraftClientId,
        reason,
    };
    try {
        const storageKey = encodePreviewSharedDraftStorageKey(fileKey);
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
        if (payload.kind === "clear") {
            window.localStorage.removeItem(storageKey);
        }
        markPreviewSharedDraftPayloadApplied(fileKey, payload);
        previewSharedDraftDebugLog("storage:publish", {
            fileKey,
            reason,
            kind: payload.kind,
            updatedAt: payload.updatedAt,
            sequence: payload.sequence,
            draftContent: summarizePreviewDraftContent(payload.draftContent),
            savedContent: summarizePreviewDraftContent(payload.savedContent),
            persisted: payload.kind !== "clear",
        });
    } catch (e) {
        previewSharedDraftDebugLog("storage:publish-error", {
            fileKey,
            reason,
            error: `${e}`,
            draftContent: summarizePreviewDraftContent(state.draftContent),
            savedContent: summarizePreviewDraftContent(state.savedContent),
        });
    }
}

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
        previewSharedDraftDebugLog("make-key:blank-path", { connection, filePath });
        return null;
    }
    const normalizedConnection = isBlank(connection) ? "local" : connection!.trim();
    const fileKey = formatRemoteUri(normalizedPath, normalizedConnection);
    previewSharedDraftDebugLog("make-key", {
        connection,
        filePath,
        normalizedConnection,
        normalizedPath,
        fileKey,
    });
    return fileKey;
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
        previewSharedDraftDebugLog("record:reuse", {
            fileKey,
            record: summarizePreviewSharedDraftRecord(existingRecord),
        });
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
    previewSharedDraftDebugLog("record:create", {
        fileKey,
        record: summarizePreviewSharedDraftRecord(newRecord),
    });
    return newRecord;
}

export function cleanupPreviewSharedDraftRecordIfUnused(fileKey: string | null): void {
    const record = getPreviewSharedDraftRecord(fileKey);
    if (record == null || record.editorRefs.size > 0) {
        previewSharedDraftDebugLog("record:cleanup-skip", {
            fileKey,
            reason: record == null ? "missing-record" : "has-editor-refs",
            record: summarizePreviewSharedDraftRecord(record),
        });
        return;
    }
    const state = globalStore.get(record.stateAtom);
    if (state.draftContent != null) {
        previewSharedDraftDebugLog("record:cleanup-skip", {
            fileKey,
            reason: "has-unsaved-draft",
            record: summarizePreviewSharedDraftRecord(record),
        });
        return;
    }
    previewSharedDraftRecords.delete(fileKey!);
    bumpPreviewSharedDraftRecordsVersion();
    previewSharedDraftDebugLog("record:cleanup-delete", {
        fileKey,
        deletedState: {
            revision: state.revision,
            draftContent: summarizePreviewDraftContent(state.draftContent),
            savedContent: summarizePreviewDraftContent(state.savedContent),
        },
    });
}

export function registerPreviewSharedDraftEditor(fileKey: string | null, editorRef: string): () => void {
    const record = getOrCreatePreviewSharedDraftRecord(fileKey);
    if (record == null) {
        previewSharedDraftDebugLog("editor:register-skip", { fileKey, editorRef });
        return () => {};
    }
    record.editorRefs.add(editorRef);
    restorePreviewSharedDraftFromStorage(fileKey);
    previewSharedDraftDebugLog("editor:register", {
        fileKey,
        editorRef,
        record: summarizePreviewSharedDraftRecord(record),
    });
    return () => {
        const currentRecord = getPreviewSharedDraftRecord(fileKey);
        if (currentRecord == null) {
            previewSharedDraftDebugLog("editor:unregister-skip", { fileKey, editorRef });
            return;
        }
        currentRecord.editorRefs.delete(editorRef);
        previewSharedDraftDebugLog("editor:unregister", {
            fileKey,
            editorRef,
            record: summarizePreviewSharedDraftRecord(currentRecord),
        });
        cleanupPreviewSharedDraftRecordIfUnused(fileKey);
    };
}

export function discardPreviewSharedDraftIfUnshared(fileKey: string | null): void {
    const record = getPreviewSharedDraftRecord(fileKey);
    if (record == null || record.editorRefs.size > 1) {
        previewSharedDraftDebugLog("draft:discard-skip", {
            fileKey,
            reason: record == null ? "missing-record" : "shared-by-multiple-editors",
            record: summarizePreviewSharedDraftRecord(record),
        });
        return;
    }
    globalStore.set(record.stateAtom, (prev) => {
        if (prev.draftContent == null) {
            previewSharedDraftDebugLog("draft:discard-skip", {
                fileKey,
                reason: "no-draft",
                record: summarizePreviewSharedDraftRecord(record),
            });
            return prev;
        }
        previewSharedDraftDebugLog("draft:discard", {
            fileKey,
            previousDraftContent: summarizePreviewDraftContent(prev.draftContent),
            savedContent: summarizePreviewDraftContent(prev.savedContent),
            nextRevision: prev.revision + 1,
        });
        publishPreviewSharedDraftToStorage(
            fileKey,
            {
                draftContent: null,
                savedContent: prev.savedContent,
            },
            "discard"
        );
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
        previewSharedDraftDebugLog("record:migrate-skip", {
            fromKey,
            toKey,
            reason: fromKey === toKey ? "same-key" : "blank-key",
        });
        return;
    }
    const fromRecord = getPreviewSharedDraftRecord(fromKey);
    if (fromRecord == null) {
        previewSharedDraftDebugLog("record:migrate-skip", {
            fromKey,
            toKey,
            reason: "missing-source",
        });
        return;
    }
    const fromState = globalStore.get(fromRecord.stateAtom);
    if (fromState.draftContent == null && fromState.savedContent == null) {
        previewSharedDraftDebugLog("record:migrate-skip", {
            fromKey,
            toKey,
            reason: "empty-source",
            source: summarizePreviewSharedDraftRecord(fromRecord),
        });
        cleanupPreviewSharedDraftRecordIfUnused(fromKey);
        return;
    }
    const toRecord = getOrCreatePreviewSharedDraftRecord(toKey);
    if (toRecord == null) {
        previewSharedDraftDebugLog("record:migrate-skip", {
            fromKey,
            toKey,
            reason: "missing-destination",
        });
        return;
    }
    globalStore.set(toRecord.stateAtom, (prev) => {
        const nextDraftContent = prev.draftContent ?? fromState.draftContent;
        const nextSavedContent = prev.savedContent ?? fromState.savedContent;
        if (prev.draftContent === nextDraftContent && prev.savedContent === nextSavedContent) {
            previewSharedDraftDebugLog("record:migrate-noop", {
                fromKey,
                toKey,
                source: {
                    revision: fromState.revision,
                    draftContent: summarizePreviewDraftContent(fromState.draftContent),
                    savedContent: summarizePreviewDraftContent(fromState.savedContent),
                },
                destination: summarizePreviewSharedDraftRecord(toRecord),
            });
            return prev;
        }
        previewSharedDraftDebugLog("record:migrate-apply", {
            fromKey,
            toKey,
            source: {
                revision: fromState.revision,
                draftContent: summarizePreviewDraftContent(fromState.draftContent),
                savedContent: summarizePreviewDraftContent(fromState.savedContent),
            },
            previousDestination: {
                revision: prev.revision,
                draftContent: summarizePreviewDraftContent(prev.draftContent),
                savedContent: summarizePreviewDraftContent(prev.savedContent),
            },
            nextDestination: {
                revision: prev.revision + 1,
                draftContent: summarizePreviewDraftContent(nextDraftContent),
                savedContent: summarizePreviewDraftContent(nextSavedContent),
            },
        });
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
        previewSharedDraftDebugLog("record:migrate-clear-source", {
            fromKey,
            toKey,
            source: summarizePreviewSharedDraftRecord(fromRecord),
        });
        cleanupPreviewSharedDraftRecordIfUnused(fromKey);
    }
}

export function clearPreviewSharedDraftRecordsForTest(): void {
    previewSharedDraftRecords.clear();
    previewSharedDraftAppliedVersions.clear();
    bumpPreviewSharedDraftRecordsVersion();
}
