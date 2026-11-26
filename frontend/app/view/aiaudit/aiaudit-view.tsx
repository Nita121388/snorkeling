// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { copyText } from "@/app/view/aisessions/utils";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
    auditFeatureHoursLabel,
    bucketHeights,
    formatClock,
    formatDuration,
    formatTimestamp,
    groupByDay,
    isStalled,
    resultLabel,
    sessionTitle,
    shortSessionKey,
    stateMeta,
} from "./aiaudit-format";
import type { AiAuditViewModel } from "./aiaudit-model";
import { AuditPageSize } from "./aiaudit-model";

/**
 * 展示词表只存 key：`i18n.t` 在渲染期求值，切语言即时生效（Pattern C）。
 * `as const` 让 key 保持字面量类型，`i18n.t(...)` 才能过类型检查。
 */
const FeatureLabelKey = {
    title: "aiaudit:feature.title",
    metadata: "aiaudit:feature.metadata",
    "annotation-timeline": "aiaudit:feature.annotationTimeline",
    "annotation-field": "aiaudit:feature.annotationField",
} as const;

const SourceLabelKey = {
    "agent-card": "aiaudit:scope.agentCard",
    "session-row": "aiaudit:scope.sessionRow",
    detail: "aiaudit:scope.detail",
    batch: "aiaudit:scope.batch",
    "auto-scan": "aiaudit:scope.autoScan",
    "audit-retry": "aiaudit:scope.auditRetry",
} as const;

const StateFilterOptions = [
    { value: "", labelKey: "aiaudit:stateFilter.all" },
    { value: "queued", labelKey: "aiaudit:stateFilter.queued" },
    { value: "running", labelKey: "aiaudit:stateFilter.running" },
    { value: "done", labelKey: "aiaudit:stateFilter.done" },
    { value: "failed", labelKey: "aiaudit:stateFilter.failed" },
    { value: "cancelled", labelKey: "aiaudit:stateFilter.cancelled" },
] as const satisfies readonly { value: string; labelKey: string }[];

function featureLabel(feature: string): string {
    const known = (Object.prototype.hasOwnProperty.call(FeatureLabelKey, feature) ? feature : null) as
        | keyof typeof FeatureLabelKey
        | null;
    if (known == null) return feature || i18n.t("aiaudit:feature.unknown");
    return i18n.t(FeatureLabelKey[known]);
}

function sourceLabel(scope: string): string {
    if (!scope) return "";
    const known = (Object.prototype.hasOwnProperty.call(SourceLabelKey, scope) ? scope : null) as
        | keyof typeof SourceLabelKey
        | null;
    if (known == null) return scope;
    return i18n.t(SourceLabelKey[known]);
}

const columnWidths = ["112px", "180px", "auto", "96px", "84px", "78px", "56px"];

export function AiAuditView({ model }: { model: AiAuditViewModel }) {
    const entries = jotai.useAtomValue(model.entriesAtom);
    const total = jotai.useAtomValue(model.totalAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const loadingMore = jotai.useAtomValue(model.loadingMoreAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const stats = jotai.useAtomValue(model.statsAtom);
    const featureFilter = jotai.useAtomValue(model.featureFilterAtom);
    const stateFilter = jotai.useAtomValue(model.stateFilterAtom);
    const query = jotai.useAtomValue(model.queryAtom);
    const detail = jotai.useAtomValue(model.detailAtom);
    const detailLoading = jotai.useAtomValue(model.detailLoadingAtom);
    const comment = jotai.useAtomValue(model.commentAtom);
    const clearArmed = jotai.useAtomValue(model.clearArmedAtom);
    const pendingRefresh = jotai.useAtomValue(model.pendingRefreshAtom);
    const { t } = useTranslation("aiaudit");
    const [now, setNow] = React.useState(() => Date.now());
    const searchTimer = React.useRef<number | undefined>(undefined);

    // 首次加载 + 自动刷新：AI 任务的状态事件会即时触发一次轻量刷新，
    // 另外每 4 秒兜底轮询一次（worker 在别的进程，事件可能丢）。
    React.useEffect(() => {
        void model.load();
        const timer = window.setInterval(() => {
            // W2-3: 窗口隐藏时休眠 —— 不轮询也不写 now state，避免隐藏页每 4s 重渲。
            if (typeof document !== "undefined" && document.hidden) return;
            void model.load({ silent: true });
            setNow(Date.now());
        }, 4000);
        const unsubs = [
            waveEventSubscribeSingle<"aisessions:generationstatus">({
                eventType: "aisessions:generationstatus",
                handler: () => void model.load({ silent: true }),
            }),
            waveEventSubscribeSingle<"aisessions:annotationassist">({
                eventType: "aisessions:annotationassist",
                handler: () => void model.load({ silent: true }),
            }),
            waveEventSubscribeSingle<"aisessions:titleupdated">({
                eventType: "aisessions:titleupdated",
                handler: () => void model.load({ silent: true }),
            }),
        ];
        return () => {
            window.clearInterval(timer);
            window.clearTimeout(searchTimer.current);
            for (const unsub of unsubs) unsub();
        };
    }, [model]);

    const hasMore = total > entries.length;
    const groups = React.useMemo(() => groupByDay(entries), [entries]);

    const onSearchChange = (value: string) => {
        globalStore.set(model.queryAtom, value);
        window.clearTimeout(searchTimer.current);
        searchTimer.current = window.setTimeout(() => void model.load(), 350);
    };

    return (
        <div className="aiaudit-root flex h-full w-full min-h-0 flex-col bg-block-solid p-3 text-primary">
            <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
                <h2 className="mr-1 text-sm font-semibold text-primary">{t("aiaudit:header.title")}</h2>
                <select
                    className="h-7 rounded border border-border bg-panel px-2 text-xs text-primary outline-none focus:border-accent"
                    value={featureFilter}
                    onChange={(event) => model.setFilter(model.featureFilterAtom, event.target.value)}
                    aria-label={t("aiaudit:filter.featureAria")}
                >
                    <option value="">{t("aiaudit:filter.allFeatures")}</option>
                    <option value="title">{t("aiaudit:feature.title")}</option>
                    <option value="metadata">{t("aiaudit:feature.metadata")}</option>
                    <option value="annotation-timeline">{t("aiaudit:feature.annotationTimeline")}</option>
                    <option value="annotation-field">{t("aiaudit:feature.annotationField")}</option>
                </select>
                <select
                    className="h-7 rounded border border-border bg-panel px-2 text-xs text-primary outline-none focus:border-accent"
                    value={stateFilter}
                    onChange={(event) => model.setFilter(model.stateFilterAtom, event.target.value)}
                    aria-label={t("aiaudit:filter.stateAria")}
                >
                    {StateFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {t(option.labelKey)}
                        </option>
                    ))}
                </select>
                <div className="relative min-w-[180px] max-w-[340px] flex-1">
                    <i className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary" />
                    <input
                        className="h-7 w-full rounded border border-border bg-panel pl-6 pr-2 text-xs text-primary outline-none placeholder:text-secondary focus:border-accent"
                        placeholder={t("aiaudit:search.placeholder")}
                        value={query}
                        aria-label={t("aiaudit:search.aria")}
                        onChange={(event) => onSearchChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                window.clearTimeout(searchTimer.current);
                                void model.load();
                            }
                            if (event.key === "Escape") onSearchChange("");
                        }}
                    />
                </div>
                <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                    disabled={loading}
                    title={loading ? t("aiaudit:refresh.refreshing") : t("aiaudit:refresh.refresh")}
                    aria-label={t("aiaudit:refresh.aria")}
                    onClick={() => void model.load()}
                >
                    <i className={cn("fa-sharp fa-solid fa-rotate", loading && "animate-spin")} />
                </button>
                <button
                    type="button"
                    className={cn(
                        "h-7 shrink-0 rounded border px-2 text-xs transition-colors",
                        clearArmed
                            ? "border-error bg-error/15 text-error"
                            : "border-border text-secondary hover:bg-hover hover:text-primary"
                    )}
                    title={t("aiaudit:clear.title")}
                    onClick={() => void model.clear(30)}
                >
                    {clearArmed ? t("aiaudit:clear.confirm") : t("aiaudit:clear.clear")}
                </button>
            </div>

            <AuditStatsStrip
                stats={stats}
                stateFilter={stateFilter}
                onPickFailed={() => model.setFilter(model.stateFilterAtom, "failed")}
                onResetState={() => model.setFilter(model.stateFilterAtom, "")}
            />

            {comment ? (
                <div className="shrink-0 pb-1 text-[11px] text-secondary">
                    <i className="fa-sharp fa-solid fa-circle-info mr-1" />
                    {comment}
                </div>
            ) : null}

            {error ? (
                <div className="mb-1 shrink-0 rounded border border-error/40 bg-error/10 px-2 py-1 text-[11px] text-error">
                    {error}
                </div>
            ) : null}

            {pendingRefresh ? (
                <div className="mb-1 flex shrink-0 items-center justify-between gap-2 rounded border border-accent/40 bg-accent/10 px-2 py-1 text-[11px] text-accent">
                    <span>{t("aiaudit:pending.message")}</span>
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-hover hover:text-primary"
                        onClick={() => void model.load()}
                    >
                        {t("aiaudit:pending.refresh")}
                    </button>
                </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto rounded border border-border/70">
                {loading && entries.length === 0 ? (
                    <AuditSkeleton />
                ) : entries.length === 0 ? (
                    <div className="flex h-40 flex-col items-center justify-center gap-1 text-xs text-secondary">
                        <i className="fa-sharp fa-solid fa-clipboard-list text-lg opacity-40" />
                        <span>{t("aiaudit:empty.title")}</span>
                        <span className="text-[10px]">{t("aiaudit:empty.hint")}</span>
                    </div>
                ) : (
                    <table className="w-full min-w-[560px] table-fixed border-collapse text-left text-[11px]">
                        <colgroup>
                            {columnWidths.map((width, index) => (
                                <col key={index} style={{ width }} />
                            ))}
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-block-solid text-secondary">
                            <tr className="border-b border-border">
                                <th className="py-1 pl-2 pr-2 font-normal">{t("aiaudit:table.time")}</th>
                                <th className="py-1 pr-2 font-normal">{t("aiaudit:table.feature")}</th>
                                <th className="py-1 pr-2 font-normal">{t("aiaudit:table.session")}</th>
                                <th className="py-1 pr-2 font-normal">{t("aiaudit:table.state")}</th>
                                <th className="py-1 pr-2 text-right font-normal">{t("aiaudit:table.result")}</th>
                                <th className="py-1 pr-2 text-right font-normal">{t("aiaudit:table.duration")}</th>
                                <th className="py-1 pr-1 text-right font-normal">
                                    <span className="sr-only">{t("aiaudit:table.actions")}</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map((group) => (
                                <React.Fragment key={group.key}>
                                    <tr>
                                        <td
                                            colSpan={columnWidths.length}
                                            className="sticky top-[24px] z-10 bg-block-solid px-2 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-secondary"
                                        >
                                            {group.label}
                                        </td>
                                    </tr>
                                    {group.items.map((entry) => (
                                        <AuditRow key={entry.id} entry={entry} now={now} model={model} />
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 pt-1.5 text-[10px] text-secondary">
                <span>
                    {i18n.t("aiaudit:footer.summary", { count: total, shown: entries.length, total })}
                    {entries.length > 0 && total > entries.length
                        ? i18n.t("aiaudit:footer.showingFirst", { shown: entries.length })
                        : ""}
                </span>
                <span className="flex items-center gap-2">
                    {hasMore ? (
                        <button
                            type="button"
                            className="rounded border border-border px-2 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                            disabled={loadingMore}
                            onClick={() => void model.loadMore()}
                        >
                            {loadingMore
                                ? t("aiaudit:footer.loading")
                                : i18n.t("aiaudit:footer.loadMore", {
                                      count: Math.min(AuditPageSize, total - entries.length),
                                  })}
                        </button>
                    ) : null}
                    <span className="text-secondary/70">{t("aiaudit:footer.autoRefresh")}</span>
                </span>
            </div>

            {detail != null ? <AuditDetailDrawer detail={detail} model={model} /> : null}
            {detailLoading && detail == null ? (
                <PortalLayer>
                    <div className="pointer-events-none fixed bottom-4 right-4 rounded border border-border bg-modalbg px-2 py-1 text-[11px] text-secondary shadow">
                        <i className="fa-sharp fa-solid fa-spinner mr-1 animate-spin" />
                        {i18n.t("aiaudit:detail.loading")}
                    </div>
                </PortalLayer>
            ) : null}
        </div>
    );
}

function PortalLayer({ children }: { children: React.ReactNode }) {
    const mainEl = typeof document !== "undefined" ? document.getElementById("main") : null;
    if (mainEl == null) return null;
    return createPortal(children, mainEl);
}

function AuditStatsStrip({
    stats,
    stateFilter,
    onPickFailed,
    onResetState,
}: {
    stats: AuditStatsResult | null;
    stateFilter: string;
    onPickFailed: () => void;
    onResetState: () => void;
}) {
    const { t } = useTranslation("aiaudit");
    if (stats == null) {
        return <div className="shrink-0 pb-2 text-[11px] text-secondary">{t("aiaudit:stats.loading")}</div>;
    }
    const heights = bucketHeights(stats.hourly, 18);
    const buckets = stats.hourly ?? [];
    const featureChips = (stats.byFeature ?? []).slice(0, 4);
    const failedActive = stateFilter === "failed";
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 pb-2 text-[11px] text-secondary">
            <Metric label={t("aiaudit:stats.calls24h")} value={String(stats.total24h)} />
            <button
                type="button"
                className={cn(
                    "group flex items-baseline gap-1.5 rounded px-1 py-0.5 transition-colors",
                    failedActive
                        ? "bg-error/15 text-error"
                        : stats.failed24h > 0
                          ? "text-error hover:bg-error/10"
                          : "text-secondary",
                    stats.failed24h > 0 ? "cursor-pointer" : "cursor-default"
                )}
                title={
                    stats.failed24h > 0
                        ? failedActive
                            ? t("aiaudit:stats.failedFilterClear")
                            : t("aiaudit:stats.failedFilterShow")
                        : t("aiaudit:stats.noFailures")
                }
                onClick={() => {
                    if (stats.failed24h <= 0) return;
                    if (failedActive) onResetState();
                    else onPickFailed();
                }}
            >
                <MetricValue value={String(stats.failed24h)} />
                <span className="text-[10px] uppercase tracking-wide">{t("aiaudit:stats.failed")}</span>
            </button>
            <Metric label={t("aiaudit:stats.avg")} value={formatDuration(stats.avgDurationMs)} />
            <div
                className="flex h-[20px] items-end gap-[2px]"
                role="img"
                aria-label={t("aiaudit:stats.hourlyAria")}
            >
                {heights.map((height, index) => {
                    const bucket = buckets[index];
                    const failed = bucket != null && bucket.failed > 0;
                    return (
                        <div
                            key={index}
                            className={cn("w-[3px] rounded-sm", failed ? "bg-error" : "bg-accent/50")}
                            style={{ height: `${height}px` }}
                            title={
                                bucket == null
                                    ? ""
                                    : [
                                          auditFeatureHoursLabel(bucket.hour),
                                          i18n.t("aiaudit:stats.bucketCalls", { count: bucket.count }),
                                          bucket.failed > 0
                                              ? i18n.t("aiaudit:stats.bucketFailed", { count: bucket.failed })
                                              : "",
                                      ]
                                          .filter((part) => part !== "")
                                          .join(" · ")
                            }
                        />
                    );
                })}
            </div>
            {featureChips.length > 0 ? (
                <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-secondary/80">
                    {featureChips.map((chip) => (
                        <span key={chip.feature} className="rounded bg-hover px-1.5 py-0.5">
                            {featureLabel(chip.feature)} {chip.count}
                        </span>
                    ))}
                </span>
            ) : null}
            {stats.sweptStale > 0 ? (
                <span className="text-[10px] text-warning" title={t("aiaudit:stats.reclaimedTitle")}>
                    <i className="fa-sharp fa-solid fa-broom mr-1" />
                    {i18n.t("aiaudit:stats.stalledReclaimed", { count: stats.sweptStale })}
                </span>
            ) : null}
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <span className="flex items-baseline gap-1.5">
            <MetricValue value={value} />
            <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </span>
    );
}

function MetricValue({ value }: { value: string }) {
    return <span className="text-[13px] font-semibold tabular-nums text-primary">{value}</span>;
}

function AuditRow({ entry, now, model }: { entry: AuditView; now: number; model: AiAuditViewModel }) {
    const { t } = useTranslation("aiaudit");
    const stalled = isStalled(entry, now);
    const meta = stateMeta(entry.state);
    const label = stalled ? "stalled" : meta.label;
    const result = resultLabel(entry);
    const title = sessionTitle(entry);
    const key = shortSessionKey(entry.sessionKey);
    const failed = entry.state === "failed";
    return (
        <tr
            className={cn(
                "aiaudit-row group cursor-pointer border-t border-border/50 outline-none transition-colors focus-visible:bg-hover hover:bg-hover",
                failed && "is-failed bg-error/[0.06]",
                stalled && "is-stalled bg-warning/[0.06]",
                !failed && !stalled && "even:bg-white/[0.015]"
            )}
            tabIndex={0}
            aria-label={i18n.t("aiaudit:row.aria", {
                id: entry.id,
                feature: featureLabel(entry.feature),
                label,
            })}
            onClick={() => void model.openDetail(entry.id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void model.openDetail(entry.id);
                }
            }}
        >
            <td
                className={cn(
                    "truncate py-1 pl-2 pr-2 tabular-nums text-secondary",
                    failed && "border-l-2 border-error pl-1.5",
                    stalled && "border-l-2 border-warning pl-1.5"
                )}
                title={formatTimestamp(entry.createdAt)}
            >
                {formatClock(entry.createdAt, now)}
            </td>
            <td className="py-1 pr-2">
                <div className="truncate text-primary" title={featureLabel(entry.feature)}>
                    {featureLabel(entry.feature)}
                </div>
                <div className="truncate text-[10px] text-secondary" title={entry.scope}>
                    {sourceLabel(entry.scope) || entry.trigger || "—"}
                </div>
            </td>
            <td className="py-1 pr-2">
                <div className="truncate text-primary" title={entry.sessionTitle || entry.sessionKey}>
                    {title}
                </div>
                <div className="flex min-w-0 items-center gap-1 text-[10px] text-secondary">
                    {key ? (
                        <span className="truncate font-mono" title={entry.sessionKey}>
                            {key}
                        </span>
                    ) : null}
                    {entry.aiModel ? (
                        <span
                            className="shrink-0 rounded bg-hover px-1 text-[9px] text-secondary"
                            title={entry.aiModel}
                        >
                            {entry.aiModel}
                        </span>
                    ) : null}
                    {entry.connection ? (
                        <span className="shrink-0 truncate text-[9px] text-secondary/70" title={entry.connection}>
                            {entry.connection}
                        </span>
                    ) : null}
                </div>
            </td>
            <td className="py-1 pr-2">
                <span
                    className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                        stalled ? "border-warning/50 bg-warning/10 text-warning" : meta.pillClass,
                        stalled ? "" : meta.textClass
                    )}
                    title={
                        stalled
                            ? i18n.t("aiaudit:row.stalledTitle", { duration: formatDuration(now - entry.createdAt) })
                            : entry.error || label
                    }
                >
                    <span className={cn("h-1.5 w-1.5 rounded-full", stalled ? "bg-warning" : meta.dotClass)} />
                    {label}
                </span>
            </td>
            <td className="py-1 pr-2 text-right tabular-nums text-secondary" title={result.title}>
                <div className="text-primary">{result.primary}</div>
                {result.secondary ? <div className="text-[10px] text-secondary">{result.secondary}</div> : null}
            </td>
            <td className="py-1 pr-2 text-right tabular-nums text-secondary">{formatDuration(entry.durationMs)}</td>
            <td className="py-1 pr-1 text-right">
                <span className="inline-flex items-center justify-end gap-1">
                    {failed ? (
                        <button
                            type="button"
                            className="rounded border border-warning/50 px-1 py-0.5 text-[10px] text-warning opacity-0 transition-opacity hover:bg-warning/10 focus-visible:opacity-100 group-hover:opacity-100"
                            title={t("aiaudit:row.retry")}
                            onClick={(event) => {
                                event.stopPropagation();
                                void model.retry(entry.id);
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-rotate-right" />
                        </button>
                    ) : null}
                    <i className="fa-sharp fa-solid fa-chevron-right text-[9px] text-secondary opacity-0 transition-opacity group-hover:opacity-60" />
                </span>
            </td>
        </tr>
    );
}

function AuditSkeleton() {
    return (
        <div className="space-y-1 p-2" aria-label={i18n.t("aiaudit:skeleton.aria")}>
            {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2">
                    <div className="h-2.5 w-[80px] rounded bg-hover" />
                    <div className="h-2.5 w-[100px] rounded bg-hover" />
                    <div className="h-2.5 flex-1 rounded bg-hover" />
                    <div className="h-2.5 w-[56px] rounded bg-hover" />
                </div>
            ))}
        </div>
    );
}

type DetailTab = "summary" | "request" | "response";

function AuditDetailDrawer({ detail, model }: { detail: AuditView; model: AiAuditViewModel }) {
    const { t } = useTranslation("aiaudit");
    const [tab, setTab] = React.useState<DetailTab>("summary");
    const meta = stateMeta(detail.state);

    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                model.closeDetail();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [model]);

    React.useEffect(() => {
        setTab("summary");
    }, [detail.id]);

    const tabs = [
        { id: "summary", labelKey: "aiaudit:tabs.summary" },
        { id: "request", labelKey: "aiaudit:tabs.request" },
        { id: "response", labelKey: "aiaudit:tabs.response" },
    ] as const satisfies readonly { id: DetailTab; labelKey: string }[];

    return (
        <PortalLayer>
            <div
                className="fixed inset-0 z-50 flex justify-end bg-black/40"
                role="dialog"
                aria-modal="true"
                aria-label={t("aiaudit:detail.aria")}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    model.closeDetail();
                }}
            >
                <div
                    className="flex h-full w-[min(620px,calc(100vw-2rem))] flex-col border-l border-border bg-modalbg shadow-2xl"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="shrink-0 border-b border-border px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-semibold text-primary">
                                        {featureLabel(detail.feature)}
                                    </span>
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                                            meta.pillClass,
                                            meta.textClass
                                        )}
                                    >
                                        <span className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
                                        {meta.label}
                                    </span>
                                </div>
                                <div className="mt-0.5 truncate text-[11px] text-secondary" title={detail.sessionKey}>
                                    {sessionTitle(detail)} · {shortSessionKey(detail.sessionKey)}
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                                {detail.state === "failed" ? (
                                    <button
                                        type="button"
                                        className="h-7 rounded border border-warning/50 px-2 text-xs text-warning hover:bg-warning/10"
                                        onClick={() => void model.retry(detail.id)}
                                    >
                                        {t("aiaudit:detail.retry")}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    className="h-7 w-7 rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary"
                                    aria-label={t("aiaudit:detail.close")}
                                    onClick={() => model.closeDetail()}
                                >
                                    <i className="fa-sharp fa-solid fa-xmark" />
                                </button>
                            </div>
                        </div>
                        <div className="mt-2 flex items-center gap-1">
                            {tabs.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                        "h-6 rounded px-2 text-[11px] transition-colors",
                                        tab === item.id
                                            ? "bg-accent/15 text-accent"
                                            : "text-secondary hover:bg-hover hover:text-primary"
                                    )}
                                    onClick={() => setTab(item.id)}
                                >
                                    {t(item.labelKey)}
                                </button>
                            ))}
                        </div>
                    </div>
                    {detail.error ? (
                        <div className="shrink-0 border-b border-error/40 bg-error/10 px-3 py-1.5 text-[11px] text-error">
                            {detail.error}
                        </div>
                    ) : null}
                    {detail.rawTruncated ? (
                        <div className="shrink-0 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
                            <i className="fa-sharp fa-solid fa-scissors mr-1" />
                            {t("aiaudit:detail.truncated")}
                        </div>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
                        {tab === "summary" ? <AuditSummary detail={detail} /> : null}
                        {tab === "request" ? (
                            detail.rawRequest ? (
                                <AuditRawBlock label={t("aiaudit:tabs.request")} text={detail.rawRequest} defaultExpanded />
                            ) : (
                                <EmptyPane label={t("aiaudit:detail.noRequest")} />
                            )
                        ) : null}
                        {tab === "response" ? (
                            detail.rawResponse ? (
                                <AuditRawBlock label={t("aiaudit:tabs.response")} text={detail.rawResponse} defaultExpanded />
                            ) : (
                                <EmptyPane label={t("aiaudit:detail.noResponse")} />
                            )
                        ) : null}
                    </div>
                </div>
            </div>
        </PortalLayer>
    );
}

function EmptyPane({ label }: { label: string }) {
    return <div className="flex h-24 items-center justify-center text-[11px] text-secondary">{label}</div>;
}

function AuditSummary({ detail }: { detail: AuditView }) {
    const { t } = useTranslation("aiaudit");
    const rows: { label: string; value: React.ReactNode }[] = [
        { label: t("aiaudit:summary.feature"), value: featureLabel(detail.feature) },
        { label: t("aiaudit:summary.scope"), value: sourceLabel(detail.scope) || "—" },
        { label: t("aiaudit:summary.trigger"), value: detail.trigger || "—" },
        { label: t("aiaudit:summary.model"), value: detail.aiModel || "—" },
        { label: t("aiaudit:summary.connection"), value: detail.connection || t("aiaudit:summary.local") },
        { label: t("aiaudit:summary.state"), value: stateMeta(detail.state).label },
        { label: t("aiaudit:summary.results"), value: detail.resultCount > 0 ? String(detail.resultCount) : "—" },
        {
            label: t("aiaudit:summary.anchors"),
            value:
                detail.anchorTotal > 0
                    ? i18n.t("aiaudit:summary.anchorsKept", { kept: detail.anchorKept, total: detail.anchorTotal })
                    : "—",
        },
        { label: t("aiaudit:summary.duration"), value: formatDuration(detail.durationMs) },
        { label: t("aiaudit:summary.created"), value: formatTimestamp(detail.createdAt) },
        { label: t("aiaudit:summary.updated"), value: formatTimestamp(detail.updatedAt) },
        {
            label: t("aiaudit:summary.session"),
            value: <span className="break-all font-mono text-[10px]">{detail.sessionKey || "—"}</span>,
        },
        {
            label: t("aiaudit:summary.job"),
            value: <span className="break-all font-mono text-[10px]">{detail.jobId || "—"}</span>,
        },
    ];
    return (
        <div className="space-y-2">
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-[11px]">
                {rows.map((row) => (
                    <React.Fragment key={row.label}>
                        <dt className="text-secondary">{row.label}</dt>
                        <dd
                            className="min-w-0 truncate text-primary"
                            title={typeof row.value === "string" ? row.value : undefined}
                        >
                            {row.value}
                        </dd>
                    </React.Fragment>
                ))}
            </dl>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                    onClick={() =>
                        void copyText(
                            JSON.stringify(
                                {
                                    id: detail.id,
                                    feature: detail.feature,
                                    scope: detail.scope,
                                    sessionKey: detail.sessionKey,
                                    model: detail.aiModel,
                                    connection: detail.connection,
                                    trigger: detail.trigger,
                                    state: detail.state,
                                    resultCount: detail.resultCount,
                                    anchors: `${detail.anchorKept}/${detail.anchorTotal}`,
                                    durationMs: detail.durationMs,
                                    error: detail.error,
                                },
                                null,
                                2
                            )
                        )
                    }
                >
                    <i className="fa-sharp fa-solid fa-copy mr-1" />
                    {t("aiaudit:summary.copy")}
                </button>
            </div>
        </div>
    );
}

function AuditRawBlock({
    label,
    text,
    defaultExpanded = false,
}: {
    label: string;
    text: string;
    defaultExpanded?: boolean;
}) {
    const { t } = useTranslation("aiaudit");
    const [expanded, setExpanded] = React.useState(defaultExpanded);
    const [copied, setCopied] = React.useState(false);
    if (!text) return null;
    return (
        <div className="rounded border border-border bg-panel">
            <div className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="text-[11px] font-medium text-primary">
                    {label}
                    <span className="ml-1.5 text-[10px] font-normal text-secondary">
                        {i18n.t("aiaudit:raw.chars", { value: text.length.toLocaleString() })}
                    </span>
                </span>
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                        onClick={() => {
                            void copyText(text);
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1200);
                        }}
                    >
                        {copied ? t("aiaudit:raw.copied") : t("aiaudit:raw.copy")}
                    </button>
                    <button
                        type="button"
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
                        onClick={() => setExpanded((value) => !value)}
                    >
                        {expanded ? t("aiaudit:raw.collapse") : t("aiaudit:raw.expand")}
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
