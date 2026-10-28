// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { useSyncExternalStore } from "react";
import { WOS } from "@/store/global";
import {
    closeAgentEmojiPicker,
    getAgentEmojiPickerSnapshot,
    subscribeAgentEmojiPicker,
    type AgentEmojiPickerState,
} from "./picker-host";
import { normalizeAgentPersonaKey } from "./persona-store";
import { useAgentPersonas } from "./use-agent-personas";
import { AgentEmojiMetaKey, normalizeAgentEmoji } from "@/app/view/term/agent-logo";
import { AgentEmojiPicker } from "@/app/view/term/agent-emoji-picker";

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
    const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${state.blockId}`);
    const block = useAtomValue(blockAtom);
    const metaEmoji = normalizeAgentEmoji(
        (block?.meta as Record<string, unknown> | null | undefined)?.[AgentEmojiMetaKey]
    );
    const personaEmoji = normalizeAgentEmoji(personas[normalizeAgentPersonaKey(state.provider)]);

    // Enable "remove" when the active scope actually holds an emoji.
    const hasCurrentEmoji =
        state.initialScope === "block" ? metaEmoji != null : personaEmoji != null;

    return (
        <>
            <div className="markdown-emoji-backdrop" onMouseDown={closeAgentEmojiPicker} />
            <AgentEmojiPicker
                blockId={state.blockId}
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
