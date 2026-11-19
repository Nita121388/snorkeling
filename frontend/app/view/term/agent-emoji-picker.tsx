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
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as React from "react";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation("term");
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
    // Externally injected recommendations (design §8.2: 内部只展示，有就显示)
    // — one async fetch while the picker is open; null hides the section.
    const [recommendations, setRecommendations] = React.useState<SessionEmojiRecommendation[] | null>(null);
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
                // Record the pick on the backend (source=user prop + preference
                // counters, one transaction). Best-effort: a failure must never
                // block the picker (design.md §5.5; the localStorage value still
                // works while the backend is unreachable).
                void RpcApi.SessionEmojiRecordPickCommand(TabRpcClient, {
                    identifier: target.sessionId,
                    emoji: emoji ?? "",
                }).catch(() => {
                    /* silent: local write already applied */
                });
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

    React.useEffect(() => {
        if (sessionKey === "") {
            setRecommendations(null);
            return;
        }
        let cancelled = false;
        RpcApi.SessionEmojiRecommendationsCommand(TabRpcClient, { identifier: sessionKey })
            .then((res) => {
                if (!cancelled) {
                    setRecommendations(res?.found && res.candidates?.length > 0 ? res.candidates : null);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setRecommendations(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [sessionKey]);

    const providerLabel =
        provider === "" || provider === "agent" ? t("term:agentEmoji.thisAgent") : formatAgentProvider(provider);
    const footer = (
        <div className="agent-emoji-picker-footer">
            {effectiveScope === "session" && sessionKey !== "" && recommendations != null && recommendations.length > 0 ? (
                <div className="agent-emoji-recommend-row" role="group" aria-label="推荐">
                    {recommendations.map((rec) => (
                        <button
                            key={rec.emoji}
                            type="button"
                            className="markdown-emoji-picker-cell agent-emoji-recommend-cell"
                            title={rec.reason || rec.emoji}
                            onClick={() => applyEmoji(rec.emoji)}
                        >
                            {rec.emoji}
                        </button>
                    ))}
                </div>
            ) : null}
            <div className="agent-emoji-scope" role="radiogroup" aria-label={t("term:agentEmoji.scopeGroupLabel")}>
                {sessionKey !== "" ? (
                    <ScopeOption
                        checked={effectiveScope === "session"}
                        label={t("term:agentEmoji.scopeSession")}
                        hint={t("term:agentEmoji.scopeSessionHint")}
                        onChange={() => setScope("session")}
                    />
                ) : blockKey !== "" ? (
                    <ScopeOption
                        checked={effectiveScope === "block"}
                        label={t("term:agentEmoji.scopeBlock")}
                        hint={t("term:agentEmoji.scopeBlockHint")}
                        onChange={() => setScope("block")}
                    />
                ) : null}
                {sessionKey === "" ? (
                    <div className="agent-emoji-scope-note">
                        {blockKey !== ""
                            ? t("term:agentEmoji.unknownSessionFallback")
                            : t("term:agentEmoji.unknownSession")}
                    </div>
                ) : null}
                <ScopeOption
                    checked={effectiveScope === "provider"}
                    label={i18n.t("term:agentEmoji.scopeProvider", { provider: providerLabel })}
                    hint={i18n.t("term:agentEmoji.scopeProviderHint", { provider: providerLabel })}
                    onChange={() => setScope("provider")}
                />
            </div>
            {sessionKey !== "" ? (
                <div className="agent-emoji-display-row">
                    <label className={cn("agent-emoji-scope-option", "agent-emoji-display-toggle")}>
                        <input
                            type="checkbox"
                            checked={emojiOnly}
                            onChange={(e) => {
                                const next = e.target.checked;
                                setEmojiOnlyState(next);
                                setTabDisplayMode(sessionKey, next ? "emoji-only" : "full");
                            }}
                        />
                        <span>{t("term:agentEmoji.emojiOnly")}</span>
                    </label>
                    <span className="agent-emoji-display-hint">{t("term:agentEmoji.emojiOnlyHint")}</span>
                </div>
            ) : null}
            <button
                type="button"
                className="agent-emoji-reset"
                onClick={() => applyEmoji(null)}
                disabled={!currentHasEmoji}
                title={t("term:agentEmoji.resetTitle")}
            >
                {t("term:agentEmoji.reset")}
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
                aria-label={t("term:agentEmoji.loadingLabel")}
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
