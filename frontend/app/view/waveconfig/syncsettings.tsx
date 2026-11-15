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
import { i18n } from "@/i18n/config";
import { atoms } from "@/app/store/global-atoms";
import { modalsModel } from "@/app/store/modalmodel";
import { CommonTextService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
    nameKey: (typeof TransportMeta)[SyncTransportId]["nameKey"];
    descriptionKey: (typeof TransportMeta)[SyncTransportId]["descriptionKey"];
    /** Recommended badge in the picker. */
    recommended?: boolean;
    /** Why this transport cannot be selected right now (i18n key); null means selectable. */
    blockedReason?: SyncBlockedReasonKey | null;
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

const TransportMeta = {
    folder: {
        nameKey: "waveconfig:sync.transports.folder.name",
        descriptionKey: "waveconfig:sync.transports.folder.description",
        recommended: true,
    },
    git: {
        nameKey: "waveconfig:sync.transports.git.name",
        descriptionKey: "waveconfig:sync.transports.git.description",
    },
    server: {
        nameKey: "waveconfig:sync.transports.server.name",
        descriptionKey: "waveconfig:sync.transports.server.description",
    },
    none: {
        nameKey: "waveconfig:sync.transports.none.name",
        descriptionKey: "waveconfig:sync.transports.none.description",
    },
} as const;

/** Blocked-reason i18n keys — structural values, translated at the render site (Pattern C). */
export const SyncBlockedReasonKeys = {
    folderPath: "waveconfig:sync.blocked.folderPath",
    gitToken: "waveconfig:sync.blocked.gitToken",
    serverUrl: "waveconfig:sync.blocked.serverUrl",
    serverToken: "waveconfig:sync.blocked.serverToken",
    unknown: "waveconfig:sync.blocked.unknown",
} as const;
export type SyncBlockedReasonKey = (typeof SyncBlockedReasonKeys)[keyof typeof SyncBlockedReasonKeys];

/**
 * Why a transport cannot be picked right now, or null when it can.
 *
 * Deliberately accepts the draft rather than reading settings: while editing, the user must see
 * the row unlock the moment they fill in the missing field, without having to Save first.
 *
 * Returns an i18n key (not a display string) so the caller can translate at render time — a memo
 * on the draft must not freeze the language of an already-translated string.
 */
export function blockedReasonFor(transport: SyncTransportId, draft: SyncSettingsDraft): SyncBlockedReasonKey | null {
    switch (transport) {
        case "folder":
            return draft.folderPath.trim() === "" ? SyncBlockedReasonKeys.folderPath : null;
        case "git":
            return draft.gitHasToken ? null : SyncBlockedReasonKeys.gitToken;
        case "server":
            if (draft.serverUrl.trim() === "") return SyncBlockedReasonKeys.serverUrl;
            if (!draft.serverHasToken) return SyncBlockedReasonKeys.serverToken;
            return null;
        case "none":
            return null;
        default:
            return SyncBlockedReasonKeys.unknown;
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

/** 展开态文案与 tone 都由 pendingCount 决定 —— 0 与未读数不共用一个视觉。文案在渲染层由 i18n key 复原（Pattern C）。 */
const ConflictPolicies = [
    {
        id: "row-merge" as const,
        titleKey: "waveconfig:sync.advanced.policy.rowMerge.title",
        descriptionKey: "waveconfig:sync.advanced.policy.rowMerge.description",
        recommended: true,
    },
    {
        id: "newest" as const,
        titleKey: "waveconfig:sync.advanced.policy.newest.title",
        descriptionKey: "waveconfig:sync.advanced.policy.newest.description",
        recommended: false,
    },
    {
        id: "manual" as const,
        titleKey: "waveconfig:sync.advanced.policy.manual.title",
        descriptionKey: "waveconfig:sync.advanced.policy.manual.description",
        recommended: false,
    },
] as const;

export const SyncSettingsContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    void _model;

    const { t } = useTranslation("waveconfig");
    const settings = useAtomValue(atoms.settingsAtom);
    const stored = useMemo(() => readSyncDraft(settings), [settings]);
    const [draft, setDraft] = useState<SyncSettingsDraft>(stored);
    const [dirty, setDirty] = useState(false);
    const [status, setStatus] = useState("");
    // Tone of the status line. The text is translated, so "ok" can no longer be derived by
    // prefix-matching the string (the old check was `status.startsWith("Saved.")`).
    const [statusOk, setStatusOk] = useState(false);
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

    const setStatusMsg = useCallback((text: string, ok = false) => {
        setStatus(text);
        setStatusOk(ok);
    }, []);

    const patch = useCallback((next: Partial<SyncSettingsDraft>) => {
        setDraft((cur) => ({ ...cur, ...next }));
        setDirty(true);
        setStatusMsg("");
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
            setStatusMsg("");
            return;
        }
        fireAndForget(async () => {
            try {
                await RpcApi.SetConfigCommand(TabRpcClient, draftToSettingsPatch(draft) as SettingsType);
                setDirty(false);
                setStatusMsg(
                    blocked == null
                        ? i18n.t("waveconfig:sync.statusMsg.saved")
                        : i18n.t("waveconfig:sync.statusMsg.savedBlocked", { reason: i18n.t(blocked) }),
                    true
                );
                refreshSyncStatus();
            } catch (err) {
                setStatusMsg(err instanceof Error ? err.message : String(err));
            }
        });
    }, [draft, needsBaseline, refreshSyncStatus, setStatusMsg]);

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
                    setStatusMsg(
                        s?.lastError != null && s.lastError !== ""
                            ? i18n.t("waveconfig:sync.statusMsg.switchedWithError", { error: s.lastError })
                            : i18n.t("waveconfig:sync.statusMsg.switchedTo", { transport: draft.transport, winner: baseline })
                    );
                } catch (err) {
                    // The backend keeps the previous transport when the baseline sync fails, so the
                    // message must say that explicitly rather than looking like a plain failure.
                    setStatusMsg(
                        i18n.t("waveconfig:sync.statusMsg.switchAborted", {
                            error: err instanceof Error ? err.message : String(err),
                        })
                    );
                } finally {
                    setSwitching(false);
                }
            });
        },
        [draft, setStatusMsg]
    );

    const runSyncNow = useCallback(() => {
        if (syncingNow) return;
        setSyncingNow(true);
        fireAndForget(async () => {
            try {
                const resp = await CommonTextService.SyncNow({ trigger: "manual" });
                setSyncStatus(resp?.status ?? null);
                const s = resp?.status;
                setStatusMsg(
                    s == null
                        ? i18n.t("waveconfig:sync.statusMsg.syncFinished")
                        : s.lastError != null && s.lastError !== ""
                          ? i18n.t("waveconfig:sync.statusMsg.syncFailed", { error: s.lastError })
                          : i18n.t("waveconfig:sync.statusMsg.synced", {
                                pulled: s.lastPulled ?? 0,
                                applied: s.lastApplied ?? 0,
                                pushed: s.lastPushed ?? 0,
                            })
                );
            } catch (err) {
                setStatusMsg(err instanceof Error ? err.message : String(err));
                // 失败时 RPC 会 reject，面板拿不到返回体里的 lastError —— 必须重新拉一次
                // 状态，否则复制给 agent 的入口永远不出现（真机验证台 2026-11-10 实踩）。
                refreshSyncStatus();
            } finally {
                setSyncingNow(false);
            }
        });
    }, [syncingNow, refreshSyncStatus, setStatusMsg]);

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
            ? t("waveconfig:sync.transports.folder.name")
            : draft.transport === "git"
              ? t("waveconfig:sync.transports.git.name")
              : draft.transport === "server"
                ? t("waveconfig:sync.transports.server.name")
                : t("waveconfig:sync.backend.fallback");

    // Server status 派生：信号格 + 四行健康数据全部来自一次 probe。
    const signalLevel = useMemo(() => signalLevelForProbe(probe), [probe]);
    const serverHealth = probe?.probe?.health;
    const serverRealtime = serverHealth?.capabilities?.includes("realtime") === true;
    const signalLabel =
        probe == null
            ? t("waveconfig:sync.serverStatus.signal.notChecked")
            : probe.probe?.ready !== true
              ? t("waveconfig:sync.serverStatus.signal.unreachable")
              : isProtocolCompatible(probe)
                ? t("waveconfig:sync.serverStatus.signal.reachable")
                : t("waveconfig:sync.serverStatus.signal.protocolMismatch");
    const conflictsCount = syncStatus?.conflicts ?? 0;
    const pendingCount = syncStatus?.pending ?? 0;

    return (
        <div className="h-full overflow-auto p-6" data-sync-settings="">
            <div className="max-w-[880px]">
                <p className="m-0 mb-7 max-w-[640px] text-[13.5px] leading-[1.55] text-muted-foreground">
                    {t("waveconfig:sync.intro")}
                </p>

                {/* ── Transport：RadioCard 2×2，卡永远可点 ───────────────── */}
                <SettingGroup
                    title={t("waveconfig:sync.transport.title")}
                    extra={
                        <span className="text-[11px] font-normal text-muted">
                            {t("waveconfig:sync.transport.singleActive")}
                        </span>
                    }
                >
                    <div className="py-2.5">
                        <RadioCardGroup name="commontext-sync-transport">
                            {transports.map((spec) => {
                                const blocked = spec.blockedReason != null;
                                const active = draft.transport === spec.id;
                                return (
                                    <RadioCard
                                        key={spec.id}
                                        name="commontext-sync-transport"
                                        value={spec.id}
                                        selected={active}
                                        onSelect={(v) => patch({ transport: v as SyncTransportId })}
                                        title={t(spec.nameKey)}
                                        description={t(spec.descriptionKey)}
                                        flag={
                                            spec.recommended ? t("waveconfig:sync.transport.recommended") : undefined
                                        }
                                        warn={blocked ? t(spec.blockedReason) : undefined}
                                        attrs={{
                                            "data-sync-transport": spec.id,
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
                            {i18n.t("waveconfig:sync.baseline.switching", {
                                from: stored.transport,
                                to: draft.transport,
                            })}
                        </div>
                        <div className="mt-1 max-w-[560px] text-[12.5px] leading-[1.5] text-muted-foreground">
                            {t("waveconfig:sync.baseline.description")}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <SettingButton
                                attrs={{ "data-sync-baseline-choice": "local" }}
                                disabled={switching}
                                onClick={() => applyBaseline("local")}
                            >
                                {t("waveconfig:sync.baseline.localWins")}
                            </SettingButton>
                            <SettingButton
                                attrs={{ "data-sync-baseline-choice": "remote" }}
                                disabled={switching}
                                onClick={() => applyBaseline("remote")}
                            >
                                {t("waveconfig:sync.baseline.remoteWins")}
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
                                    setStatusMsg("");
                                }}
                                className="h-7 cursor-pointer rounded px-2 text-xs font-medium text-actionsofttext hover:underline"
                            >
                                {t("common:common.cancel")}
                            </button>
                            <span className="text-[11px] text-muted">
                                {switching
                                    ? t("waveconfig:sync.baseline.resyncing")
                                    : t("waveconfig:sync.baseline.runsNote")}
                            </span>
                        </div>
                        <div className="mt-2 text-[11px] leading-[1.5] text-muted">
                            {t("waveconfig:sync.baseline.explain")}
                        </div>
                    </div>
                )}

                {/* ── Backend (only the selected transport) ──────────────── */}
                <SettingGroup title={backendTitle} cardClassName="max-w-[880px]">
                    {draft.transport === "folder" && (
                        <>
                            <SettingRow
                                title={t("waveconfig:sync.backend.folder.filePathTitle")}
                                description={t("waveconfig:sync.backend.folder.filePathDescription")}
                                attrs={{ "data-sync-row": "folder-path" }}
                            >
                                <SettingInput
                                    ariaLabel={t("waveconfig:sync.backend.folder.filePathAria")}
                                    value={draft.folderPath}
                                    placeholder="~/OneDrive/Snorkeling/commontext.json"
                                    mono
                                    width="w-72"
                                    attrs={{ "data-sync-field": "folder-path" }}
                                    onChange={(v) => patch({ folderPath: v })}
                                />
                            </SettingRow>
                            <SettingRow
                                title={t("waveconfig:sync.backend.folder.watchTitle")}
                                description={t("waveconfig:sync.backend.folder.watchDescription")}
                                attrs={{ "data-sync-row": "folder-watch" }}
                            >
                                <Toggle
                                    checked={draft.folderWatch}
                                    aria-label={t("waveconfig:sync.backend.folder.watchAria")}
                                    onChange={(v) => patch({ folderWatch: v })}
                                />
                            </SettingRow>
                        </>
                    )}
                    {draft.transport === "git" && (
                        <>
                            <SettingRow
                                title={t("waveconfig:sync.backend.git.remoteTitle")}
                                description={t("waveconfig:sync.backend.git.remoteDescription")}
                                attrs={{ "data-sync-row": "git-remote" }}
                            >
                                <SettingInput
                                    ariaLabel={t("waveconfig:sync.backend.git.remoteAria")}
                                    value={draft.gitRemote}
                                    placeholder="git@github.com:you/snorkeling-sync.git"
                                    mono
                                    width="w-72"
                                    attrs={{ "data-sync-field": "git-remote" }}
                                    onChange={(v) => patch({ gitRemote: v })}
                                />
                            </SettingRow>
                            <SettingRow
                                title={t("waveconfig:sync.backend.git.tokenTitle")}
                                description={
                                    draft.gitHasToken
                                        ? t("waveconfig:sync.backend.git.tokenConfigured")
                                        : t("waveconfig:sync.backend.git.tokenNotConfigured")
                                }
                                attrs={{ "data-sync-row": "git-token" }}
                            >
                                <SettingButton
                                    attrs={{ "data-sync-action": "git-token" }}
                                    onClick={() => patch({ gitHasToken: true })}
                                >
                                    {draft.gitHasToken
                                        ? t("waveconfig:sync.backend.git.replaceToken")
                                        : t("waveconfig:sync.backend.git.configureToken")}
                                </SettingButton>
                            </SettingRow>
                            <SettingRow
                                title={t("waveconfig:sync.backend.git.intervalTitle")}
                                description={t("waveconfig:sync.backend.git.intervalDescription")}
                                attrs={{ "data-sync-row": "git-interval" }}
                            >
                                <SettingInput
                                    ariaLabel={t("waveconfig:sync.backend.git.intervalAria")}
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
                                title={t("waveconfig:sync.backend.server.urlTitle")}
                                description={t("waveconfig:sync.backend.server.urlDescription")}
                                attrs={{ "data-sync-row": "server-url" }}
                            >
                                <SettingInput
                                    ariaLabel={t("waveconfig:sync.backend.server.urlAria")}
                                    value={draft.serverUrl}
                                    placeholder="https://sync.example.com"
                                    mono
                                    width="w-72"
                                    attrs={{ "data-sync-field": "server-url" }}
                                    onChange={(v) => patch({ serverUrl: v })}
                                />
                            </SettingRow>
                            <SettingRow
                                title={t("waveconfig:sync.backend.server.tokenTitle")}
                                description={
                                    draft.serverHasToken
                                        ? t("waveconfig:sync.backend.server.tokenConfigured")
                                        : t("waveconfig:sync.backend.server.tokenNotConfigured")
                                }
                                attrs={{ "data-sync-row": "server-token" }}
                            >
                                <SettingButton
                                    attrs={{ "data-sync-action": "server-token" }}
                                    onClick={() => patch({ serverHasToken: true })}
                                >
                                    {draft.serverHasToken
                                        ? t("waveconfig:sync.backend.server.replaceToken")
                                        : t("waveconfig:sync.backend.server.configureToken")}
                                </SettingButton>
                            </SettingRow>
                            <SettingRow
                                title={t("waveconfig:sync.backend.server.pushModeTitle")}
                                description={t("waveconfig:sync.backend.server.pushModeDescription")}
                                attrs={{ "data-sync-row": "server-pushmode" }}
                            >
                                <SettingSegmented
                                    ariaLabel={t("waveconfig:sync.backend.server.pushModeAria")}
                                    value={draft.serverPushMode === "onsave" ? "onsave" : "realtime"}
                                    options={[
                                        { id: "realtime" as const, label: t("waveconfig:sync.backend.server.pushModeRealtime") },
                                        { id: "onsave" as const, label: t("waveconfig:sync.backend.server.pushModeOnSave") },
                                    ]}
                                    onChange={(next) => patch({ serverPushMode: next })}
                                />
                            </SettingRow>
                            <SettingRow
                                title={t("waveconfig:sync.backend.server.insecureTitle")}
                                description={t("waveconfig:sync.backend.server.insecureDescription")}
                                attrs={{ "data-sync-row": "server-insecure" }}
                            >
                                <Toggle
                                    checked={draft.serverInsecure}
                                    aria-label={t("waveconfig:sync.backend.server.insecureAria")}
                                    onChange={(v) => patch({ serverInsecure: v })}
                                />
                            </SettingRow>
                        </>
                    )}
                    {draft.transport === "none" && (
                        <SettingRow
                            title={t("waveconfig:sync.backend.none.title")}
                            description={t("waveconfig:sync.backend.none.description")}
                            attrs={{ "data-sync-row": "none-note" }}
                        />
                    )}
                </SettingGroup>

                {/* ── Server status（仅 Self-hosted service，数据 = 一次 probe）── */}
                {draft.transport === "server" && (
                    <SettingGroup
                        title={
                            <span className="flex items-center gap-2">
                                {t("waveconfig:sync.serverStatus.title")}
                                <SignalBars level={signalLevel} label={signalLabel} />
                            </span>
                        }
                    >
                        {serverHealth != null && (
                            <>
                                <SettingRow
                                    title={t("waveconfig:sync.serverStatus.versionTitle")}
                                    description={t("waveconfig:sync.serverStatus.versionDescription")}
                                >
                                    <SettingValue mono>
                                        {i18n.t("waveconfig:sync.serverStatus.versionValue", {
                                            app: serverHealth.appVersion,
                                            protocol: serverHealth.protocolVersion,
                                        })}
                                    </SettingValue>
                                </SettingRow>
                                <SettingRow
                                    title={t("waveconfig:sync.serverStatus.dataTitle")}
                                    description={t("waveconfig:sync.serverStatus.dataDescription")}
                                >
                                    <SettingValue>
                                        {i18n.t("waveconfig:sync.serverStatus.dataValue", {
                                            items: serverHealth.items,
                                            rev: serverHealth.rev,
                                        })}
                                    </SettingValue>
                                </SettingRow>
                                <SettingRow
                                    title={t("waveconfig:sync.serverStatus.authTitle")}
                                    description={i18n.t("waveconfig:sync.serverStatus.authDescription", {
                                        capabilities:
                                            (serverHealth.capabilities ?? []).join(" · ") ||
                                            t("waveconfig:sync.serverStatus.authNoneReported"),
                                    })}
                                >
                                    <SettingValue tone={probe?.probe?.ready === true ? "ok" : "warn"}>
                                        {probe?.probe?.ready === true
                                            ? t("waveconfig:sync.serverStatus.authAccepted")
                                            : t("waveconfig:sync.serverStatus.authNotVerified")}
                                    </SettingValue>
                                </SettingRow>
                                <SettingRow
                                    title={t("waveconfig:sync.serverStatus.realtimeTitle")}
                                    description={
                                        serverRealtime
                                            ? t("waveconfig:sync.serverStatus.realtimeSupportedDesc")
                                            : t("waveconfig:sync.serverStatus.realtimeUnsupportedDesc")
                                    }
                                >
                                    <SettingValue tone={serverRealtime ? "ok" : "warn"}>
                                        {serverRealtime
                                            ? t("waveconfig:sync.serverStatus.realtimeSupported")
                                            : t("waveconfig:sync.serverStatus.realtimeUnsupported")}
                                    </SettingValue>
                                </SettingRow>
                            </>
                        )}
                        {probe != null && probe.probe?.ready !== true && (
                            <SettingRow
                                title={t("waveconfig:sync.serverStatus.unreachableTitle")}
                                description={
                                    <>
                                        {t("waveconfig:sync.serverStatus.unreachablePrefix")}{" "}
                                        <span className="font-mono">{draft.serverUrl}</span>
                                        {t("waveconfig:sync.serverStatus.unreachableSuffix")}
                                    </>
                                }
                            >
                                <SettingValue tone="warn">{t("waveconfig:sync.serverStatus.offline")}</SettingValue>
                            </SettingRow>
                        )}
                        <SettingRow
                            title={t("waveconfig:sync.serverStatus.checkTitle")}
                            description={t("waveconfig:sync.serverStatus.checkDescription")}
                            attrs={{ "data-sync-row": "status-server" }}
                        >
                            {probe != null && (probe.probe?.ready !== true || !isProtocolCompatible(probe)) && (
                                <CopyForAgent
                                    title={
                                        probe.probe?.health != null && !isProtocolCompatible(probe)
                                            ? t("waveconfig:sync.serverStatus.copyProtocolMismatch")
                                            : t("waveconfig:sync.serverStatus.copyDiagnostics")
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
                                {probing
                                    ? t("waveconfig:sync.serverStatus.checking")
                                    : t("waveconfig:sync.serverStatus.check")}
                            </SettingButton>
                        </SettingRow>
                    </SettingGroup>
                )}

                {/* ── This device ───────────────────────────────────────── */}
                <SettingGroup title={t("waveconfig:sync.device.title")}>
                    <SettingRow
                        title={t("waveconfig:sync.device.nameTitle")}
                        description={t("waveconfig:sync.device.nameDescription")}
                        attrs={{ "data-sync-row": "device-name" }}
                    >
                        <SettingInput
                            ariaLabel={t("waveconfig:sync.device.nameAria")}
                            value={draft.deviceName}
                            placeholder={t("waveconfig:sync.device.namePlaceholder")}
                            width="w-72"
                            attrs={{ "data-sync-field": "device-name" }}
                            onChange={(v) => patch({ deviceName: v })}
                        />
                    </SettingRow>
                    <SettingRow
                        title={t("waveconfig:sync.device.idTitle")}
                        description={t("waveconfig:sync.device.idDescription")}
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
                    title={t("waveconfig:sync.live.title")}
                    extra={
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-actionsofttext">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                            {t("waveconfig:sync.live.badge")}
                        </span>
                    }
                >
                    <div data-sync-live-status="">
                        <SettingRow
                            title={t("waveconfig:sync.live.lastSyncTitle")}
                            description={
                                syncStatus == null
                                    ? t("waveconfig:sync.live.readingStatus")
                                    : syncStatus.lastError != null && syncStatus.lastError !== ""
                                      ? syncStatus.lastError
                                      : syncStatus.lastRunAt == null || syncStatus.lastRunAt === ""
                                        ? i18n.t("waveconfig:sync.live.noRunYet", {
                                              minutes: Math.round(syncStatus.intervalSeconds / 60),
                                          })
                                        : i18n.t("waveconfig:sync.live.summary", {
                                              pulled: syncStatus.lastPulled ?? 0,
                                              applied: syncStatus.lastApplied ?? 0,
                                              pushed: syncStatus.lastPushed ?? 0,
                                          })
                            }
                            attrs={{ "data-sync-row": "status-last" }}
                        >
                            {syncStatus != null && syncStatus.lastError != null && syncStatus.lastError !== "" && (
                                <CopyForAgent
                                    title={t("waveconfig:sync.live.copyFailureTitle")}
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
                            title={t("waveconfig:sync.live.pendingTitle")}
                            description={t("waveconfig:sync.live.pendingDescription")}
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
                            title={t("waveconfig:sync.live.conflictsTitle")}
                            description={
                                conflictsCount > 0
                                    ? t("waveconfig:sync.live.conflictsDescriptionSome")
                                    : t("waveconfig:sync.live.conflictsDescriptionNone")
                            }
                            attrs={{ "data-sync-row": "status-conflicts" }}
                        >
                            {conflictsCount > 0 && (
                                <>
                                    <CopyForAgent
                                        title={i18n.t("waveconfig:sync.live.copyConflictsTitle", {
                                            count: conflictsCount,
                                        })}
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
                                        {t("waveconfig:sync.live.review")}
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
                            title={t("waveconfig:sync.live.nowTitle")}
                            description={t("waveconfig:sync.live.nowDescription")}
                            attrs={{ "data-sync-row": "status-now" }}
                        >
                            <SettingButton
                                attrs={{ "data-sync-action": "sync-now" }}
                                disabled={syncingNow}
                                onClick={() => void runSyncNow()}
                            >
                                {syncingNow
                                    ? t("waveconfig:sync.live.syncing")
                                    : t("waveconfig:sync.live.syncNow")}
                            </SettingButton>
                        </SettingRow>
                    </div>
                </SettingGroup>

                {/* ── Advanced：低频组收起，核心路径更短 ────────────────── */}
                <AdvancedSection
                    title={t("waveconfig:sync.advanced.title")}
                    subtitle={t("waveconfig:sync.advanced.subtitle")}
                    open={advancedOpen}
                    onToggle={toggleAdvanced}
                    attrs={{ "data-sync-advanced": String(advancedOpen) }}
                >
                    <SettingGroup title={t("waveconfig:sync.advanced.conflictsTitle")} className="mb-6">
                        <RadioRowGroup name="commontext-sync-policy" className="py-1">
                            {ConflictPolicies.map((p) => (
                                <RadioRow
                                    key={p.id}
                                    name="commontext-sync-policy"
                                    value={p.id}
                                    selected={draft.conflictPolicy === p.id}
                                    onSelect={(v) => patch({ conflictPolicy: v as SyncConflictPolicy })}
                                    title={t(p.titleKey)}
                                    description={t(p.descriptionKey)}
                                    badge={
                                        p.recommended ? (
                                            <span className="rounded-full bg-actionsoft px-2 py-px text-[11px] font-medium text-actionsofttext">
                                                {t("waveconfig:sync.advanced.recommended")}
                                            </span>
                                        ) : undefined
                                    }
                                    attrs={{ "data-sync-policy": p.id }}
                                />
                            ))}
                        </RadioRowGroup>
                    </SettingGroup>
                    <SettingGroup title={t("waveconfig:sync.advanced.scopeTitle")} className="mb-6">
                        <SettingRow
                            title={t("waveconfig:sync.advanced.scopeCommonTextTitle")}
                            description={t("waveconfig:sync.advanced.scopeCommonTextDescription")}
                            disabled
                        >
                            <Toggle
                                checked={true}
                                disabled={true}
                                aria-label={t("waveconfig:sync.advanced.scopeCommonTextAria")}
                                onChange={() => {}}
                            />
                        </SettingRow>
                        <SettingRow
                            title={t("waveconfig:sync.advanced.tombstonesTitle")}
                            description={t("waveconfig:sync.advanced.tombstonesDescription")}
                        >
                            <Toggle
                                checked={draft.syncTombstones}
                                aria-label={t("waveconfig:sync.advanced.tombstonesAria")}
                                onChange={(v) => patch({ syncTombstones: v })}
                            />
                        </SettingRow>
                    </SettingGroup>
                    <SettingGroup title={t("waveconfig:sync.advanced.maintenanceTitle")} className="mb-0">
                        <SettingRow
                            title={t("waveconfig:sync.advanced.resyncTitle")}
                            description={t("waveconfig:sync.advanced.resyncDescription")}
                        >
                            <SettingButton
                                attrs={{ "data-sync-action": "resync" }}
                                onClick={() =>
                                    setStatusMsg(i18n.t("waveconfig:sync.statusMsg.resyncQueued"))
                                }
                            >
                                {t("waveconfig:sync.advanced.resyncButton")}
                            </SettingButton>
                        </SettingRow>
                        <SettingRow
                            title={t("waveconfig:sync.advanced.resetTitle")}
                            description={t("waveconfig:sync.advanced.resetDescription")}
                        >
                            <SettingButton
                                tone="danger"
                                attrs={{ "data-sync-action": "reset" }}
                                onClick={() => setStatusMsg(i18n.t("waveconfig:sync.statusMsg.resetNote"))}
                            >
                                {t("waveconfig:sync.advanced.resetButton")}
                            </SettingButton>
                        </SettingRow>
                    </SettingGroup>
                </AdvancedSection>

                {status !== "" && (
                    <div
                        data-sync-status=""
                        className={cn("mb-2 text-xs", statusOk ? "text-success" : "text-warning")}
                    >
                        {status}
                    </div>
                )}

                {/* ── 草稿面板唯一保存位置 ─────────────────────────────── */}
                <SaveBar
                    hint={
                        dirty
                            ? t("waveconfig:sync.savebar.unsaved")
                            : t("waveconfig:sync.savebar.draft")
                    }
                    dirty={dirty}
                    onSave={save}
                    onDiscard={() => {
                        setDraft(stored);
                        setDirty(false);
                        setStatusMsg("");
                    }}
                    attrs={{ "data-sync-save": "" }}
                />
            </div>
        </div>
    );
});

SyncSettingsContent.displayName = "SyncSettingsContent";
