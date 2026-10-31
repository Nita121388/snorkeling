// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AIPropertiesButton — 「✨ AI auto-fill」：生成提案 → 用户确认 → 应用 → 10s Undo。
//
// 安全：生成只返回提案（不落库）；应用走 ApplyProperties，后端会拒绝内置键、
// 且在 force=false 时跳过 source=user 的值。因此这里不可能覆盖用户的 note/tags。

import type { AISessionsServiceType } from "@/app/store/services";
import { cn } from "@/util/util";
import * as React from "react";
import { dispatchAISessionNoteUpdated } from "../session-note-events";

const UndoWindowMs = 10_000;

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function summarizeValue(type: string, value: any): string {
    if (Array.isArray(value)) return value.join(", ");
    if (value == null) return "";
    if (type === "date" && typeof value === "number") {
        const d = new Date(value);
        if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
    }
    return String(value);
}

export function AIPropertiesButton({
    service,
    sessionId,
    connection,
    summary,
    onApplied,
}: {
    service: AISessionsServiceType;
    sessionId: string;
    connection: string;
    summary: SessionSummary | null;
    onApplied?: () => void;
}) {
    const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "applying">("idle");
    const [suggestions, setSuggestions] = React.useState<PropertySuggestion[]>([]);
    const [error, setError] = React.useState("");
    const [restore, setRestore] = React.useState<{ [key: string]: PropertyCell } | null>(null);
    const undoTimerRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        return () => {
            if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
        };
    }, []);

    const generate = React.useCallback(async () => {
        if (summary == null) return;
        setStatus("loading");
        setError("");
        try {
            const res = await service.GenerateProperties({
                id: summary.key,
                connection: connection || undefined,
            });
            setSuggestions(res.properties ?? []);
            setStatus("ready");
        } catch (err) {
            setError(errorMessage(err));
            setStatus("idle");
        }
    }, [connection, service, summary]);

    const apply = React.useCallback(async () => {
        if (summary == null || suggestions.length === 0) return;
        // 捕获应用前快照用于 Undo：已有值恢复原样，新键用 null 删除。
        const previous: { [key: string]: PropertyCell } = {};
        for (const suggestion of suggestions) {
            const existing = summary.props?.[suggestion.key];
            previous[suggestion.key] = existing ? { ...existing } : { value: null };
        }
        setStatus("applying");
        setError("");
        try {
            const res = await service.ApplyProperties({
                id: summary.key,
                connection: connection || undefined,
                properties: suggestions,
                force: false,
            });
            dispatchAISessionNoteUpdated(res.summary);
            setSuggestions([]);
            setStatus("idle");
            setRestore(previous);
            if (undoTimerRef.current != null) window.clearTimeout(undoTimerRef.current);
            undoTimerRef.current = window.setTimeout(() => setRestore(null), UndoWindowMs);
            onApplied?.();
        } catch (err) {
            setError(errorMessage(err));
            setStatus("ready");
        }
    }, [connection, onApplied, service, suggestions, summary]);

    const undo = React.useCallback(async () => {
        if (summary == null || restore == null) return;
        try {
            const res = await service.SetProps({
                id: summary.key,
                connection: connection || undefined,
                props: restore,
            });
            dispatchAISessionNoteUpdated(res);
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setRestore(null);
            if (undoTimerRef.current != null) {
                window.clearTimeout(undoTimerRef.current);
                undoTimerRef.current = null;
            }
        }
    }, [connection, restore, service, summary]);

    const dismiss = () => {
        setSuggestions([]);
        setStatus("idle");
    };

    return (
        <div className="property-ai">
            {status === "idle" && suggestions.length === 0 ? (
                <button type="button" className="property-ai-trigger" onClick={() => void generate()}>
                    ✨ AI auto-fill
                </button>
            ) : null}
            {status === "loading" ? <span className="property-ai-status">Generating…</span> : null}
            {status === "applying" ? <span className="property-ai-status">Applying…</span> : null}
            {status === "ready" && suggestions.length === 0 ? (
                <span className="property-ai-status">No new properties suggested.</span>
            ) : null}
            {status === "ready" && suggestions.length > 0 ? (
                <div className="property-ai-proposal">
                    <div className="property-ai-proposal-head">
                        {suggestions.length} suggested {suggestions.length === 1 ? "property" : "properties"}
                    </div>
                    <ul className="property-ai-list">
                        {suggestions.map((suggestion) => (
                            <li key={suggestion.key} className="property-ai-item">
                                <span className="property-ai-key">{suggestion.name || suggestion.key}</span>
                                <span className="property-ai-type">{suggestion.type}</span>
                                <span className="property-ai-value" title={summarizeValue(suggestion.type, suggestion.value)}>
                                    {summarizeValue(suggestion.type, suggestion.value)}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="property-ai-actions">
                        <button type="button" className="property-add-ok" onClick={() => void apply()}>
                            Apply all
                        </button>
                        <button type="button" className="property-add-cancel" onClick={dismiss}>
                            Dismiss
                        </button>
                    </div>
                </div>
            ) : null}
            {status === "ready" && suggestions.length > 0 ? null : null}
            {restore != null ? (
                <div className={cn("property-ai-undo")}>
                    AI properties applied
                    <button type="button" onClick={() => void undo()}>
                        Undo
                    </button>
                </div>
            ) : null}
            {error ? <span className="property-ai-error">{error}</span> : null}
        </div>
    );
}
