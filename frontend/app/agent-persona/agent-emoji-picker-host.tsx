// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, useAtomValue } from "jotai";
import { useSyncExternalStore } from "react";
import { WOS } from "@/store/global";
import {
    closeAgentEmojiPicker,
    getAgentEmojiPickerSnapshot,
    subscribeAgentEmojiPicker,
    type AgentEmojiPickerState,
} from "./picker-host";
import { normalizeAgentPersonaKey } from "./persona-store";
import { getSessionEmojiSnapshot, normalizeSessionEmojiKey } from "./session-persona-store";
import { useAgentPersonas } from "./use-agent-personas";
import { AgentEmojiMetaKey, normalizeAgentEmoji } from "@/app/view/term/agent-logo";
import { AgentEmojiPicker } from "@/app/view/term/agent-emoji-picker";
import "./agent-persona.scss";

/**
 * Placeholder atom for surfaces without a blockId. Declared at module scope so the
 * hook order stays stable when the target flips between block and provider-only.
 */
const NoBlockAtom = atom<Block | null>(null);

/**
 * Single global mount point for the agent emoji picker. Rendered once from the
 * app root; renders nothing until a surface opens it.
 */
export function AgentEmojiPickerHost() {
    const state = useSyncExternalStore(
        subscribeAgentEmojiPicker,
        getAgentEmojiPickerSnapshot,
        getAgentEmojiPickerSnapshot
    );
    if (state == null) {
        return null;
    }
    return <AgentEmojiPickerHostInner state={state} />;
}

function AgentEmojiPickerHostInner({ state }: { state: NonNullable<AgentEmojiPickerState> }) {
    const personas = useAgentPersonas();
    const blockAtom = state.blockId != null ? WOS.getWaveObjectAtom<Block>(`block:${state.blockId}`) : null;
    const block = useAtomValue(blockAtom ?? NoBlockAtom);
    const meta = (block?.meta ?? null) as Record<string, unknown> | null;

    // Session id: explicit (list rows pass session.id) or resolved from block meta.
    const sessionId = normalizeSessionEmojiKey(
        state.sessionId ?? (typeof meta?.["agent:sessionid"] === "string" ? (meta["agent:sessionid"] as string) : "")
    );

    // `hasCurrentEmoji` is only used to seed the initial scope; the picker recomputes
    // per-scope as you toggle the radio, so pass the scope-relevant value.
    const personaEmoji = normalizeAgentEmoji(personas[normalizeAgentPersonaKey(state.provider)]);
    const sessionEmoji = normalizeAgentEmoji(getSessionEmojiSnapshot()[sessionId]);
    const hasCurrentEmoji =
        state.initialScope === "session" && sessionId !== "" ? sessionEmoji != null : personaEmoji != null;

    return (
        <>
            <div className="markdown-emoji-backdrop" onMouseDown={closeAgentEmojiPicker} />
            <AgentEmojiPicker
                sessionId={sessionId === "" ? null : sessionId}
                provider={state.provider}
                anchor={state.anchor}
                placement={state.placement}
                initialScope={state.initialScope}
                hasCurrentEmoji={hasCurrentEmoji}
                onClose={closeAgentEmojiPicker}
            />
        </>
    );
}
