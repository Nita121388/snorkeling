// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Common Text cloud sync settings — a `waveconfig` visual panel.
 *
 * This mirrors the shape of `agentnotifysettings.tsx` (SectionRow rows, `divide-y` grouping,
 * Toggle geometry from element/toggle.scss) instead of inventing a second settings shell:
 * the Settings menu opens the waveconfig block, and Sync is one entry in its left sidebar.
 *
 * Two contracts worth keeping:
 *
 * 1. **Availability has exactly one source of truth** — `blockedReasonFor()`. The status panel
 *    in the compose modal renders the same judgement, so a transport can never look selectable
 *    in one place and greyed out in the other.
 * 2. **Editing is a draft** — nothing is written until Save. Group collapse state is a pure view
 *    preference and lives in localStorage, not in settings.json.
 */

import { CommonTextService } from "@/app/store/services";
import { CopyForAgent } from "@/app/element/copy-for-agent";
import { atoms } from "@/app/store/global-atoms";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Toggle } from "@/app/element/toggle";
import { cn, fireAndForget } from "@/util/util";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

export type SyncTransportId = "none" | "folder" | "git" | "server";
export type SyncConflictPolicy = "row-merge" | "newest" | "manual";

export type SyncSettingsDraft = {
    transport: SyncTransportId;
    conflictPolicy: SyncConflictPolicy;
    deviceName: string;
    folderPath: string;
    folderWatch: boolean;
    gitRemote: string;
    gitInterval: string;
    gitHasToken: boolean;
    serverUrl: string;
    serverPushMode: string;
    serverHasToken: boolean;
    serverInsecure: boolean;
    syncTombstones: boolean;
};

export type SyncTransportSpec = {
    id: SyncTransportId;
    name: string;
    description: string;
    /** Recommended badge in the picker. */
    recommended?: boolean;
    /** Why this transport cannot be selected right now; null means selectable. */
    blockedReason?: string | null;
};

export const SyncSettingKeys = {
    transport: "commontext:sync:transport",
    conflictPolicy: "commontext:sync:conflictpolicy",
    deviceName: "commontext:sync:devicename",
    deviceId: "commontext:sync:deviceid",
    folderPath: "commontext:sync:folder:path",
    folderWatch: "commontext:sync:folder:watch",
    gitRemote: "commontext:sync:git:remote",
    gitInterval: "commontext:sync:git:interval",
    gitHasToken: "commontext:sync:git:hastoken",
    serverUrl: "commontext:sync:server:url",
    serverPushMode: "commontext:sync:server:pushmode",
    serverHasToken: "commontext:sync:server:hastoken",
    serverInsecure: "commontext:sync:server:allowinsecure",
    syncTombstones: "commontext:sync:synctombstones",
} as const;

export const SyncSettingDefaults: SyncSettingsDraft = {
    transport: "none",
    conflictPolicy: "row-merge",
    deviceName: "",
    folderPath: "",
    folderWatch: true,
    gitRemote: "",
    gitInterval: "15m",
    gitHasToken: false,
    serverUrl: "",
    serverPushMode: "realtime",
    serverHasToken: false,
    serverInsecure: false,
    syncTombstones: true,
};

const TransportOrder: SyncTransportId[] = ["folder", "git", "server", "none"];

const TransportMeta: Record<SyncTransportId, { name: string; description: string; recommended?: boolean }> = {
    folder: {
        name: "Local folder (cloud drive)",
        description: "commontext.json in a synced folder; fsnotify picks up external changes.",
        recommended: true,
    },
    git: {
        name: "Git repository",
        description: "Private repo, periodic commit; real history and visible conflicts.",
    },
    server: {
        name: "Self-hosted service",
        description: "Your own sync server; HTTP/WebSocket push with token auth.",
    },
    none: {
        name: "Off · local only",
        description: "No transport. Items stay on this machine.",
    },
};

/**
 * Why a transport cannot be picked right now, or null when it can.
 *
 * Deliberately accepts the draft rather than reading settings: while editing, the user must see
 * the row unlock the moment they fill in the missing field, without having to Save first.
 */
export function blockedReasonFor(transport: SyncTransportId, draft: SyncSettingsDraft): string | null {
    switch (transport) {
        case "folder":
            return draft.folderPath.trim() === "" ? "Set a file path first." : null;
        case "git":
            return draft.gitHasToken ? null : "Configure an access token first (stored in the OS keyring).";
        case "server":
            if (draft.serverUrl.trim() === "") return "Enter the server URL first (include the scheme).";
            if (!draft.serverHasToken) return "Configure a server token first (stored in the OS keyring).";
            return null;
        case "none":
            return null;
        default:
            return "Unknown transport.";
    }
}

export function buildTransportSpecs(draft: SyncSettingsDraft): SyncTransportSpec[] {
    return TransportOrder.map((id) => ({
        ...TransportMeta[id],
        id,
        blockedReason: blockedReasonFor(id, draft),
    }));
}

/** Read the stored settings into a draft. Unknown enum values fall back to the safe default. */
export function readSyncDraft(settings: SettingsType | null | undefined): SyncSettingsDraft {
    const s = settings ?? ({} as SettingsType);
    const rawTransport = (s as Record<string, unknown>)[SyncSettingKeys.transport];
    const transport: SyncTransportId =
        rawTransport === "folder" || rawTransport === "git" || rawTransport === "server" ? rawTransport : "none";
    const rawPolicy = (s as Record<string, unknown>)[SyncSettingKeys.conflictPolicy];
    const conflictPolicy: SyncConflictPolicy =
        rawPolicy === "newest" || rawPolicy === "manual" ? rawPolicy : "row-merge";
    const str = (key: string) => {
        const value = (s as Record<string, unknown>)[key];
        return typeof value === "string" ? value : "";
    };
    const bool = (key: string, fallback: boolean) => {
        const value = (s as Record<string, unknown>)[key];
        return typeof value === "boolean" ? value : fallback;
    };
    return {
        transport,
        conflictPolicy,
        deviceName: str(SyncSettingKeys.deviceName),
        folderPath: str(SyncSettingKeys.folderPath),
        folderWatch: bool(SyncSettingKeys.folderWatch, SyncSettingDefaults.folderWatch),
        gitRemote: str(SyncSettingKeys.gitRemote),
        gitInterval: str(SyncSettingKeys.gitInterval) || SyncSettingDefaults.gitInterval,
        gitHasToken: bool(SyncSettingKeys.gitHasToken, false),
        serverUrl: str(SyncSettingKeys.serverUrl),
        serverPushMode: str(SyncSettingKeys.serverPushMode) || SyncSettingDefaults.serverPushMode,
        serverHasToken: bool(SyncSettingKeys.serverHasToken, false),
        serverInsecure: bool(SyncSettingKeys.serverInsecure, false),
        syncTombstones: bool(SyncSettingKeys.syncTombstones, SyncSettingDefaults.syncTombstones),
    };
}

/** Draft → the settings keys to merge. Only changed keys are written. */
export function draftToSettingsPatch(draft: SyncSettingsDraft): Record<string, unknown> {
    return {
        [SyncSettingKeys.transport]: draft.transport,
        [SyncSettingKeys.conflictPolicy]: draft.conflictPolicy,
        [SyncSettingKeys.deviceName]: draft.deviceName,
        [SyncSettingKeys.folderPath]: draft.folderPath,
        [SyncSettingKeys.folderWatch]: draft.folderWatch,
        [SyncSettingKeys.gitRemote]: draft.gitRemote,
        [SyncSettingKeys.gitInterval]: draft.gitInterval,
        [SyncSettingKeys.gitHasToken]: draft.gitHasToken,
        [SyncSettingKeys.serverUrl]: draft.serverUrl,
        [SyncSettingKeys.serverPushMode]: draft.serverPushMode,
        [SyncSettingKeys.serverHasToken]: draft.serverHasToken,
        [SyncSettingKeys.serverInsecure]: draft.serverInsecure,
        [SyncSettingKeys.syncTombstones]: draft.syncTombstones,
    };
}

const GroupKeys = ["transport", "backend", "device", "conflict", "scope", "status", "maintenance"] as const;
type GroupKey = (typeof GroupKeys)[number];

const CollapseStorageKey = "commontext:syncSettings:collapsed";

/**
 * Formats an RFC3339 timestamp from the backend. Falls back to the raw string when unparseable —
 * showing "Invalid Date" would be worse than showing the value the backend sent.
 */
function formatSyncTime(rfc3339: string): string {
    const ts = Date.parse(rfc3339);
    if (Number.isNaN(ts)) return rfc3339;
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function loadCollapsedGroups(): Record<string, boolean> {
    try {
        const raw = localStorage.getItem(CollapseStorageKey);
        if (raw == null) return {};
        const parsed = JSON.parse(raw);
        return parsed != null && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveCollapsedGroups(collapsed: Record<string, boolean>): void {
    try {
        localStorage.setItem(CollapseStorageKey, JSON.stringify(collapsed));
    } catch {
        // View preference only; a failed write must not break the settings panel.
    }
}

function GroupHeader({
    groupKey,
    label,
    collapsed,
    onToggle,
    extra,
}: {
    groupKey: GroupKey;
    label: string;
    collapsed: boolean;
    onToggle: (key: GroupKey) => void;
    extra?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            data-sync-group={groupKey}
            aria-expanded={!collapsed}
            onClick={() => onToggle(groupKey)}
            className="mt-4 flex w-full items-center gap-1.5 rounded-sm py-0.5 text-left text-[11px] font-semibold text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
            <i className={cn("fa-solid fa-chevron-down text-[9px] text-muted transition-transform", collapsed && "-rotate-90")} />
            <span>{label}</span>
            {extra}
        </button>
    );
}

/** One settings row: title + description on the left, control on the right (SectionRow shape). */
function Row({
    title,
    description,
    children,
    disabled,
    rowKey,
}: {
    title: string;
    description: React.ReactNode;
    children: React.ReactNode;
    disabled?: boolean;
    rowKey?: string;
}) {
    return (
        <div
            data-sync-row={rowKey}
            className={cn("flex items-start gap-4 py-3", disabled && "opacity-50")}
        >
            <div className="min-w-0 flex-1">
                <div className="text-sm text-primary">{title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">{children}</div>
        </div>
    );
}

function TextField({
    value,
    onChange,
    placeholder,
    ariaLabel,
    mono,
    disabled,
    dataAttr,
}: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    ariaLabel: string;
    mono?: boolean;
    disabled?: boolean;
    dataAttr?: string;
}) {
    return (
        <input
            type="text"
            value={value}
            placeholder={placeholder}
            aria-label={ariaLabel}
            disabled={disabled}
            spellCheck={false}
            data-sync-field={dataAttr}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                "h-8 w-64 min-w-0 rounded border border-border bg-panel px-2 text-xs text-primary outline-none transition-colors focus:border-accent disabled:opacity-50",
                mono && "font-mono"
            )}
        />
    );
}

export const SyncSettingsContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    void _model;

    const settings = useAtomValue(atoms.settingsAtom);
    const stored = useMemo(() => readSyncDraft(settings), [settings]);
    const [draft, setDraft] = useState<SyncSettingsDraft>(stored);
    const [dirty, setDirty] = useState(false);
    const [status, setStatus] = useState("");
    // Live status from the sync manager (transport, last run, unresolved conflicts).
    const [syncStatus, setSyncStatus] = useState<Status | null>(null);
    const [syncingNow, setSyncingNow] = useState(false);
    // Switch flow: the baseline chooser is visible, and whether the switch is in flight.
    const [baselinePending, setBaselinePending] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => loadCollapsedGroups());

    // Re-sync the draft when the persisted values change and the user has no local edits.
    // Without the `dirty` guard an external settings write would silently clobber typing.
    useEffect(() => {
        if (dirty) return;
        setDraft(stored);
    }, [stored, dirty]);

    const patch = useCallback((next: Partial<SyncSettingsDraft>) => {
        setDraft((cur) => ({ ...cur, ...next }));
        setDirty(true);
        setStatus("");
    }, []);

    const toggleGroup = useCallback((key: GroupKey) => {
        setCollapsed((cur) => {
            const next = { ...cur, [key]: !cur[key] };
            saveCollapsedGroups(next);
            return next;
        });
    }, []);

    // Live status: fetched once on mount and refreshed after Save / Sync now. Polling is not needed
    // because the timer-driven runs are minutes apart and the panel is short-lived.
    const refreshSyncStatus = useCallback(() => {
        fireAndForget(async () => {
            try {
                const resp = await CommonTextService.SyncStatus();
                setSyncStatus(resp?.status ?? null);
            } catch {
                // Status is informational; a failure must not break the settings panel.
                setSyncStatus(null);
            }
        });
    }, []);

    useEffect(() => {
        refreshSyncStatus();
    }, [refreshSyncStatus]);

    // Switching from one ACTIVE transport to another is the only case that needs a baseline: two
    // independent datasets meet with no shared history, so guessing would silently drop whichever
    // side is older. Going from "off" to a transport has an empty side, so no choice is needed.
    const needsBaseline = useMemo(() => {
        const from = stored.transport;
        const to = draft.transport;
        if (from === to) return false;
        if (from === "none" || to === "none") return false;
        return blockedReasonFor(to, draft) == null;
    }, [draft, stored.transport]);

    const save = useCallback(() => {
        // 前置没满足时允许保存（配置要能边填边存），但必须明确告诉用户「现在跑不起来」，
        // 否则界面显示已保存、同步却一直不动，是最难查的一类静默失败。
        const blocked = blockedReasonFor(draft.transport, draft);
        if (needsBaseline) {
            // Show the chooser first; nothing is written until a side is picked.
            setBaselinePending(true);
            setStatus("");
            return;
        }
        fireAndForget(async () => {
            try {
                await RpcApi.SetConfigCommand(TabRpcClient, draftToSettingsPatch(draft) as SettingsType);
                setDirty(false);
                setStatus(
                    blocked == null
                        ? "Saved."
                        : `Saved, but sync will not start: ${blocked}`
                );
                refreshSyncStatus();
            } catch (err) {
                setStatus(err instanceof Error ? err.message : String(err));
            }
        });
    }, [draft, needsBaseline, refreshSyncStatus]);

    // applyBaseline runs the explicit switch: the backend re-syncs against the new transport with
    // the chosen winner, and only persists the settings if that succeeds.
    const applyBaseline = useCallback(
        (baseline: "local" | "remote") => {
            setSwitching(true);
            fireAndForget(async () => {
                try {
                    const resp = await CommonTextService.SyncSwitchTransport({
                        settings: draftToSettingsPatch(draft) as Record<string, unknown>,
                        baseline,
                    });
                    setSyncStatus(resp?.status ?? null);
                    setBaselinePending(false);
                    setDirty(false);
                    const s = resp?.status;
                    setStatus(
                        s?.lastError != null && s.lastError !== ""
                            ? `Switched, but the first sync reported: ${s.lastError}`
                            : `Switched to ${draft.transport} (${baseline} wins).`
                    );
                } catch (err) {
                    // The backend keeps the previous transport when the baseline sync fails, so the
                    // message must say that explicitly rather than looking like a plain failure.
                    setStatus(
                        `Switch aborted, previous transport kept: ${err instanceof Error ? err.message : String(err)}`
                    );
                } finally {
                    setSwitching(false);
                }
            });
        },
        [draft]
    );

    const runSyncNow = useCallback(() => {
        if (syncingNow) return;
        setSyncingNow(true);
        fireAndForget(async () => {
            try {
                const resp = await CommonTextService.SyncNow({ trigger: "manual" });
                setSyncStatus(resp?.status ?? null);
                const s = resp?.status;
                setStatus(
                    s == null
                        ? "Sync finished."
                        : s.lastError != null && s.lastError !== ""
                          ? `Sync failed: ${s.lastError}`
                          : `Synced — pulled ${s.lastPulled ?? 0}, applied ${s.lastApplied ?? 0}, pushed ${s.lastPushed ?? 0}.`
                );
            } catch (err) {
                setStatus(err instanceof Error ? err.message : String(err));
            } finally {
                setSyncingNow(false);
            }
        });
    }, [syncingNow]);

    const transports = useMemo(() => buildTransportSpecs(draft), [draft]);
    const deviceId = (settings as Record<string, unknown> | undefined)?.[SyncSettingKeys.deviceId];
    const isCollapsed = (key: GroupKey) => collapsed[key] === true;

    return (
        <div className="h-full overflow-auto p-6" data-sync-settings="">
            <div className="max-w-2xl">
                <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                        Common Text can sync across your machines. This version syncs Common Text only, with one
                        transport and one copy of the data.
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
                        <button
                            type="button"
                            onClick={save}
                            disabled={!dirty}
                            className={cn(
                                "h-7 rounded px-3 text-xs transition-colors",
                                dirty
                                    ? "cursor-pointer bg-action text-actiontext hover:bg-actionhover"
                                    : "cursor-default border border-border text-muted-foreground opacity-50"
                            )}
                        >
                            Save
                        </button>
                    </div>
                </div>
                {status !== "" && (
                    <div
                        data-sync-status=""
                        className={cn("mb-2 text-xs", status.startsWith("Saved.") ? "text-success" : "text-warning")}
                    >
                        {status}
                    </div>
                )}

                {/* ── Transport ─────────────────────────────────────────── */}
                <GroupHeader
                    groupKey="transport"
                    label="Transport"
                    collapsed={isCollapsed("transport")}
                    onToggle={toggleGroup}
                    extra={<span className="ml-auto text-[10px] font-normal text-muted">single active</span>}
                />
                {!isCollapsed("transport") && (
                    <div className="divide-y divide-border">
                        {transports.map((t) => {
                            const blocked = t.blockedReason != null;
                            const active = draft.transport === t.id;
                            return (
                                <div
                                    key={t.id}
                                    data-sync-transport={t.id}
                                    data-sync-transport-state={blocked ? "blocked" : active ? "active" : "available"}
                                    className="flex items-start gap-4 py-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm text-primary">{t.name}</span>
                                            {t.recommended && (
                                                <span className="rounded-sm border border-accent/40 px-1 text-[9px] text-accent">
                                                    recommended
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 text-xs text-muted-foreground">
                                            {blocked ? t.blockedReason : t.description}
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2 pt-0.5">
                                        {blocked && !active && (
                                            <span className="text-[10px] text-muted">not ready</span>
                                        )}
                                        {/* radio 永远可点：选中它是「我要用这个后端」，选不中就等于
                                            用户永远看不到该后端的配置字段（server 的 URL 曾经因此完全
                                            无法触达 —— 死锁）。能不能真正生效由下面的配置项是否填全决定。 */}
                                        <input
                                            type="radio"
                                            name="commontext-sync-transport"
                                            aria-label={t.name}
                                            checked={active}
                                            onChange={() => patch({ transport: t.id })}
                                            className="h-4 w-4 cursor-pointer accent-accent"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── Baseline chooser (only while switching between two active transports) ── */}
                {baselinePending && (
                    <div
                        data-sync-baseline=""
                        className="mt-3 rounded border border-accent/40 bg-accent/5 p-3"
                    >
                        <div className="text-xs font-medium text-primary">
                            Switching from {stored.transport} to {draft.transport}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            Both sides already hold data, and their revision numbers come from different
                            transports so they cannot be compared. Pick which side to trust for items that
                            differ. Nothing is deleted either way.
                        </div>
                        <div className="mt-2 flex flex-not-wrap flex-wrap items-center gap-2">
                            <button
                                type="button"
                                data-sync-baseline-choice="local"
                                disabled={switching}
                                onClick={() => applyBaseline("local")}
                                className={cn(
                                    "h-7 rounded border border-border px-3 text-xs text-primary",
                                    switching ? "cursor-default opacity-50" : "cursor-pointer hover:bg-hover"
                                )}
                            >
                                This device wins
                            </button>
                            <button
                                type="button"
                                data-sync-baseline-choice="remote"
                                disabled={switching}
                                onClick={() => applyBaseline("remote")}
                                className={cn(
                                    "h-7 rounded border border-border px-3 text-xs text-primary",
                                    switching ? "cursor-default opacity-50" : "cursor-pointer hover:bg-hover"
                                )}
                            >
                                Remote wins
                            </button>
                            <button
                                type="button"
                                data-sync-baseline-choice="cancel"
                                disabled={switching}
                                onClick={() => {
                                    // Cancel reverts the transport selection to what is actually stored,
                                    // so Save cannot later slip past the chooser.
                                    setDraft((cur) => ({ ...cur, transport: stored.transport }));
                                    setBaselinePending(false);
                                    setStatus("");
                                }}
                                className="h-7 cursor-pointer rounded px-2 text-xs text-secondary hover:text-primary"
                            >
                                Cancel
                            </button>
                            <span className="text-[10.5px] text-muted">
                                {switching ? "Re-syncing…" : "Runs one full re-sync before saving"}
                            </span>
                        </div>
                        <div className="mt-2 text-[10.5px] text-muted">
                            This device wins — local items overwrite the remote; remote-only items are
                            pulled in. Remote wins — remote items overwrite local; local-only items are
                            pushed as new.
                        </div>
                    </div>
                )}

                {/* ── Backend config (only the selected transport) ──────── */}
                <GroupHeader
                    groupKey="backend"
                    label={
                        draft.transport === "folder"
                            ? "Local folder"
                            : draft.transport === "git"
                              ? "Git repository"
                              : draft.transport === "server"
                                ? "Self-hosted service"
                                : "Backend"
                    }
                    collapsed={isCollapsed("backend")}
                    onToggle={toggleGroup}
                />
                {!isCollapsed("backend") && (
                    <div className="divide-y divide-border">
                        {draft.transport === "folder" && (
                            <>
                                <Row
                                    title="File path"
                                    description="A commontext.json inside a synced folder. Writes go through a temp file + atomic rename, so a reader never sees half a file."
                                    rowKey="folder-path"
                                >
                                    <TextField
                                        ariaLabel="Sync file path"
                                        value={draft.folderPath}
                                        placeholder="~/OneDrive/Snorkeling/commontext.json"
                                        mono
                                        dataAttr="folder-path"
                                        onChange={(v) => patch({ folderPath: v })}
                                    />
                                </Row>
                                <Row
                                    title="Watch for external changes"
                                    description="Refresh the list when another device (or the cloud client) changes the file."
                                    rowKey="folder-watch"
                                >
                                    <Toggle
                                        checked={draft.folderWatch}
                                        aria-label="Watch for external changes"
                                        onChange={(v) => patch({ folderWatch: v })}
                                    />
                                </Row>
                            </>
                        )}
                        {draft.transport === "git" && (
                            <>
                                <Row
                                    title="Remote"
                                    description="Private repository. A failed push never blocks local use; the reason shows in the sync panel."
                                    rowKey="git-remote"
                                >
                                    <TextField
                                        ariaLabel="Git remote"
                                        value={draft.gitRemote}
                                        placeholder="git@github.com:you/snorkeling-sync.git"
                                        mono
                                        dataAttr="git-remote"
                                        onChange={(v) => patch({ gitRemote: v })}
                                    />
                                </Row>
                                <Row
                                    title="Access token"
                                    description={
                                        draft.gitHasToken
                                            ? "Configured. The token lives in the OS keyring; settings.json only stores hastoken: true."
                                            : "Stored in the OS keyring, never in settings.json."
                                    }
                                    rowKey="git-token"
                                >
                                    <button
                                        type="button"
                                        data-sync-action="git-token"
                                        onClick={() => patch({ gitHasToken: true })}
                                        className="h-7 cursor-pointer rounded border border-border px-3 text-xs text-primary hover:bg-hover"
                                    >
                                        {draft.gitHasToken ? "Replace token…" : "Configure token…"}
                                    </button>
                                </Row>
                                <Row
                                    title="Interval"
                                    description="Periodic commit + pull. Sync now in the status panel runs one immediately."
                                    rowKey="git-interval"
                                >
                                    <TextField
                                        ariaLabel="Git sync interval"
                                        value={draft.gitInterval}
                                        placeholder="15m"
                                        mono
                                        dataAttr="git-interval"
                                        onChange={(v) => patch({ gitInterval: v })}
                                    />
                                </Row>
                            </>
                        )}
                        {draft.transport === "server" && (
                            <>
                                <Row
                                    title="Server URL"
                                    description="Include the scheme. For a LAN server use http://192.168.1.10:8787 and enable Allow insecure below."
                                    rowKey="server-url"
                                >
                                    <TextField
                                        ariaLabel="Server URL"
                                        value={draft.serverUrl}
                                        placeholder="https://sync.example.com"
                                        mono
                                        dataAttr="server-url"
                                        onChange={(v) => patch({ serverUrl: v })}
                                    />
                                </Row>
                                <Row
                                    title="Token"
                                    description={
                                        draft.serverHasToken
                                            ? "Configured. The token lives in the OS keyring; settings.json only stores hastoken: true."
                                            : "Server auth token, stored in the OS keyring."
                                    }
                                    rowKey="server-token"
                                >
                                    <button
                                        type="button"
                                        data-sync-action="server-token"
                                        onClick={() => patch({ serverHasToken: true })}
                                        className="h-7 cursor-pointer rounded border border-border px-3 text-xs text-primary hover:bg-hover"
                                    >
                                        {draft.serverHasToken ? "Replace token…" : "Configure token…"}
                                    </button>
                                </Row>
                                <Row
                                    title="Push mode"
                                    description="Realtime uses WebSocket when available and falls back to polling."
                                    rowKey="server-pushmode"
                                >
                                    <TextField
                                        ariaLabel="Push mode"
                                        value={draft.serverPushMode}
                                        placeholder="realtime"
                                        mono
                                        dataAttr="server-pushmode"
                                        onChange={(v) => patch({ serverPushMode: v })}
                                    />
                                </Row>
                                <Row
                                    title="Allow insecure http://"
                                    description="Permits plaintext connections (LAN or self-signed). Keep this off on the public internet."
                                    rowKey="server-insecure"
                                >
                                    <Toggle
                                        checked={draft.serverInsecure}
                                        aria-label="Allow insecure http"
                                        onChange={(v) => patch({ serverInsecure: v })}
                                    />
                                </Row>
                            </>
                        )}
                        {draft.transport === "none" && (
                            <Row
                                title="Local only"
                                description="No transport is configured. Items live in the local database and nothing is uploaded."
                                rowKey="none-note"
                            >
                                <span />
                            </Row>
                        )}
                    </div>
                )}

                {/* ── This computer ─────────────────────────────────────── */}
                <GroupHeader
                    groupKey="device"
                    label="This computer"
                    collapsed={isCollapsed("device")}
                    onToggle={toggleGroup}
                />
                {!isCollapsed("device") && (
                    <div className="divide-y divide-border">
                        <Row
                            title="Name"
                            description="Shown as the Computer of new items. Renaming does not rewrite history: old items keep the name they were created with."
                            rowKey="device-name"
                        >
                            <TextField
                                ariaLabel="Device name"
                                value={draft.deviceName}
                                placeholder="Defaults to the hostname"
                                dataAttr="device-name"
                                onChange={(v) => patch({ deviceName: v })}
                            />
                        </Row>
                        <Row
                            title="Device ID"
                            description="Generated once and never changes, so a renamed machine is still recognized as the same device."
                            rowKey="device-id"
                        >
                            <span
                                data-sync-field="device-id"
                                className="font-mono text-xs text-secondary"
                                title={typeof deviceId === "string" ? deviceId : ""}
                            >
                                {typeof deviceId === "string" && deviceId !== "" ? deviceId : "—"}
                            </span>
                        </Row>
                    </div>
                )}

                {/* ── Conflicts ─────────────────────────────────────────── */}
                <GroupHeader
                    groupKey="conflict"
                    label="Conflicts"
                    collapsed={isCollapsed("conflict")}
                    onToggle={toggleGroup}
                />
                {!isCollapsed("conflict") && (
                    <div className="divide-y divide-border">
                        {(
                            [
                                {
                                    id: "row-merge",
                                    title: "Merge per row, mark only real conflicts",
                                    description: "Auto-merge when possible; only a same-field double edit becomes a conflict.",
                                    recommended: true,
                                },
                                {
                                    id: "newest",
                                    title: "Newest wins",
                                    description: "Take the newer updatedat and silently overwrite the older side.",
                                },
                                {
                                    id: "manual",
                                    title: "Always ask",
                                    description: "Stop and ask on every conflict; syncing stays paused until resolved.",
                                },
                            ] as { id: SyncConflictPolicy; title: string; description: string; recommended?: boolean }[]
                        ).map((p) => (
                            <label
                                key={p.id}
                                data-sync-policy={p.id}
                                className="flex cursor-pointer items-start gap-4 py-3"
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                        <span className="text-sm text-primary">{p.title}</span>
                                        {p.recommended && (
                                            <span className="rounded-sm border border-accent/40 px-1 text-[9px] text-accent">
                                                recommended
                                            </span>
                                        )}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                        {p.description}
                                    </span>
                                </span>
                                <input
                                    type="radio"
                                    name="commontext-sync-policy"
                                    aria-label={p.title}
                                    checked={draft.conflictPolicy === p.id}
                                    onChange={() => patch({ conflictPolicy: p.id })}
                                    className="mt-0.5 h-4 w-4 cursor-pointer accent-accent"
                                />
                            </label>
                        ))}
                    </div>
                )}

                {/* ── Scope ─────────────────────────────────────────────── */}
                <GroupHeader
                    groupKey="scope"
                    label="Scope"
                    collapsed={isCollapsed("scope")}
                    onToggle={toggleGroup}
                />
                {!isCollapsed("scope") && (
                    <div className="divide-y divide-border">
                        <Row
                            title="Common Text"
                            description="This release syncs Common Text only. Other domains (settings, notes, sessions) are out of scope."
                            rowKey="scope-commontext"
                        >
                            <Toggle checked={true} disabled={true} aria-label="Common Text" onChange={() => {}} />
                        </Row>
                        <Row
                            title="Sync deletions (tombstones)"
                            description="When off, a delete stays local and the other machine pushes the item back."
                            rowKey="scope-tombstones"
                        >
                            <Toggle
                                checked={draft.syncTombstones}
                                aria-label="Sync deletions"
                                onChange={(v) => patch({ syncTombstones: v })}
                            />
                        </Row>
                    </div>
                )}

                {/* ── Status (live) ────────────────────────────────────── */}
                <GroupHeader
                    groupKey="status"
                    label="Status"
                    collapsed={isCollapsed("status")}
                    onToggle={toggleGroup}
                />
                {!isCollapsed("status") && (
                    <div className="divide-y divide-border" data-sync-live-status="">
                        <Row
                            title="Last sync"
                            description={
                                syncStatus == null
                                    ? "Reading status…"
                                    : syncStatus.lastError != null && syncStatus.lastError !== ""
                                      ? syncStatus.lastError
                                      : syncStatus.lastRunAt == null || syncStatus.lastRunAt === ""
                                        ? `No run yet — syncs every ${Math.round(syncStatus.intervalSeconds / 60)} min once configured.`
                                        : `pulled ${syncStatus.lastPulled ?? 0} · applied ${syncStatus.lastApplied ?? 0} · pushed ${syncStatus.lastPushed ?? 0}`
                            }
                            rowKey="status-last"
                        >
                            <span data-sync-status-time="" className="text-xs text-secondary">
                                {syncStatus?.lastRunAt ? formatSyncTime(syncStatus.lastRunAt) : "—"}
                            </span>
                        </Row>
                        <Row
                            title="Unresolved conflicts"
                            description={
                                (syncStatus?.conflicts ?? 0) > 0
                                    ? "Conflict details can be copied to an AI; nothing is overwritten. (CLI equivalent: `wsh commontext-sync conflicts --copy`.)"
                                    : "Nothing to resolve."
                            }
                            rowKey="status-conflicts"
                        >
                            {(syncStatus?.conflicts ?? 0) > 0 && (
                                <>
                                    <CopyForAgent
                                        title={`Copy all ${syncStatus?.conflicts ?? 0} conflicts for an AI to merge`}
                                        text={async () => {
                                            const resp = await CommonTextService.SyncConflictsCopy();
                                            return resp?.text ?? "";
                                        }}
                                    />
                                    <button
                                        type="button"
                                        data-sync-action="review-conflicts"
                                        onClick={() =>
                                            modalsModel.pushModal("SyncConflictModal", {
                                                onResolved: refreshSyncStatus,
                                            })
                                        }
                                        className="h-7 cursor-pointer rounded border border-border px-3 text-xs text-primary hover:bg-hover"
                                    >
                                        Review
                                    </button>
                                </>
                            )}
                            <span
                                data-sync-conflicts={(syncStatus?.conflicts ?? 0).toString()}
                                className={cn(
                                    "text-xs tabular-nums",
                                    (syncStatus?.conflicts ?? 0) > 0 ? "text-warning" : "text-secondary"
                                )}
                            >
                                {syncStatus?.conflicts ?? 0}
                            </span>
                        </Row>
                        <Row
                            title="Sync now"
                            description="Run one sync immediately instead of waiting for the timer."
                            rowKey="status-now"
                        >
                            <button
                                type="button"
                                data-sync-action="sync-now"
                                disabled={syncingNow}
                                onClick={() => void runSyncNow()}
                                className={cn(
                                    "h-7 rounded border border-border px-3 text-xs text-primary",
                                    syncingNow ? "cursor-default opacity-50" : "cursor-pointer hover:bg-hover"
                                )}
                            >
                                {syncingNow ? "Syncing…" : "Sync now"}
                            </button>
                        </Row>
                    </div>
                )}

                {/* ── Maintenance ───────────────────────────────────────── */}
                <GroupHeader
                    groupKey="maintenance"
                    label="Maintenance"
                    collapsed={isCollapsed("maintenance")}
                    onToggle={toggleGroup}
                />
                {!isCollapsed("maintenance") && (
                    <div className="divide-y divide-border">
                        <Row
                            title="Full re-sync"
                            description="Ignore the local cursor and reconcile the whole remote snapshot once."
                            rowKey="maint-resync"
                        >
                            <button
                                type="button"
                                data-sync-action="resync"
                                onClick={() => setStatus("Full re-sync queued. Progress shows in the sync panel.")}
                                className="h-7 cursor-pointer rounded border border-border px-3 text-xs text-primary hover:bg-hover"
                            >
                                Re-sync
                            </button>
                        </Row>
                        <Row
                            title="Reset sync state"
                            description="Clears the local cursor and rev cache only. Items and the remote file are untouched."
                            rowKey="maint-reset"
                        >
                            <button
                                type="button"
                                data-sync-action="reset"
                                onClick={() => setStatus("Reset clears the local cursor and rev cache only.")}
                                className="h-7 cursor-pointer rounded border border-border px-3 text-xs text-error hover:bg-hover"
                            >
                                Reset
                            </button>
                        </Row>
                    </div>
                )}
            </div>
        </div>
    );
});

SyncSettingsContent.displayName = "SyncSettingsContent";
