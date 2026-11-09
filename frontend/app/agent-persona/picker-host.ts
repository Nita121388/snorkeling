// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Singleton state for the agent emoji picker. Any surface (header icon, inline
 * tab, hover card, right-click menu) calls `openAgentEmojiPicker(blockId,
 * provider, rect)` with the clicked element's bounding rect; a single global
 * `<AgentEmojiPickerHost />` mounted at the app root renders it.
 *
 * Anchoring follows the shared EmojiPicker contract:
 *   - `bottom`: popover renders below, `anchor.top` = rect.bottom + gap
 *   - `top`:    popover renders above (`translateY(-100%)`), `anchor.top` = rect.top - gap
 */

import type { AgentEmojiScope } from "@/app/view/term/agent-emoji-picker";
import { resolveAgentEmojiScope } from "./persona-scope";

export type AgentEmojiPickerState = {
    /** `null` on surfaces that aren't bound to a block (e.g. the aisessions list). */
    blockId: string | null;
    /** Session id of the conversation; enables the session ("仅此会话") scope. */
    sessionId: string | null;
    provider: string;
    anchor: { top: number; left: number };
    placement: "top" | "bottom";
    /** Initial scope chosen from where the picker was opened. */
    initialScope: AgentEmojiScope;
} | null;

const POPOVER_HEIGHT_ESTIMATE = 380;
const GAP = 4;

let pickerSnapshot: AgentEmojiPickerState = null;
const pickerListeners = new Set<() => void>();

export function getAgentEmojiPickerSnapshot(): AgentEmojiPickerState {
    return pickerSnapshot;
}

function emitPicker(): void {
    for (const listener of [...pickerListeners]) {
        listener();
    }
}

export function subscribeAgentEmojiPicker(listener: () => void): () => void {
    pickerListeners.add(listener);
    return () => {
        pickerListeners.delete(listener);
    };
}

export type PickerRect = { top: number; bottom: number; left: number };

export function openAgentEmojiPicker(
    blockId: string | null,
    provider: string,
    rect: PickerRect,
    initialScope: AgentEmojiScope = "session",
    sessionId: string | null = null
): void {
    if (typeof window === "undefined" || provider.trim() === "") {
        return;
    }
    // Normalize blank session ids to null so callers can pass "" or "  "
    // interchangeably without accidentally advertising the session scope.
    const normalizedSessionId = sessionId?.trim() ? sessionId.trim() : null;
    const normalizedBlockId = blockId?.trim() ? blockId.trim() : null;
    // Clicking the same icon again toggles the picker closed.
    if (
        pickerSnapshot != null &&
        pickerSnapshot.blockId === normalizedBlockId &&
        pickerSnapshot.provider === provider &&
        pickerSnapshot.sessionId === normalizedSessionId
    ) {
        closeAgentEmojiPicker();
        return;
    }
    // No session id: a block-bound surface collapses onto the per-block scope so one
    // click can never rewrite every session of the provider. Surfaces without a
    // block (aisessions history rows always carry a session id anyway) stay provider,
    // and an explicit provider choice from a right-click entry is never rewritten.
    const scope: AgentEmojiScope = resolveAgentEmojiScope(initialScope, normalizedSessionId, normalizedBlockId);
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < POPOVER_HEIGHT_ESTIMATE && rect.top > POPOVER_HEIGHT_ESTIMATE;
    pickerSnapshot = {
        blockId: normalizedBlockId,
        sessionId: normalizedSessionId,
        provider,
        initialScope: scope,
        placement: placeAbove ? "top" : "bottom",
        anchor: placeAbove
            ? { top: Math.max(GAP, rect.top - GAP), left: rect.left }
            : { top: rect.bottom + GAP, left: rect.left },
    };
    emitPicker();
}

export function closeAgentEmojiPicker(): void {
    if (pickerSnapshot == null) {
        return;
    }
    pickerSnapshot = null;
    emitPicker();
}
