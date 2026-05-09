// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const AiSessionNoteUpdatedEvent = "aisession-note-updated";

type AISessionNoteUpdatedDetail = {
    summary: SessionSummary;
};

function dispatchAISessionNoteUpdated(summary: SessionSummary): void {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(
        new CustomEvent<AISessionNoteUpdatedDetail>(AiSessionNoteUpdatedEvent, { detail: { summary } })
    );
}

function isAISessionNoteUpdatedEvent(event: Event): event is CustomEvent<AISessionNoteUpdatedDetail> {
    return event instanceof CustomEvent && event.detail?.summary != null;
}

export { AiSessionNoteUpdatedEvent, dispatchAISessionNoteUpdated, isAISessionNoteUpdatedEvent };
export type { AISessionNoteUpdatedDetail };
