// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    AgentEmojiScope,
    resolveAgentEmojiScope,
    resolveAgentEmojiWriteTarget,
} from "@/app/agent-persona/persona-scope";
import { setAgentPersona } from "@/app/agent-persona/persona-store";
import {
    getSessionEmojiSnapshot,
    normalizeSessionEmojiKey,
    setSessionEmoji,
} from "@/app/agent-persona/session-persona-store";
import { getTabDisplayMode, setTabDisplayMode } from "@/app/agent-persona/tab-display-store";
import { formatAgentProvider } from "@/app/agent-status/agent-status-derive";
import { EmojiPicker } from "@/app/element/block-editor/components/emoji-picker";
import {
    getLoadedEmojiCatalog,
    loadEmojiCatalog,
    recordRecentEmoji,
    type EmojiCatalog,
} from "@/app/element/markdown-transform/emoji";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeORef } from "@/app/store/wos";
import { AgentEmojiMetaKey, normalizeAgentEmoji } from "./agent-logo";
import { cn } from "@/util/util";
import * as React from "react";

export type { AgentEmojiScope };

export type AgentEmojiPickerProps = {
    /**
     * Session id of the conversation being styled. Session scope ("仅此会话") writes
     * here; without it only the provider scope is offered.
     */
    sessionId: string | null;
    /**
     * Block that opened the picker. Enables the per-block scope ("仅此标签页", block
     * meta `agent:emoji`) when the session id is unknown — a missing session id must
     * never silently rewrite every session of the provider.
     */
    blockId?: string | null;
    /** Current block-level emoji from `agent:emoji` meta (enables "remove"). */
    blockEmoji?: string | null;
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
    blockId = null,
    blockEmoji = null,
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
    const sessionKey = normalizeSessionEmojiKey(sessionId);
    const blockKey = normalizeSessionEmojiKey(blockId);
    const [scope, setScope] = React.useState<AgentEmojiScope>(() =>
        resolveAgentEmojiScope(initialScope, sessionKey, blockKey)
    );
    const [emojiOnly, setEmojiOnlyState] = React.useState(() =>
        sessionKey !== "" ? getTabDisplayMode(sessionKey) === "emoji-only" : false
    );
    // The radio must reflect the scope that will actually be written. When the
    // session id is unknown the request collapses onto the per-block scope (the
    // radiobutton label says "仅此标签页") instead of silently writing provider-wide.
    const effectiveScope = resolveAgentEmojiScope(scope, sessionKey, blockKey);

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
            const target = resolveAgentEmojiWriteTarget(effectiveScope, sessionKey, provider, blockKey);
            if (target.kind === "session") {
                setSessionEmoji(target.sessionId, emoji);
            } else if (target.kind === "block") {
                // Per-block persona: block meta only, so a single tab click can never
                // reach the provider-wide store shared by every session.
                void RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: makeORef("block", target.blockId),
                    meta: { [AgentEmojiMetaKey]: emoji } as unknown as MetaType,
                }).catch((e) => console.warn("failed to set block agent emoji", e));
            } else {
                setAgentPersona(target.provider, emoji);
            }
            onClose();
        },
        [effectiveScope, sessionKey, provider, blockKey, onClose]
    );
    // Per-scope "has emoji" so the remove button reflects the scope you're looking at.
    const currentHasEmoji = React.useMemo(() => {
        if (effectiveScope === "session" && sessionKey !== "") {
            return (getSessionEmojiSnapshot()[sessionKey] ?? "") !== "";
        }
        if (effectiveScope === "block" && blockKey !== "") {
            return normalizeAgentEmoji(blockEmoji) != null;
        }
        return hasCurrentEmoji;
    }, [effectiveScope, sessionKey, blockKey, blockEmoji, hasCurrentEmoji]);

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

    React.useEffect(() => {
        if (sessionKey === "") {
            return;
        }
        setEmojiOnlyState(getTabDisplayMode(sessionKey) === "emoji-only");
    }, [sessionKey]);

    const providerLabel = provider === "" || provider === "agent" ? "此 Agent" : formatAgentProvider(provider);
    const footer = (
        <div className="agent-emoji-picker-footer">
            <div className="agent-emoji-scope" role="radiogroup" aria-label="Emoji persona scope">
                {sessionKey !== "" ? (
                    <ScopeOption
                        checked={effectiveScope === "session"}
                        label="仅此会话"
                        hint="这一个会话在所有出现的位置都换成此 emoji（含历史列表，resume 后也保留）"
                        onChange={() => setScope("session")}
                    />
                ) : blockKey !== "" ? (
                    <ScopeOption
                        checked={effectiveScope === "block"}
                        label="仅此标签页"
                        hint="只改当前这个标签页的图标；其它会话不受影响"
                        onChange={() => setScope("block")}
                    />
                ) : null}
                {sessionKey === "" ? (
                    <div className="agent-emoji-scope-note">
                        {blockKey !== ""
                            ? "未识别到当前会话 ID，默认只改当前标签页"
                            : "未识别到当前会话 ID"}
                    </div>
                ) : null}
                <ScopeOption
                    checked={effectiveScope === "provider"}
                    label={`所有 ${providerLabel} 会话`}
                    hint={`覆盖所有 ${providerLabel} 会话（仅限该 provider，不影响其它 agent），含历史会话`}
                    onChange={() => setScope("provider")}
                />
            </div>
            {sessionKey !== "" ? (
                <div className="agent-emoji-display-row">
                    <label className="agent-emoji-display-toggle">
                        <input
                            type="checkbox"
                            checked={emojiOnly}
                            onChange={(e) => {
                                const next = e.target.checked;
                                setEmojiOnlyState(next);
                                setTabDisplayMode(sessionKey, next ? "emoji-only" : "full");
                            }}
                        />
                        <span>仅显示 Emoji</span>
                    </label>
                    <span className="agent-emoji-display-hint">隐藏 Tab 标题，仅保留图标与状态</span>
                </div>
            ) : null}
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
                    left: Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - 320 - 8)),
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
