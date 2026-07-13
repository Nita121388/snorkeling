// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Per-block render snapshots for the TermSessionNoteEditor and TermSessionUserOutlineOverlay,
 * surfaced through "Copy Session Debug Info". This is *diagnostic-only* state: snapshots are
 * captured during render and unmount so the debug blob can report which render-time branch the
 * live component took (e.g. early `return null` at sessionId==="" / userMessages.length===0),
 * and the transient values of outline/note state at that moment.
 *
 * Caveats (mirrored into the debug blob via the *_render section):
 *  - Snapshot reflects render-time state, not necessarily right-click time. Re-render between
 *    mount and the right-click can overwrite it; a stale snapshot is best treated as a hint,
 *    not proof.
 *  - Block ids are derived from the props passed in, not from a global registry; snapshots for
 *    unmounted blocks are removed on cleanup so the map does not grow unbounded.
 *  - Intentionally presence-only / value-only — message text is never captured here.
 */

export type OutlineRenderEarlyReturn = "sessionId-empty" | "no-user-messages-collapsed" | "none" | "not-mounted";

export type OutlineRenderSnapshot = {
    blockId: string;
    capturedAtRender: boolean;
    sessionIdEmpty: boolean;
    sessionIdPreview: string; // first 8 chars only, presence-only
    hasOutline: boolean;
    userMessageCount: number | null;
    userMessagesLength: number;
    loading: boolean;
    error: string | null; // already short status string from setError
    isOpen: boolean;
    earlyReturn: OutlineRenderEarlyReturn;
};

export type NoteRenderSnapshot = {
    blockId: string;
    capturedAtRender: boolean;
    sessionIdEmpty: boolean;
    sessionIdPreview: string; // first 8 chars only
    hasSummary: boolean;
    summaryTitlePreview: string | null; // truncated to 40 chars; presence-only
    isEditing: boolean;
    saveStatus: string;
    error: string | null;
    earlyReturn: "sessionId-empty" | "no-summary" | "none" | "not-mounted";
};

const outlineSnapshots: Map<string, OutlineRenderSnapshot> = new Map();
const noteSnapshots: Map<string, NoteRenderSnapshot> = new Map();

function previewId(id: string): string {
    if (typeof id !== "string" || id === "") {
        return "";
    }
    return id.slice(0, 8);
}

export function setOutlineRenderSnapshot(blockId: string, snapshot: Omit<OutlineRenderSnapshot, "capturedAtRender">): void {
    if (!blockId) {
        return;
    }
    outlineSnapshots.set(blockId, { ...snapshot, capturedAtRender: true });
}

export function clearOutlineRenderSnapshot(blockId: string): void {
    if (!blockId) {
        return;
    }
    outlineSnapshots.delete(blockId);
}

export function getOutlineRenderSnapshot(blockId: string): OutlineRenderSnapshot | null {
    if (!blockId) {
        return null;
    }
    return outlineSnapshots.get(blockId) ?? null;
}

export function setNoteRenderSnapshot(blockId: string, snapshot: Omit<NoteRenderSnapshot, "capturedAtRender">): void {
    if (!blockId) {
        return;
    }
    noteSnapshots.set(blockId, { ...snapshot, capturedAtRender: true });
}

export function clearNoteRenderSnapshot(blockId: string): void {
    if (!blockId) {
        return;
    }
    noteSnapshots.delete(blockId);
}

export function getNoteRenderSnapshot(blockId: string): NoteRenderSnapshot | null {
    if (!blockId) {
        return null;
    }
    return noteSnapshots.get(blockId) ?? null;
}

export const __debugPreviewId = previewId;
