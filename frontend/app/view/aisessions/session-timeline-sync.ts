// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type TimelineCursor = SessionMessageCursor | undefined;

export type SessionTimelineMergeResult = {
    messages: Message[];
    cursor: TimelineCursor;
    resetRequired: boolean;
};

function cursorOffset(cursor: TimelineCursor): number {
    return cursor?.byteOffset ?? 0;
}

function cursorSequence(cursor: TimelineCursor): number {
    return cursor?.lastSeq ?? 0;
}

export function mergeSessionTimeline(
    currentMessages: Message[],
    currentCursor: TimelineCursor,
    deltaMessages: Message[],
    nextCursor: TimelineCursor,
): SessionTimelineMergeResult {
    const hasCursorRewind =
        nextCursor != null &&
        currentCursor != null &&
        (cursorOffset(nextCursor) < cursorOffset(currentCursor) ||
            cursorSequence(nextCursor) < cursorSequence(currentCursor));
    if (hasCursorRewind) {
        return { messages: deltaMessages, cursor: nextCursor, resetRequired: true };
    }

    const existingSeqs = new Set(currentMessages.map((message) => message.seq));
    const messages = [
        ...currentMessages,
        ...deltaMessages.filter((message) => !existingSeqs.has(message.seq)),
    ];
    return { messages, cursor: nextCursor ?? currentCursor, resetRequired: false };
}
