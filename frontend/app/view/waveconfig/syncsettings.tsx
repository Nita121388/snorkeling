// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Common Text cloud sync settings — a `waveconfig` visual panel.
 *
 * Layout: the de-densify rhythm from `design/prototypes/settings-density` — a group is a title
 * above a surface card (`SettingGroup`), rows inside the card carry no dividers, exclusive
 * choices are radio cards (`RadioCard`), low-frequency groups fold into one `AdvancedSection`,
 * and the draft saves from exactly one place (`SaveBar`).
 *
 * Four contracts worth keeping:
 *
 * 1. **Availability has exactly one source of truth** — `blockedReasonFor()`. The status panel
 *    in the compose modal renders the same judgement, so a transport can never look selectable
 *    in one place and greyed out in the other.
 * 2. **Radio cards are always clickable** — selecting one means "I want this backend"; making
 *    it unselectable would hide its config fields behind a deadlock (the server URL was once
 *    unreachable this way). Whether sync can actually run is the field's own business.
 * 3. **Editing is a draft** — nothing is written until Save. Group collapse state is a pure view
 *    preference and lives in localStorage, not in settings.json.
 * 4. **DOM hooks are load-bearing** — `data-sync-*` selectors are asserted by
 *    `scripts/verify/sync-diagnostics-copy`. Renaming any of them is a breaking change to that
 *    harness, not a refactor.
 */

import { buildAgentPayload, DIAGNOSIS_BRIEF, FIX_COMMAND_ONLY } from "@/app/element/agent-payload";
import { CopyForAgent } from "@/app/element/copy-for-agent";
import {
    AdvancedSection,
    RadioCard,
    RadioCardGroup,
    RadioRow,
    RadioRowGroup,
    SaveBar,
    SettingButton,
    SettingGroup,
    SettingInput,
    SettingRow,
    SettingSegmented,
    SettingValue,
    SignalBars,
    type SignalLevel,
} from "@/app/element/setting-card";
import { Toggle } from "@/app/element/toggle";
import { atoms } from "@/app/store/global-atoms";
import { modalsModel } from "@/app/store/modalmodel";
import { CommonTextService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn, fireAndForget } from "@/util/util";
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
        name: "Local folder",
        description: "commontext.json in a cloud-drive folder; picks up external changes.",
        recommended: true,
    },
    git: {
        name: "Git repository",
        description: "Private repo, periodic commits — real history, visible conflicts.",
    },
    server: {
        name: "Self-hosted service",
        description: "Your own sync server over HTTP/WebSocket, token auth.",
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

// 视图偏好（localStorage）：低频组默认收起，只有用户明确展开过才展开。
const AdvancedStorageKey = "commontext:syncSettings:collapsed";

// ── copy-for-agent payloads (sync diagnostics) ────────────────────────────────

/**
 * Last-sync failure payload. Events come pre-rendered by the backend (same lines
 * `wsh commontext-sync log` prints), so the pasted block reads like CLI output.
 */
export function buildSyncFailurePayload(status: Status, deviceName: string, lines: string[]): string {
    const contextLines = [
        `- transport: ${status.transport}`,
        `- device: ${deviceName || "(unnamed)"}`,
        `- last run: ${status.lastRunAt ?? "(never)"}`,
        `- interval: ${status.intervalSeconds}s`,
        `- last error: ${status.lastError}`,
        `- recent events (${lines.length}):`,
        ...lines.map((line) => `  ${line}`),
    ];
    return buildAgentPayload({
        context: contextLines.join("\n"),
        task: "Diagnose why the last sync run failed and name the smallest fix.",
        outputContract: DIAGNOSIS_BRIEF,
    });
}

/** Server-unreachable / not-ready payload: the evidence is the probe checks, not a command. */
export function buildProbePayload(resp: CommonTextSyncProbeResponse): string {
    const probe = resp.probe;
    const checks = (probe?.checks ?? []).map((c) =>
        c.fix != null && c.fix !== ""
            ? `  - ${c.id} ${c.state} — ${c.detail ?? ""}\n    fix: ${c.fix}`
            : `  - ${c.id} ${c.state} — ${c.detail ?? ""}`
    );
    const contextLines = [
        `- url: ${probe?.url ?? "(unset)"}`,
        `- state: ${probe?.ready ? "reachable but not ready" : "unreachable"}`,
        `- client protocol version: ${resp.clientProtocolVersion}`,
        `- checks:`,
        ...checks,
    ];
    return buildAgentPayload({
        context: contextLines.join("\n"),
        task: "Diagnose the unreachable sync server and name the smallest fix.",
        outputContract: FIX_COMMAND_ONLY,
    });
}

/** Protocol-incompatible payload: both versions + capabilities, so the agent can pick a side. */
export function buildProtocolMismatchPayload(resp: CommonTextSyncProbeResponse): string {
    const health = resp.probe?.health;
    const contextLines = [
        `- client protocol version: ${resp.clientProtocolVersion}`,
        `- server protocol version: ${health?.protocolVersion ?? "(unknown)"}`,
        `- server app version: ${health?.appVersion ?? "(unknown)"}`,
        `- server capabilities: ${(health?.capabilities ?? []).join(", ") || "(none reported)"}`,
    ];
    return buildAgentPayload({
        context: contextLines.join("\n"),
        task: "Decide which side must be upgraded for protocol compatibility.",
        outputContract: DIAGNOSIS_BRIEF,
    });
}

/** Protocol gate mirrors syncproto.Compatible(): a mismatch means the two sides cannot talk. */
export function isProtocolCompatible(resp: CommonTextSyncProbeResponse): boolean {
    const health = resp.probe?.health;
    if (health == null) return false;
    return health.protocolVersion === resp.clientProtocolVersion;
}

/**
 * Formats an RFC3339 timestamp from the backend. Falls back to the raw string when unparseable —
 * showing "Invalid Date" would be worse than showing the value the backend sent.
 */
function formatSyncTime(rfc3339: string): string {
    const ts = Date.parse(rfc3339);
    if (Number.isNaN(ts)) return rfc3339;
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Server health → signal level: 4 strong / 2 degraded / 0 unreachable / -1 not checked yet. */
export function signalLevelForProbe(resp: CommonTextSyncProbeResponse | null): SignalLevel {
    if (resp == null) return -1;
    if (resp.probe?.ready !== true) return 0;
    return isProtocolCompatible(resp) ? 4 : 2;
}

function loadAdvancedOpen(): boolean {
    try {
        const raw = localStorage.getItem(AdvancedStorageKey);
        const parsed = raw == null ? null : JSON.parse(raw);
        // 只认显式 true：缺省、旧格式、解析失败一律收起（低频组不应默认占屏）。
        return parsed != null && typeof parsed === "object" && (parsed as Record<string, unknown>).open === true;
    } catch {
        return false;
    }
}

function saveAdvancedOpen(open: boolean): void {
    try {
        localStorage.setItem(AdvancedStorageKey, JSON.stringify({ open }));
    } catch {
        // View preference only; a failed write must not break the settings panel.
    }
}

/** 展开态文案与 tone 都由 pendingCount 决定 —— 0 与未读数不共用一个视觉。 */
const ConflictPolicies = [
    {
        id: "row-merge" as const,
        title: "Merge per row, mark only real conflicts",
        description: "Auto-merge when possible; only a same-field double edit becomes a conflict.",
        recommended: true,
    },
    {
        id: "newest" as const,
        title: "Newest wins",
        description: "Take the newer updatedat and silently overwrite the older side.",
    },
    {
        id: "manual" as const,
        title: "Always ask",
        description: "Stop and ask on every conflict; syncing stays paused until resolved.",
    },
];

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
    const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => loadAdvancedOpen());
    // Sync diagnostics: latest probe (server transport only) and its in-flight state.
    const [probe, setProbe] = useState<CommonTextSyncProbeResponse | null>(null);
    const [probing, setProbing] = useState(false);

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

    const toggleAdvanced = useCallback(() => {
        setAdvancedOpen((cur) => {
            const next = !cur;
            saveAdvancedOpen(next);
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
                setStatus(blocked == null ? "Saved." : `Saved, but sync will not start: ${blocked}`);
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
                // 失败时 RPC 会 reject，面板拿不到返回体里的 lastError —— 必须重新拉一次
                // 状态，否则复制给 agent 的入口永远不出现（真机验证台 2026-11-10 实踩）。
                refreshSyncStatus();
            } finally {
                setSyncingNow(false);
            }
        });
    }, [syncingNow, refreshSyncStatus]);

    // Probe the configured sync server (same checks as `wsh commontext-sync doctor`). The probe
    // result is the evidence the Copy-for-agent payload is built from — a failed reachability or
    // protocol check is exactly the state a user cannot self-diagnose from the UI.
    const runProbe = useCallback(() => {
        if (probing) return;
        setProbing(true);
        fireAndForget(async () => {
            try {
                const resp = await CommonTextService.SyncProbe();
                setProbe(resp ?? null);
            } catch {
                // Probe is informational; keep the previous state and let the user retry.
            } finally {
                setProbing(false);
            }
        });
    }, [probing]);

    const transports = useMemo(() => buildTransportSpecs(draft), [draft]);
    const deviceId = (settings as Record<string, unknown> | undefined)?.[SyncSettingKeys.deviceId];
    const backendTitle =
        draft.transport === "folder"
            ? "Local folder"
            : draft.transport === "git"
              ? "Git repository"
              : draft.transport === "server"
                ? "Self-hosted service"
                : "Backend";

    // Server status 派生：信号格 + 四行健康数据全部来自一次 probe。
    const signalLevel = useMemo(() => signalLevelForProbe(probe), [probe]);
    const serverHealth = probe?.probe?.health;
    const serverRealtime = serverHealth?.capabilities?.includes("realtime") === true;
    const signalLabel =
        probe == null
            ? "not checked"
            : probe.probe?.ready !== true
              ? "unreachable"
              : isProtocolCompatible(probe)
                ? "reachable"
                : "protocol mismatch";
    const conflictsCount = syncStatus?.conflicts ?? 0;
    const pendingCount = syncStatus?.pending ?? 0;

    return (
        <div className="h-full overflow-auto p-6" data-sync-settings="">
            <div className="max-w-[880px]">
                <p className="m-0 mb-7 max-w-[640px] text-[13.5px] leading-[1.55] text-muted-foreground">
                    Common Text can sync across your machines — one transport, one copy of the data.
                </p>

                {/* ── Transport：RadioCard 2×2，卡永远可点 ───────────────── */}
                <SettingGroup
                    title="Transport"
                    extra={<span className="text-[11px] font-normal text-muted">single active</span>}
                >
                    <div className="py-2.5">
                        <RadioCardGroup name="commontext-sync-transport">
                            {transports.map((t) => {
                                const blocked = t.blockedReason != null;
                                const active = draft.transport === t.id;
                                return (
                                    <RadioCard
                                        key={t.id}
                                        name="commontext-sync-transport"
                                        value={t.id}
                                        selected={active}
                                        onSelect={(v) => patch({ transport: v as SyncTransportId })}
                                        title={t.name}
                                        description={t.description}
                                        flag={t.recommended ? "recommended" : undefined}
                                        warn={blocked ? t.blockedReason : undefined}
                                        attrs={{
                                            "data-sync-transport": t.id,
                                            "data-sync-transport-state": blocked
                                                ? "blocked"
                                                : active
                                                  ? "active"
                                                  : "available",
                                        }}
                                    />
                                );
                            })}
                        </RadioCardGroup>
                    </div>
                </SettingGroup>

                {/* ── Baseline chooser (only while switching between two active transports) ── */}
                {baselinePending && (
                    <div
                        data-sync-baseline=""
                        className="mb-8 rounded-[10px] border border-accent/40 bg-actionsoft/40 p-4"
                    >
                        <div className="text-[13px] font-medium text-primary">
                            Switching from {stored.transport} to {draft.transport}
                        </div>
                        <div className="mt-1 max-w-[560px] text-[12.5px] leading-[1.5] text-muted-foreground">
                            Both sides already hold data, and their revision numbers come from different transports so
                            they cannot be compared. Pick which side to trust for items that differ. Nothing is deleted
                            either way.
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <SettingButton
                                attrs={{ "data-sync-baseline-choice": "local" }}
                                disabled={switching}
                                onClick={() => applyBaseline("local")}
                            >
                                This device wins
                            </SettingButton>
                            <SettingButton
                                attrs={{ "data-sync-baseline-choice": "remote" }}
                                disabled={switching}
                                onClick={() => applyBaseline("remote")}
                            >
                                Remote wins
                            </SettingButton>
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
                                className="h-7 cursor-pointer rounded px-2 text-xs font-medium text-actionsofttext hover:underline"
                            >
                                Cancel
                            </button>
                            <span className="text-[11px] text-muted">
                                {switching ? "Re-syncing…" : "Runs one full re-sync before saving"}
                            </span>
                        </div>
                        <div className="mt-2 text-[11px] leading-[1.5] text-muted">
                            This device wins — local items overwrite the remote; remote-only items are pulled in. Remote
                            wins — remote items overwrite local; local-only items are pushed as new.
                        </div>
                    </div>
                )}

                {/* ── Backend (only the selected transport) ──────────────── */}
                <SettingGroup title={backendTitle} cardClassName="max-w-[880px]">
                    {draft.transport === "folder" && (
                        <>
                            <SettingRow
                                title="File path"
                                description="A commontext.json inside a synced folder. Writes go through a temp file + atomic rename, so a reader never sees half a file."
                                attrs={{ "data-sync-row": "folder-path" }}
                            >
                                <SettingInput
                                    ariaLabel="Sync file path"
                                    value={draft.folderPath}
                                    placeholder="~/OneDrive/Snorkeling/commontext.json"
                                    mono
                                    width="w-72"
                                    attrs={{ "data-sync-field": "folder-path" }}
                                    onChange={(v) => patch({ folderPath: v })}
                                />
                            </SettingRow>
                            <SettingRow
                                title="Watch for external changes"
                                description="Refresh the list when another device (or the cloud client) changes the file."
                                attrs={{ "data-sync-row": "folder-watch" }}
                            >
                                <Toggle
                                    checked={draft.folderWatch}
                                    aria-label="Watch for external changes"
                                    onChange={(v) => patch({ folderWatch: v })}
                                />
                            </SettingRow>
                        </>
                    )}
                    {draft.transport === "git" && (
                        <>
                            <SettingRow
                                title="Remote"
                                description="Private repository. A failed push never blocks local use; the reason shows in the sync panel."
                                attrs={{ "data-sync-row": "git-remote" }}
                            >
                                <SettingInput
                                    ariaLabel="Git remote"
                                    value={draft.gitRemote}
                                    placeholder="git@github.com:you/snorkeling-sync.git"
                                    mono
                                    width="w-72"
                                    attrs={{ "data-sync-field": "git-remote" }}
                                    onChange={(v) => patch({ gitRemote: v })}
                                />
                            </SettingRow>
                            <SettingRow
                                title="Access token"
                                description={
                                    draft.gitHasToken
                                        ? "Configured. The token lives in the OS keyring; settings.json only stores hastoken: true."
                                        : "Stored in the OS keyring, never in settings.json."
                                }
                                attrs={{ "data-sync-row": "git-token" }}
                            >
                                <SettingButton
                                    attrs={{ "data-sync-action": "git-token" }}
                                    onClick={() => patch({ gitHasToken: true })}
                                >
                                    {draft.gitHasToken ? "Replace token…" : "Configure token…"}
                                </SettingButton>
                            </SettingRow>
                            <SettingRow
                                title="Commit interval"
                                description="Periodic commit + pull. Sync now in the status panel runs one immediately."
                                attrs={{ "data-sync-row": "git-interval" }}
                            >
                                <SettingInput
                                    ariaLabel="Git sync interval"
                                    value={draft.gitInterval}
                                    placeholder="15m"
                                    mono
                                    width="w-20"
                                    attrs={{ "data-sync-field": "git-interval" }}
                                    onChange={(v) => patch({ gitInterval: v })}
                                />
                            </SettingRow>
                        </>
                    )}
                    {draft.transport === "server" && (
                        <>
                            <SettingRow
                                title="Server URL"
                                description="Include the scheme. For a LAN server use http://192.168.1.10:8787 and enable Allow insecure below."
                                attrs={{ "data-sync-row": "server-url" }}
                            >
                                <SettingInput
                                    ariaLabel="Server URL"
                                    value={draft.serverUrl}
                                    placeholder="https://sync.example.com"
                                    mono
                                    width="w-72"
                                    attrs={{ "data-sync-field": "server-url" }}
                                    onChange={(v) => patch({ serverUrl: v })}
                                />
                            </SettingRow>
                            <SettingRow
                                title="Token"
                                description={
                                    draft.serverHasToken
                                        ? "Configured. The token lives in the OS keyring; settings.json only stores hastoken: true."
                                        : "Server auth token, stored in the OS keyring."
                                }
                                attrs={{ "data-sync-row": "server-token" }}
                            >
                                <SettingButton
                                    attrs={{ "data-sync-action": "server-token" }}
                                    onClick={() => patch({ serverHasToken: true })}
                                >
                                    {draft.serverHasToken ? "Replace token…" : "Configure token…"}
                                </SettingButton>
                            </SettingRow>
                            <SettingRow
                                title="Push mode"
                                description="Realtime uses WebSocket when available and falls back to polling."
                                attrs={{ "data-sync-row": "server-pushmode" }}
                            >
                                <SettingSegmented
                                    ariaLabel="Push mode"
                                    value={draft.serverPushMode === "onsave" ? "onsave" : "realtime"}
                                    options={[
                                        { id: "realtime" as const, label: "Realtime" },
                                        { id: "onsave" as const, label: "On save" },
                                    ]}
                                    onChange={(next) => patch({ serverPushMode: next })}
                                />
                            </SettingRow>
                            <SettingRow
                                title="Allow insecure http://"
                                description="Permits plaintext connections (LAN or self-signed). Keep this off on the public internet."
                                attrs={{ "data-sync-row": "server-insecure" }}
                            >
                                <Toggle
                                    checked={draft.serverInsecure}
                                    aria-label="Allow insecure http"
                                    onChange={(v) => patch({ serverInsecure: v })}
                                />
                            </SettingRow>
                        </>
                    )}
                    {draft.transport === "none" && (
                        <SettingRow
                            title="Local only"
                            description="No transport is configured. Items live in the local database and nothing is uploaded."
                            attrs={{ "data-sync-row": "none-note" }}
                        />
                    )}
                </SettingGroup>

                {/* ── Server status（仅 Self-hosted service，数据 = 一次 probe）── */}
                {draft.transport === "server" && (
                    <SettingGroup
                        title={
                            <span className="flex items-center gap-2">
                                Server status
                                <SignalBars level={signalLevel} label={signalLabel} />
                            </span>
                        }
                    >
                        {serverHealth != null && (
                            <>
                                <SettingRow
                                    title="Version"
                                    description="Protocol version is the hard compatibility gate; app version is informational only."
                                >
                                    <SettingValue mono>
                                        app {serverHealth.appVersion} · protocol v{serverHealth.protocolVersion}
                                    </SettingValue>
                                </SettingRow>
                                <SettingRow
                                    title="Server data"
                                    description="Counted at the last check. Your local cursor sits behind until the next sync runs."
                                >
                                    <SettingValue>
                                        {serverHealth.items} items · rev {serverHealth.rev}
                                    </SettingValue>
                                </SettingRow>
                                <SettingRow
                                    title="Auth"
                                    description={`Capabilities: ${(serverHealth.capabilities ?? []).join(" · ") || "none reported"}.`}
                                >
                                    <SettingValue tone={probe?.probe?.ready === true ? "ok" : "warn"}>
                                        {probe?.probe?.ready === true ? "accepted" : "not verified"}
                                    </SettingValue>
                                </SettingRow>
                                <SettingRow
                                    title="Realtime push"
                                    description={
                                        serverRealtime
                                            ? "The server accepts WebSocket push; edits go out without waiting for a sync tick."
                                            : "Not implemented on the server transport yet — edits go out on save, or on the next tick."
                                    }
                                >
                                    <SettingValue tone={serverRealtime ? "ok" : "warn"}>
                                        {serverRealtime ? "supported" : "not supported"}
                                    </SettingValue>
                                </SettingRow>
                            </>
                        )}
                        {probe != null && probe.probe?.ready !== true && (
                            <SettingRow
                                title="Unreachable"
                                description={
                                    <>
                                        Could not connect to <span className="font-mono">{draft.serverUrl}</span>.
                                        Retries on the normal interval; local edits keep working.
                                    </>
                                }
                            >
                                <SettingValue tone="warn">offline</SettingValue>
                            </SettingRow>
                        )}
                        <SettingRow
                            title="Check"
                            description="Same checks the CLI runs — every failure carries an executable fix command (wsh commontext-sync doctor)."
                            attrs={{ "data-sync-row": "status-server" }}
                        >
                            {probe != null && (probe.probe?.ready !== true || !isProtocolCompatible(probe)) && (
                                <CopyForAgent
                                    title={
                                        probe.probe?.health != null && !isProtocolCompatible(probe)
                                            ? "Copy the protocol mismatch for an AI to resolve"
                                            : "Copy the server diagnostics for an AI to diagnose"
                                    }
                                    text={() =>
                                        Promise.resolve(
                                            probe.probe?.health != null && !isProtocolCompatible(probe)
                                                ? buildProtocolMismatchPayload(probe)
                                                : buildProbePayload(probe)
                                        )
                                    }
                                />
                            )}
                            <SettingButton
                                attrs={{ "data-sync-action": "probe-server" }}
                                disabled={probing}
                                onClick={runProbe}
                            >
                                {probing ? "Checking…" : "Check"}
                            </SettingButton>
                        </SettingRow>
                    </SettingGroup>
                )}

                {/* ── This device ───────────────────────────────────────── */}
                <SettingGroup title="This device">
                    <SettingRow
                        title="Device name"
                        description="Shown as the Computer of new items. Renaming does not rewrite history: old items keep the name they were created with."
                        attrs={{ "data-sync-row": "device-name" }}
                    >
                        <SettingInput
                            ariaLabel="Device name"
                            value={draft.deviceName}
                            placeholder="Defaults to the hostname"
                            width="w-72"
                            attrs={{ "data-sync-field": "device-name" }}
                            onChange={(v) => patch({ deviceName: v })}
                        />
                    </SettingRow>
                    <SettingRow
                        title="Device ID"
                        description="Generated once and never changes, so a renamed machine is still recognized as the same device."
                        attrs={{ "data-sync-row": "device-id" }}
                    >
                        <SettingValue
                            mono
                            title={typeof deviceId === "string" ? deviceId : ""}
                            attrs={{ "data-sync-field": "device-id" }}
                        >
                            {typeof deviceId === "string" && deviceId !== "" ? deviceId : "—"}
                        </SettingValue>
                    </SettingRow>
                </SettingGroup>

                {/* ── Status (live) ────────────────────────────────────── */}
                <SettingGroup
                    title="Status"
                    extra={
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-actionsofttext">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                            live
                        </span>
                    }
                >
                    <div data-sync-live-status="">
                        <SettingRow
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
                            attrs={{ "data-sync-row": "status-last" }}
                        >
                            {syncStatus != null && syncStatus.lastError != null && syncStatus.lastError !== "" && (
                                <CopyForAgent
                                    title="Copy the last sync failure for an AI to diagnose"
                                    text={async () => {
                                        const journal = await CommonTextService.SyncJournalTail({ n: 20 });
                                        return buildSyncFailurePayload(
                                            syncStatus,
                                            draft.deviceName,
                                            journal?.lines ?? []
                                        );
                                    }}
                                />
                            )}
                            <SettingValue attrs={{ "data-sync-status-time": "" }}>
                                {syncStatus?.lastRunAt ? formatSyncTime(syncStatus.lastRunAt) : "—"}
                            </SettingValue>
                        </SettingRow>
                        <SettingRow
                            title="Waiting to upload"
                            description="Items the remote has not confirmed yet; the next sync sends them. 0 means everything is uploaded."
                            attrs={{ "data-sync-row": "status-pending" }}
                        >
                            <SettingValue
                                tone={pendingCount > 0 ? "warn" : "ok"}
                                attrs={{ "data-sync-pending": String(pendingCount) }}
                            >
                                {pendingCount}
                            </SettingValue>
                        </SettingRow>
                        <SettingRow
                            title="Unresolved conflicts"
                            description={
                                conflictsCount > 0
                                    ? "Conflict details can be copied to an AI; nothing is overwritten. (CLI equivalent: `wsh commontext-sync conflicts --copy`.)"
                                    : "Nothing to resolve."
                            }
                            attrs={{ "data-sync-row": "status-conflicts" }}
                        >
                            {conflictsCount > 0 && (
                                <>
                                    <CopyForAgent
                                        title={`Copy all ${conflictsCount} conflicts for an AI to merge`}
                                        text={async () => {
                                            const resp = await CommonTextService.SyncConflictsCopy();
                                            return resp?.text ?? "";
                                        }}
                                    />
                                    <SettingButton
                                        attrs={{ "data-sync-action": "review-conflicts" }}
                                        onClick={() =>
                                            modalsModel.pushModal("SyncConflictModal", {
                                                onResolved: refreshSyncStatus,
                                            })
                                        }
                                    >
                                        Review
                                    </SettingButton>
                                </>
                            )}
                            <SettingValue
                                tone={conflictsCount > 0 ? "warn" : "default"}
                                attrs={{ "data-sync-conflicts": String(conflictsCount) }}
                            >
                                {conflictsCount}
                            </SettingValue>
                        </SettingRow>
                        <SettingRow
                            title="Sync now"
                            description="Run one sync immediately instead of waiting for the timer."
                            attrs={{ "data-sync-row": "status-now" }}
                        >
                            <SettingButton
                                attrs={{ "data-sync-action": "sync-now" }}
                                disabled={syncingNow}
                                onClick={() => void runSyncNow()}
                            >
                                {syncingNow ? "Syncing…" : "Sync now"}
                            </SettingButton>
                        </SettingRow>
                    </div>
                </SettingGroup>

                {/* ── Advanced：低频组收起，核心路径更短 ────────────────── */}
                <AdvancedSection
                    title="Advanced"
                    subtitle="conflicts · scope · maintenance"
                    open={advancedOpen}
                    onToggle={toggleAdvanced}
                    attrs={{ "data-sync-advanced": String(advancedOpen) }}
                >
                    <SettingGroup title="Conflicts" className="mb-6">
                        <RadioRowGroup name="commontext-sync-policy" className="py-1">
                            {ConflictPolicies.map((p) => (
                                <RadioRow
                                    key={p.id}
                                    name="commontext-sync-policy"
                                    value={p.id}
                                    selected={draft.conflictPolicy === p.id}
                                    onSelect={(v) => patch({ conflictPolicy: v as SyncConflictPolicy })}
                                    title={p.title}
                                    description={p.description}
                                    badge={
                                        p.recommended ? (
                                            <span className="rounded-full bg-actionsoft px-2 py-px text-[11px] font-medium text-actionsofttext">
                                                recommended
                                            </span>
                                        ) : undefined
                                    }
                                    attrs={{ "data-sync-policy": p.id }}
                                />
                            ))}
                        </RadioRowGroup>
                    </SettingGroup>
                    <SettingGroup title="Scope" className="mb-6">
                        <SettingRow
                            title="Common Text"
                            description="This release syncs Common Text only. Other domains (settings, notes, sessions) are out of scope."
                            disabled
                        >
                            <Toggle checked={true} disabled={true} aria-label="Common Text" onChange={() => {}} />
                        </SettingRow>
                        <SettingRow
                            title="Sync deletions (tombstones)"
                            description="When off, a delete stays local and the other machine pushes the item back."
                        >
                            <Toggle
                                checked={draft.syncTombstones}
                                aria-label="Sync deletions"
                                onChange={(v) => patch({ syncTombstones: v })}
                            />
                        </SettingRow>
                    </SettingGroup>
                    <SettingGroup title="Maintenance" className="mb-0">
                        <SettingRow
                            title="Full re-sync"
                            description="Ignore the local cursor and reconcile the whole remote snapshot once."
                        >
                            <SettingButton
                                attrs={{ "data-sync-action": "resync" }}
                                onClick={() => setStatus("Full re-sync queued. Progress shows in the sync panel.")}
                            >
                                Re-sync
                            </SettingButton>
                        </SettingRow>
                        <SettingRow
                            title="Reset sync state"
                            description="Clears the local cursor and rev cache only. Items and the remote file are untouched."
                        >
                            <SettingButton
                                tone="danger"
                                attrs={{ "data-sync-action": "reset" }}
                                onClick={() => setStatus("Reset clears the local cursor and rev cache only.")}
                            >
                                Reset
                            </SettingButton>
                        </SettingRow>
                    </SettingGroup>
                </AdvancedSection>

                {status !== "" && (
                    <div
                        data-sync-status=""
                        className={cn("mb-2 text-xs", status.startsWith("Saved.") ? "text-success" : "text-warning")}
                    >
                        {status}
                    </div>
                )}

                {/* ── 草稿面板唯一保存位置 ─────────────────────────────── */}
                <SaveBar
                    hint={dirty ? "Unsaved changes" : "Draft — nothing is written until Save."}
                    dirty={dirty}
                    onSave={save}
                    onDiscard={() => {
                        setDraft(stored);
                        setDirty(false);
                        setStatus("");
                    }}
                    attrs={{ "data-sync-save": "" }}
                />
            </div>
        </div>
    );
});

SyncSettingsContent.displayName = "SyncSettingsContent";
