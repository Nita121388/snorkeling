// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { setAgentPersona } from "@/app/agent-persona/persona-store";
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
import { WOS } from "@/store/global";
import { cn } from "@/util/util";
import * as React from "react";
import { AgentEmojiMetaKey } from "./agent-logo";

export type AgentEmojiScope = "block" | "provider";

export type AgentEmojiPickerProps = {
    blockId: string;
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
 * this block only (L2) or every session of this provider (L1).
 */
export function AgentEmojiPicker({
    blockId,
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
    const [scope, setScope] = React.useState<AgentEmojiScope>(initialScope);

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
            if (scope === "block") {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { [AgentEmojiMetaKey]: emoji } as MetaType,
                });
            } else {
                setAgentPersona(provider, emoji);
            }
            onClose();
        },
        [scope, blockId, provider, onClose]
    );

    const providerLabel = provider === "" || provider === "agent" ? "此 Agent" : formatAgentProvider(provider);
    const footer = (
        <div className="agent-emoji-scope" role="radiogroup" aria-label="Emoji persona scope">
            <ScopeOption
                checked={scope === "block"}
                label="仅此会话"
                hint="只覆盖当前这个 block，随 workspace 同步"
                onChange={() => setScope("block")}
            />
            <ScopeOption
                checked={scope === "provider"}
                label={`所有 ${providerLabel} 会话`}
                hint="覆盖此 provider 的所有会话，包括历史会话（保存在本机）"
                onChange={() => setScope("provider")}
            />
            <button
                type="button"
                className="agent-emoji-reset"
                onClick={() => applyEmoji(null)}
                disabled={!hasCurrentEmoji}
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
                style={{ top: anchor.top, left: anchor.left }}
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
        />
    );
}
