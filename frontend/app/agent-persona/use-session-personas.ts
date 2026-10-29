// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { useSyncExternalStore } from "react";
import { getSessionEmojiSnapshot, subscribeSessionEmojis, type SessionEmojiMap } from "./session-persona-store";

/**
 * Jotai mirror of the session-level persona store, for non-component contexts
 * (term-model.viewIcon, aisessions viewIcon atom). Mirrored like agentPersonaAtom.
 */
export const sessionEmojiAtom = atom<SessionEmojiMap>(getSessionEmojiSnapshot());

subscribeSessionEmojis(() => {
    globalStore.set(sessionEmojiAtom, getSessionEmojiSnapshot());
});

/** Subscribe a component to the session emoji map (re-renders on change). */
export function useSessionEmojis(): SessionEmojiMap {
    return useSyncExternalStore(
        subscribeSessionEmojis,
        getSessionEmojiSnapshot,
        getSessionEmojiSnapshot
    );
}
