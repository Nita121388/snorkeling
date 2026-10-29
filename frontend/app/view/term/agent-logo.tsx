// Copyright 2026, Command_Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { PersonaMap } from "@/app/agent-persona/persona-store";
import { normalizeAgentPersonaKey } from "@/app/agent-persona/persona-store";
import type { SessionEmojiMap } from "@/app/agent-persona/session-persona-store";
import {
    getSessionEmojiSnapshot,
    normalizeSessionEmojiKey,
} from "@/app/agent-persona/session-persona-store";
import { ClaudeLogo, GeminiLogo, OpenAILogo, OpencodeLogo, PiLogo } from "@/app/view/aisessions/controls";
import * as React from "react";
import { normalizeAgentProvider } from "./agent-meta";

/** Block-level (legacy) persona meta key. Session-level personas supersede it. */
export const AgentEmojiMetaKey = "agent:emoji";

export type AgentIconSpec =
    | { kind: "emoji"; emoji: string }
    | { kind: "logo"; icon: React.ReactNode; iconColor?: string };

export type AgentIconOpts = {
    meta?: MetaType | null;
    /** L1 provider-level personas. */
    personas?: PersonaMap | null;
    /** L2 session-level emojis, keyed by sessionId. Defaults to the live store snapshot. */
    sessionEmojis?: SessionEmojiMap | null;
    /**
     * Session id of the conversation being rendered. Falls back to `meta["agent:sessionid"]`
     * so block-based surfaces don't have to resolve it themselves.
     */
    sessionId?: string | null;
};

/**
 * Validate a single emoji grapheme.
 *
 * Rejects multi-grapheme strings ("🦊🦊", "ab", "42"), non-strings, whitespace /
 * control / format-only fragments, degenerate ZWJ fragments ("🦊\u200d"), and
 * anything without a pictographic code point.
 */
export function normalizeAgentEmoji(raw: unknown): string | null {
    if (typeof raw !== "string") {
        return null;
    }
    const value = raw.trim();
    if (value === "") {
        return null;
    }
    let grapheme = value;
    type GraphemeSegmenter = {
        segment(input: string): Iterable<{ segment: string }>;
    };
    type GraphemeSegmenterCtor = new (
        locales?: string | string[],
        options?: { granularity: "grapheme" }
    ) => GraphemeSegmenter;
    const SegmenterCtor = (Intl as unknown as { Segmenter?: GraphemeSegmenterCtor }).Segmenter;
    if (typeof SegmenterCtor === "function") {
        const segmenter = new SegmenterCtor(undefined, { granularity: "grapheme" });
        const parts = Array.from(segmenter.segment(value), (part) => part.segment);
        if (parts.length !== 1) {
            return null;
        }
        grapheme = parts[0];
    } else if (Array.from(value).length !== 1) {
        return null;
    }
    // Whitespace / control / format-only (e.g. a lone ZWJ) is not a persona.
    if (/^[\s\p{Cc}\p{Cf}]+$/u.test(grapheme)) {
        return null;
    }
    // A ZWJ outside a complete sequence ("🦊\u200d") segments as one grapheme but is
    // malformed; the persona picker only needs single face/mark emoji, so drop ZWJ.
    if (grapheme.includes("\u200d")) {
        return null;
    }
    // Require an actual pictograph so a bare letter/number never becomes an agent face.
    if (!/\p{Extended_Pictographic}/u.test(grapheme)) {
        return null;
    }
    return grapheme;
}

export function getAgentLogoByProvider(provider: string): { icon: React.ReactNode; iconColor?: string } | null {
    switch (provider.trim().toLowerCase()) {
        case "codex":
            return { icon: React.createElement(OpenAILogo), iconColor: "#74a7cb" };
        case "claude":
            return { icon: React.createElement(ClaudeLogo) };
        case "gemini":
            return { icon: React.createElement(GeminiLogo), iconColor: "#8e7cc3" };
        case "opencode":
            return { icon: React.createElement(OpencodeLogo), iconColor: "#e0b956" };
        case "pi":
            return { icon: React.createElement(PiLogo), iconColor: "#888888" };
        default:
            return null;
    }
}

/**
 * Resolve the icon for an agent, honoring the two-level persona model:
 *   L2 session emoji (by sessionId) → L2 block meta `agent:emoji` (legacy)
 *   → L1 provider persona → L3 brand logo.
 */
export function getAgentIcon(provider: string, opts?: AgentIconOpts): AgentIconSpec | null {
    const normalizedProvider = normalizeAgentProvider(provider);
    const meta = opts?.meta as Record<string, unknown> | null | undefined;

    const sessionId = normalizeSessionEmojiKey(
        opts?.sessionId ?? (typeof meta?.["agent:sessionid"] === "string" ? (meta["agent:sessionid"] as string) : "")
    );
    if (sessionId !== "") {
        const sessionEmojis = opts?.sessionEmojis ?? getSessionEmojiSnapshot();
        const sessionEmoji = normalizeAgentEmoji(sessionEmojis[sessionId]);
        if (sessionEmoji != null) {
            return { kind: "emoji", emoji: sessionEmoji };
        }
    }

    // Legacy: older workspaces may have written the block-level `agent:emoji` meta.
    const metaEmoji = normalizeAgentEmoji(meta?.[AgentEmojiMetaKey]);
    if (metaEmoji != null) {
        return { kind: "emoji", emoji: metaEmoji };
    }

    const personaKey = normalizeAgentPersonaKey(normalizedProvider);
    const personaEmoji =
        personaKey !== "" && personaKey !== "agent"
            ? normalizeAgentEmoji(opts?.personas?.[personaKey])
            : null;
    if (personaEmoji != null) {
        return { kind: "emoji", emoji: personaEmoji };
    }

    const logo = getAgentLogoByProvider(normalizedProvider);
    if (logo == null) {
        return null;
    }
    return { kind: "logo", icon: logo.icon, iconColor: logo.iconColor };
}
