// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { copyText } from "@/app/view/aisessions/utils";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import type { AiAuditViewModel } from "./aiaudit-model";

const FeatureLabels: Record<string, string> = {
    title: "Title",
    metadata: "Note & Tags",
    "annotation-timeline": "Timeline",
    "annotation-field": "Field",
};

const SourceLabels: Record<string, string> = {
    "agent-card": "Agent card",
    "session-row": "List row",
    detail: "Detail header",
    batch: "Batch bar",
    "auto-scan": "Auto scan",
    "audit-retry": "Audit retry",
};

function stateClass(state: string): string {
    switch (state) {
        case "done":
            return "text-success";
        case "failed":
            return "text-error";
        case "running":
            return "text-accent";
        case "cancelled":
            return "text-secondary";
        default:
            return "text-secondary";
    }
}

function stateIcon(state: string): string {
    switch (state) {
        case "done":
            return "fa-check";
        case "failed":
            return "fa-triangle-exclamation";
        case "running":
            return "fa-spinner animate-spin";
        case "cancelled":
            return "fa-ban";
        default:
            return "fa-clock";
    }
}

function formatDuration(ms: number): string {
    if (ms <= 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ms: number): string {
    if (!ms) return "";
    const date = new Date(ms);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function AiAuditView({ model }: { model: AiAuditViewModel }) {
    const entries = jotai.useAtomValue(model.entriesAtom);
    const total = jotai.useAtomValue(model.totalAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const stats = jotai.useAtomValue(model.statsAtom);
    const featureFilter = jotai.useAtomValue(model.featureFilterAtom);
    const stateFilter = jotai.useAtomValue(model.stateFilterAtom);
    const query = jotai.useAtomValue(model.queryAtom);
    const detail = jotai.useAtomValue(model.detailAtom);
    const detailLoading = jotai.useAtomValue(model.detailLoadingAtom);

    return (
        <div className="flex h-full min-h-0 flex-col bg-block-solid p-3">
            <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
                <h2 className="mr-2 text-sm font-semibold text-primary">AI Audit</h2>
                <select
                    className="h-7 rounded border border-border bg-panel px-2 text-xs text-primary outline-none focus:border-accent"
                    value={featureFilter}
                    onChange={(event) => {
                        globalStore.set(model.featureFilterAtom, event.target.value);
                        void model.load();
                    }}
                    aria-label="Filter by feature"
                >
                    <option value="">All features</option>
                    <option value="title">Title</option>
                    <option value="metadata">Note & Tags</option>
                    <option value="annotation-timeline">Timeline</option>
                    <option value="annotation-field">Field</option>
                </select>
                <select
                    className="h-7 rounded border border-border bg-panel px-2 text-xs text-primary outline-none focus:border-accent"
                    value={stateFilter}
                    onChange={(event) => {
                        globalStore.set(model.stateFilterAtom, event.target.value);
                        void model.load();
                    }}
                    aria-label="Filter by state"
                >
                    <option value="">All states</option>
                    <option value="done">Done</option>
                    <option value="failed">Failed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
                <input
                    className="h-7 min-w-[160px] flex-1 rounded border border-border bg-panel px-2 text-xs text-primary outline-none focus:border-accent"
                    placeholder="Search session / model / error"
                    value={query}
                    onChange={(event) => globalStore.set(model.queryAtom, event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") void model.load();
                    }}
                />
                <button
                    type="button"
                    className="h-7 shrink-0 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                    onClick={() => void model.load()}
                >
                    Refresh
                </button>
                <button
                    type="button"
                    className="h-7 shrink-0 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                    onClick={() => void model.clear(30)}
                >
                    Clear 30d
                </button>
            </div>

            {stats != null ? (
                <div className="flex shrink-0 flex-wrap items-center gap-3 pb-2 text-[11px] text-secondary">
                    <span>24h: {stats.total24h} calls</span>
                    <span className={cn(stats.failed24h > 0 && "text-error")}>{stats.failed24h} failed</span>
                    <span>avg {formatDuration(stats.avgDurationMs)}</span>
                    {stats.byFeature.map((entry) => (
                        <span key={entry.feature}>
                            {FeatureLabels[entry.feature] ?? entry.feature} {entry.count}
                        </span>
                    ))}
                </div>
            ) : null}

            {error ? (
                <div className="shrink-0 rounded border border-error/40 bg-error/10 px-2 py-1 text-[11px] text-error">
                    {error}
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto">
                {loading && entries.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-xs text-secondary">
                        <i className="fa-sharp fa-solid fa-spinner animate-spin mr-2" />
                        Loading…
                    </div>
                ) : entries.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-xs text-secondary">
                        No AI activity recorded yet.
                    </div>
                ) : (
                    <table className="w-full border-collapse text-left text-[11px]">
                        <thead className="sticky top-0 bg-block-solid text-secondary">
                            <tr>
                                <th className="py-1 pr-2 font-normal">Time</th>
                                <th className="py-1 pr-2 font-normal">Feature</th>
                                <th className="py-1 pr-2 font-normal">Source</th>
                                <th className="py-1 pr-2 font-normal">Session</th>
                                <th className="py-1 pr-2 font-normal">State</th>
                                <th className="py-1 pr-2 font-normal">Result</th>
                                <th className="py-1 pr-2 font-normal">Duration</th>
                                <th className="py-1 font-normal">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((entry) => (
                                <tr
                                    key={entry.id}
                                    className="cursor-pointer border-t border-border/60 hover:bg-hover"
                                    onClick={() => void model.openDetail(entry.id)}
                                >
                                    <td className="py-1 pr-2 tabular-nums text-secondary">
                                        {formatTime(entry.createdAt)}
                                    </td>
                                    <td className="py-1 pr-2 text-primary">
                                        {FeatureLabels[entry.feature] ?? entry.feature}
                                    </td>
                                    <td className="py-1 pr-2 text-secondary">
                                        {SourceLabels[entry.scope] ?? entry.scope ?? "—"}
                                    </td>
                                    <td className="max-w-[220px] truncate py-1 pr-2 text-secondary">
                                        {entry.sessionTitle || entry.sessionKey}
                                    </td>
                                    <td className={cn("py-1 pr-2", stateClass(entry.state))}>
                                        <i className="fa-sharp fa-solid mr-1" />
                                        <i className={cn("fa-sharp fa-solid mr-1", stateIcon(entry.state))} />
                                        {entry.state}
                                    </td>
                                    <td className="py-1 pr-2 tabular-nums text-secondary">
                                        {entry.resultCount > 0 ? `${entry.resultCount}` : "—"}
                                        {entry.anchorTotal > 0 ? ` / ${entry.anchorKept}/${entry.anchorTotal}` : ""}
                                    </td>
                                    <td className="py-1 pr-2 tabular-nums text-secondary">
                                        {formatDuration(entry.durationMs)}
                                    </td>
                                    <td className="py-1">
                                        {entry.state === "failed" ? (
                                            <button
                                                type="button"
                                                className="cursor-pointer rounded border border-warning/50 px-1.5 py-0.5 text-warning hover:bg-warning/10"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    void model.retry(entry.id);
                                                }}
                                                title="Re-run this generation"
                                            >
                                                Retry
                                            </button>
                                        ) : null}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            <div className="shrink-0 pt-1 text-[10px] text-secondary">
                {total} total · showing {entries.length}
            </div>

            {detail != null ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
                    <div className="flex max-h-[80vh] w-[min(760px,92vw)] flex-col rounded-lg border border-border bg-modalbg p-3 shadow-2xl">
                        <div className="flex shrink-0 items-center justify-between gap-2 pb-2">
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-primary">
                                    {FeatureLabels[detail.feature] ?? detail.feature} · {detail.state}
                                </div>
                                <div className="truncate text-[11px] text-secondary">
                                    {detail.sessionTitle || detail.sessionKey} · {formatTime(detail.createdAt)} ·{" "}
                                    {formatDuration(detail.durationMs)}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                {detail.state === "failed" ? (
                                    <button
                                        type="button"
                                        className="h-7 rounded border border-warning/50 px-2 text-xs text-warning hover:bg-warning/10"
                                        onClick={() => void model.retry(detail.id)}
                                    >
                                        Retry
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="h-7 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                    onClick={() => model.closeDetail()}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                        {detail.error ? (
                            <div className="shrink-0 rounded border border-error/40 bg-error/10 px-2 py-1 text-[11px] text-error">
                                {detail.error}
                            </div>
                        ) : null}
                        <div className="min-h-0 flex-1 space-y-2 overflow-auto pt-2">
                            <AuditRawBlock label="Request" text={detail.rawRequest} />
                            <AuditRawBlock label="Response" text={detail.rawResponse} />
                            {!detail.rawRequest && !detail.rawResponse ? (
                                <div className="text-[11px] text-secondary">No raw payload stored.</div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
            {detailLoading ? (
                <div className="fixed bottom-4 right-4 rounded bg-modalbg px-2 py-1 text-[11px] text-secondary shadow">
                    Loading…
                </div>
            ) : null}
        </div>
    );
}

function AuditRawBlock({ label, text }: { label: string; text: string }) {
    const [expanded, setExpanded] = React.useState(false);
    if (!text) return null;
    return (
        <div className="rounded border border-border bg-panel">
            <div className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="text-[11px] font-medium text-primary">{label}</span>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                        onClick={() => void copyText(text)}
                    >
                        Copy
                    </button>
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                        onClick={() => setExpanded((value) => !value)}
                    >
                        {expanded ? "Collapse" : "Expand"}
                    </button>
                </div>
            </div>
            <pre
                className={cn(
                    "max-w-full overflow-auto border-t border-border px-2 py-1 font-mono text-[10px] leading-4 text-secondary whitespace-pre-wrap",
                    !expanded && "max-h-40"
                )}
            >
                {text}
            </pre>
        </div>
    );
}
