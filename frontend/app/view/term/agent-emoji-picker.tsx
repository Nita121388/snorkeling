// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setAgentPersona } from "@/app/agent-persona/persona-store";
import {
    getSessionEmojiSnapshot,
    normalizeSessionEmojiKey,
    setSessionEmoji,
} from "@/app/agent-persona/session-persona-store";
import { formatAgentProvider } from "@/app/agent-status/agent-status-derive";
import { EmojiPicker } from "@/app/element/block-editor/components/emoji-picker";
import {
    getLoadedEmojiCatalog,
    loadEmojiCatalog,
    recordRecentEmoji,
    type EmojiCatalog,
} from "@/app/element/markdown-transform/emoji";
import { cn } from "@/util/util";
import * as React from "react";

export type AgentEmojiScope = "session" | "provider";

export type AgentEmojiPickerProps = {
    /**
     * Session id of the conversation being styled. Session scope ("仅此会话") writes
     * here; without it only the provider scope is offered.
     */
    sessionId: string | null;
    provider: string;
    anchor: { top: number; left: number };
    placement: "top" | "bottom";
    initialScope: AgentEmojiScope;
    /** Whether the current scope already has an emoji (enables "remove"). */
    hasCurrentEmoji: boolean;
    onClose: () => void;
};

function ScopeOption({
    checked,
    label,
    hint,
    onChange,
}: {
    checked: boolean;
    label: string;
    hint?: string;
    onChange: () => void;
}) {
    return (
        <label className={cn("agent-emoji-scope-option", checked && "is-checked")} title={hint}>
            <input type="radio" checked={checked} onChange={onChange} />
            <span>{label}</span>
        </label>
    );
}

/**
 * Agent persona emoji picker. Reuses the shared `EmojiPicker` (search / groups /
 * recents) in document mode and adds a scope radio so the user can pick between
 * THIS conversation (session-level, shows everywhere the session appears incl. the
 * aisessions history list) or every session of this provider (provider-level).
 */
export function AgentEmojiPicker({
    sessionId,
    provider,
    anchor,
    placement,
    initialScope,
    hasCurrentEmoji,
    onClose,
}: AgentEmojiPickerProps) {
    const [catalog, setCatalog] = React.useState<EmojiCatalog | null>(() => getLoadedEmojiCatalog());
    const [query, setQuery] = React.useState("");
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [scope, setScope] = React.useState<AgentEmojiScope>(
        sessionId == null ? "provider" : initialScope
    );
    const sessionKey = normalizeSessionEmojiKey(sessionId);

    React.useEffect(() => {
        if (catalog != null) {
            return;
        }
        let cancelled = false;
        void loadEmojiCatalog().then((loaded) => {
            if (!cancelled) {
                setCatalog(loaded);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [catalog]);

    // Escape anywhere inside the popover closes it (the search input also handles it).
    React.useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [onClose]);

    const applyEmoji = React.useCallback(
        (emoji: string | null) => {
            if (scope === "session" && sessionKey !== "") {
                setSessionEmoji(sessionKey, emoji);
            } else {
                setAgentPersona(provider, emoji);
            }
            onClose();
        },
        [scope, sessionKey, provider, onClose]
    );
    // Per-scope "has emoji" so the remove button reflects the scope you're looking at.
    const currentHasEmoji = React.useMemo(() => {
        if (scope === "session" && sessionKey !== "") {
            return (getSessionEmojiSnapshot()[sessionKey] ?? "") !== "";
        }
        return hasCurrentEmoji;
    }, [scope, sessionKey, hasCurrentEmoji]);

    // Focus the search box ourselves instead of trusting `autoFocus`: the click that
    // opened the picker also hands focus to the underlying block (xterm re-claims it
    // a few ms later), so a single autoFocus routinely loses the race.
    const searchInputRef = React.useRef<HTMLInputElement | null>(null);
    React.useEffect(() => {
        const focus = () => searchInputRef.current?.focus();
        const raf = window.requestAnimationFrame(focus);
        const retry = window.setTimeout(focus, 80);
        return () => {
            window.cancelAnimationFrame(raf);
            window.clearTimeout(retry);
        };
    }, []);

    const providerLabel = provider === "" || provider === "agent" ? "此 Agent" : formatAgentProvider(provider);
    const footer = (
        <div className="agent-emoji-scope" role="radiogroup" aria-label="Emoji persona scope">
            {sessionKey !== "" && (
                <ScopeOption
                    checked={scope === "session"}
                    label="仅此会话"
                    hint="这一个会话在所有出现的位置都换成此 emoji（含历史列表，resume 后也保留）"
                    onChange={() => setScope("session")}
                />
            )}
            <ScopeOption
                checked={scope === "provider"}
                label={`所有 ${providerLabel} 会话`}
                hint={`覆盖所有 ${providerLabel} 会话（仅限该 provider，不影响其它 agent），含历史会话`}
                onChange={() => setScope("provider")}
            />
            <button
                type="button"
                className="agent-emoji-reset"
                onClick={() => applyEmoji(null)}
                disabled={!currentHasEmoji}
                title="恢复默认品牌 Logo"
            >
                恢复默认 Logo
            </button>
        </div>
    );

    if (catalog == null) {
        // Loading shell — same geometry as the eventual popover so it doesn't jump.
        return (
            <div
                className="markdown-emoji-picker mode-document agent-emoji-picker-loading"
                style={{
                    top: anchor.top,
                    left: Math.min(
                        Math.max(8, anchor.left),
                        Math.max(8, window.innerWidth - 320 - 8)
                    ),
                    width: Math.min(320, Math.max(220, window.innerWidth - 24)),
                }}
                role="dialog"
                aria-label="Emoji picker loading"
            >
                <div className="markdown-emoji-searchrow">
                    <div className="agent-emoji-loading-search" />
                </div>
                <div className="agent-emoji-loading-grid">
                    {Array.from({ length: 12 }, (_, i) => (
                        <div key={i} className="agent-emoji-loading-cell" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <EmojiPicker
            anchor={anchor}
            placement={placement}
            mode="document"
            catalog={catalog}
            query={query}
            onQueryChange={(next) => {
                setQuery(next);
                setActiveIndex(0);
            }}
            activeIndex={activeIndex}
            onActiveChange={setActiveIndex}
            onPick={(entry) => {
                recordRecentEmoji(entry.char);
                applyEmoji(entry.char);
            }}
            onClose={onClose}
            allowRemove={hasCurrentEmoji}
            onRemove={() => applyEmoji(null)}
            footer={footer}
            searchInputRef={searchInputRef}
        />
    );
}
