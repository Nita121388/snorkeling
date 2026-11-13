// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 🎭 Persona settings — a `waveconfig` visual panel (A5.5, design §3.5).
 *
 * Three things this panel deliberately does NOT do:
 *
 * 1. **It never moves files.** Repointing `persona:rootdir` only tells the app where to look; the
 *    persona homes stay on the old disk until `wsh persona relocate --yes` runs. A "move" button
 *    that half-finished (or that lied about what it moved) would be the worst kind of data-loss
 *    bug, so the panel prints the exact CLI command instead and lets the CLI do the move with its
 *    own per-directory verification and rollback.
 * 2. **It does not re-derive capacity.** `persona stats` owns the three buckets (archive /
 *    history / work, design §3.4); the panel renders whatever the RPC returns, so the settings
 *    numbers and `wsh persona stats --json` can never disagree.
 * 3. **It does not guess defaults.** The governance keys are Go `*bool` / `int` with `omitempty`:
 *    "unset" means "use the default", which is a different thing from an explicitly stored
 *    `false`. `readPersonaDraft()` resolves the default for display; `draftToSettingsPatch()`
 *    writes back exactly what the draft shows.
 *
 * Layout follows the de-densified settings rhythm (see `@/app/element/setting-card`): groups are
 * titles above surface cards, rows carry no dividers, exclusive choices are radio cards, and the
 * draft saves from exactly one place (`SaveBar`).
 */

import {
    RadioCard,
    RadioCardGroup,
    SaveBar,
    SettingButton,
    SettingGroup,
    SettingInput,
    SettingRow,
    SettingValue,
} from "@/app/element/setting-card";
import { Toggle } from "@/app/element/toggle";
import { atoms } from "@/app/store/global-atoms";
import { AISessionsService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

/** Default root (L0 of design §3.5): `pkg/persona.DefaultRootDir`. */
export const DefaultPersonaRoot = "~/.snorkeling/personas";

export const PersonaSettingKeys = {
    rootDir: "persona:rootdir",
    journalRotate: "persona:journalrotate",
    dormantDays: "persona:dormantdays",
    softLimitMb: "persona:softlimitmb",
    softLimitAction: "persona:softlimitaction",
} as const;

export type PersonaSoftLimitAction = "warn" | "warn-distill" | "readonly";

export type PersonaSettingsDraft = {
    /** Absolute path (or `~`-prefixed, which pkg/persona expands). Empty = default root. */
    rootDir: string;
    journalRotate: boolean;
    /** Kept as text so the field stays editable while the user retypes it. */
    dormantDays: string;
    softLimitMb: string;
    softLimitAction: PersonaSoftLimitAction;
};

export const PersonaSettingDefaults: PersonaSettingsDraft = {
    rootDir: "",
    journalRotate: true,
    dormantDays: "90",
    softLimitMb: "50",
    softLimitAction: "warn",
};

const SoftLimitActions: { id: PersonaSoftLimitAction; title: string; description: string }[] = [
    {
        id: "warn",
        title: "Warn only",
        description: "Show the size in the roster; the persona keeps working.",
    },
    {
        id: "warn-distill",
        title: "Warn and distill",
        description: "Warn, then fold old memory entries into the distilled summary.",
    },
    {
        id: "readonly",
        title: "Read only",
        description: "Block new memory writes until the persona is under the limit again.",
    },
];

const BytesUnits = ["B", "KB", "MB", "GB", "TB"] as const;

/** Bytes → `1.5 KB` / `5 MB`. One decimal below 100 so small buckets stay legible. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < BytesUnits.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    return `${rounded} ${BytesUnits[unit]}`;
}

/**
 * Root directory validation. Empty is legal (means "use the default root"), and so is a
 * `~`-prefixed path — `pkg/persona.expandHome` expands it server-side. Everything else relative
 * is rejected here, because a relative root would resolve against the app's cwd and silently
 * scatter persona homes.
 *
 * Writability cannot be checked from the renderer, so this is a shape check only; the CLI is the
 * layer that actually fails on a read-only target.
 */
export function validatePersonaRootDir(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return null;
    const windowsAbs = /^[A-Za-z]:[\\/]/.test(trimmed);
    const uncPath = trimmed.startsWith("\\\\");
    const posixAbs = trimmed.startsWith("/");
    if (windowsAbs || uncPath || posixAbs) return null;
    return "Root directory must be an absolute path (or empty for the default).";
}

/** `""` / `"abc"` / `"0"` / `"-3"` are rejected; the caller decides the label. */
export function validatePositiveInt(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === "") return "Enter a whole number.";
    if (!/^\d+$/.test(trimmed)) return "Enter a whole number (digits only).";
    if (Number(trimmed) <= 0) return "Enter a number greater than 0.";
    return null;
}

function parsePositiveInt(value: string): number | null {
    return validatePositiveInt(value) == null ? Number(value.trim()) : null;
}

/** Read the stored settings into a draft; unset keys fall back to the documented defaults. */
export function readPersonaDraft(settings: SettingsType | null | undefined): PersonaSettingsDraft {
    const s = (settings ?? {}) as Record<string, unknown>;
    const str = (key: string) => {
        const value = s[key];
        return typeof value === "string" ? value : "";
    };
    const num = (key: string, fallback: string) => {
        const value = s[key];
        return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
    };
    const rawAction = s[PersonaSettingKeys.softLimitAction];
    const softLimitAction: PersonaSoftLimitAction =
        rawAction === "warn-distill" || rawAction === "readonly" ? rawAction : "warn";
    return {
        rootDir: str(PersonaSettingKeys.rootDir),
        journalRotate:
            typeof s[PersonaSettingKeys.journalRotate] === "boolean"
                ? (s[PersonaSettingKeys.journalRotate] as boolean)
                : PersonaSettingDefaults.journalRotate,
        dormantDays: num(PersonaSettingKeys.dormantDays, PersonaSettingDefaults.dormantDays),
        softLimitMb: num(PersonaSettingKeys.softLimitMb, PersonaSettingDefaults.softLimitMb),
        softLimitAction,
    };
}

/** Draft → the settings keys to merge. Invalid numbers fall back to the default rather than NaN. */
export function draftToSettingsPatch(draft: PersonaSettingsDraft): Record<string, unknown> {
    return {
        [PersonaSettingKeys.rootDir]: draft.rootDir.trim(),
        [PersonaSettingKeys.journalRotate]: draft.journalRotate,
        [PersonaSettingKeys.dormantDays]:
            parsePositiveInt(draft.dormantDays) ?? Number(PersonaSettingDefaults.dormantDays),
        [PersonaSettingKeys.softLimitMb]:
            parsePositiveInt(draft.softLimitMb) ?? Number(PersonaSettingDefaults.softLimitMb),
        [PersonaSettingKeys.softLimitAction]: draft.softLimitAction,
    };
}

export type PersonaStorageTotals = {
    count: number;
    archiveBytes: number;
    historyBytes: number;
    workBytes: number;
    /** archive + history — the only part that crosses machines (design §3.4). */
    syncableBytes: number;
    totalBytes: number;
};

/** Sum the three buckets across every persona home. Missing/negative values count as 0. */
export function personaStorageTotals(personas: StorageStats[] | null | undefined): PersonaStorageTotals {
    const totals: PersonaStorageTotals = {
        count: 0,
        archiveBytes: 0,
        historyBytes: 0,
        workBytes: 0,
        syncableBytes: 0,
        totalBytes: 0,
    };
    for (const p of personas ?? []) {
        if (p == null) continue;
        const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
        totals.count += 1;
        totals.archiveBytes += n(p.archiveBytes);
        totals.historyBytes += n(p.historyBytes);
        totals.workBytes += n(p.workBytes);
        totals.syncableBytes += n(p.syncableBytes);
        totals.totalBytes += n(p.totalBytes);
    }
    return totals;
}

/**
 * The command the panel prints. It is a *preview* by default: relocate writes nothing without
 * `--yes`, and the target is the draft root so the user can see the path they are about to apply.
 */
export function personaRelocateCommand(rootDir: string, mode: "dry-run" | "apply" = "dry-run"): string {
    const trimmed = rootDir.trim();
    const target = trimmed === "" ? "<new-root>" : /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
    return `wsh persona relocate ${target} ${mode === "apply" ? "--yes" : "--dry-run"}`;
}

async function copyText(text: string): Promise<void> {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
        throw new Error("Clipboard unavailable in this environment.");
    }
    await navigator.clipboard.writeText(text);
}

export const PersonaSettingsContent = memo(({ model: _model }: { model: WaveConfigViewModel }) => {
    void _model;

    const settings = useAtomValue(atoms.settingsAtom);
    const stored = useMemo(() => readPersonaDraft(settings), [settings]);
    const [draft, setDraft] = useState<PersonaSettingsDraft>(stored);
    const [dirty, setDirty] = useState(false);
    const [status, setStatus] = useState("");
    const [stats, setStats] = useState<AISessionsPersonaStatsResponse | null>(null);
    const [statsError, setStatsError] = useState("");
    const [statsLoading, setStatsLoading] = useState(false);
    const [copyNotice, setCopyNotice] = useState("");

    // Re-sync the draft when the persisted values change and the user has no local edits — an
    // external settings write must not clobber typing, and typing must not be reverted by a
    // settings reload triggered by our own Save.
    useEffect(() => {
        if (dirty) return;
        setDraft(stored);
    }, [stored, dirty]);

    const patch = useCallback((next: Partial<PersonaSettingsDraft>) => {
        setDraft((cur) => ({ ...cur, ...next }));
        setDirty(true);
        setStatus("");
        setCopyNotice("");
    }, []);

    const refreshStats = useCallback(() => {
        setStatsLoading(true);
        fireAndForget(async () => {
            try {
                const resp = await AISessionsService.PersonaStats({});
                setStats(resp ?? null);
                setStatsError("");
            } catch (err) {
                // Capacity is informational; a failed stat must not break the settings panel.
                setStatsError(err instanceof Error ? err.message : String(err));
            } finally {
                setStatsLoading(false);
            }
        });
    }, []);

    useEffect(() => {
        refreshStats();
    }, [refreshStats]);

    const rootError = validatePersonaRootDir(draft.rootDir);
    const dormantError = validatePositiveInt(draft.dormantDays);
    const softLimitError = validatePositiveInt(draft.softLimitMb);
    const totals = useMemo(() => personaStorageTotals(stats?.personas), [stats]);
    const resolvedRoot = stats?.root != null && stats.root !== "" ? stats.root : stored.rootDir || DefaultPersonaRoot;
    const personas = useMemo(() => (stats?.personas ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)), [stats]);

    const save = useCallback(() => {
        const firstError = rootError ?? dormantError ?? softLimitError;
        if (firstError != null) {
            setStatus(firstError);
            return;
        }
        fireAndForget(async () => {
            try {
                await RpcApi.SetConfigCommand(TabRpcClient, draftToSettingsPatch(draft) as SettingsType);
                setDirty(false);
                setStatus("Saved.");
                refreshStats();
            } catch (err) {
                setStatus(err instanceof Error ? err.message : String(err));
            }
        });
    }, [draft, dormantError, refreshStats, rootError, softLimitError]);

    const discard = useCallback(() => {
        setDraft(stored);
        setDirty(false);
        setStatus("");
    }, [stored]);

    const copyCommand = useCallback(
        (mode: "dry-run" | "apply") => {
            fireAndForget(async () => {
                try {
                    await copyText(personaRelocateCommand(draft.rootDir, mode));
                    setCopyNotice(mode === "apply" ? "Apply command copied." : "Dry-run command copied.");
                } catch (err) {
                    setCopyNotice(err instanceof Error ? err.message : String(err));
                }
            });
        },
        [draft.rootDir]
    );

    const dryRunCommand = personaRelocateCommand(draft.rootDir, "dry-run");
    const applyCommand = personaRelocateCommand(draft.rootDir, "apply");

    return (
        <div className="h-full overflow-auto p-6" data-persona-settings="">
            <div className="max-w-[880px]">
                <p className="m-0 mb-7 max-w-[640px] text-[13.5px] leading-[1.55] text-muted-foreground">
                    Personas live in one root directory: a git-tracked home base each. Point that root at a bigger disk,
                    keep an eye on what syncs, and cap how far a single persona may grow.
                </p>

                {/* ── Root directory ─────────────────────────────────────── */}
                <SettingGroup title="Home base" extra={<span className="text-[11px] font-normal text-muted">L1</span>}>
                    <SettingRow
                        title="Persona root directory"
                        description={`Empty means the default (${DefaultPersonaRoot}). Must be an absolute path — a relative path would resolve against the app's working directory.`}
                        attrs={{ "data-persona-rootdir-row": "1" }}
                    >
                        {rootError != null && (
                            <SettingValue tone="warn" attrs={{ "data-persona-rootdir-error": "1" }}>
                                {rootError}
                            </SettingValue>
                        )}
                        <SettingInput
                            value={draft.rootDir}
                            onChange={(next) => patch({ rootDir: next })}
                            placeholder={DefaultPersonaRoot}
                            ariaLabel="Persona root directory"
                            mono
                            width="w-[360px]"
                            attrs={{ "data-persona-rootdir": "1" }}
                        />
                    </SettingRow>
                    <SettingRow
                        title="Currently resolved"
                        description="Where the app reads persona homes right now (saved value, not the draft above)."
                    >
                        <SettingValue mono attrs={{ "data-persona-resolved-root": "1" }}>
                            {resolvedRoot}
                        </SettingValue>
                    </SettingRow>
                </SettingGroup>

                {/* ── Capacity: three buckets, straight from persona stats ── */}
                <SettingGroup
                    title="Storage"
                    extra={
                        <span className="flex items-baseline gap-3">
                            <span className="text-[11px] font-normal text-muted">
                                {totals.count === 0
                                    ? "no personas"
                                    : `${totals.count} persona${totals.count === 1 ? "" : "s"}`}
                            </span>
                            <SettingButton
                                onClick={refreshStats}
                                disabled={statsLoading}
                                attrs={{ "data-persona-stats-refresh": "1" }}
                            >
                                {statsLoading ? "Measuring…" : "Refresh"}
                            </SettingButton>
                        </span>
                    }
                >
                    {statsError !== "" && (
                        <SettingRow title="Could not measure storage" description={statsError}>
                            <SettingValue tone="warn">unavailable</SettingValue>
                        </SettingRow>
                    )}
                    {personas.length === 0 ? (
                        <SettingRow
                            title="No personas yet"
                            description="Create one with `wsh persona create --name <name> --yes`, or let an agent propose one."
                        >
                            <SettingValue>—</SettingValue>
                        </SettingRow>
                    ) : (
                        <>
                            <SettingRow
                                title="Total"
                                description="archive + history are the only buckets that cross machines; work stays on this disk."
                            >
                                <SettingValue mono>{formatBytes(totals.archiveBytes)} archive</SettingValue>
                                <SettingValue mono>{formatBytes(totals.historyBytes)} history</SettingValue>
                                <SettingValue mono>{formatBytes(totals.workBytes)} work</SettingValue>
                                <SettingValue mono tone="ok">
                                    {formatBytes(totals.syncableBytes)} syncable
                                </SettingValue>
                            </SettingRow>
                            {personas.map((p) => (
                                <SettingRow
                                    key={p.id}
                                    title={p.id}
                                    description={`${p.archiveFiles + p.historyFiles + p.workFiles} files · ${formatBytes(p.totalBytes)} on disk`}
                                    attrs={{ "data-persona-stats-row": p.id }}
                                >
                                    <SettingValue mono>{formatBytes(p.archiveBytes)} archive</SettingValue>
                                    <SettingValue mono>{formatBytes(p.historyBytes)} history</SettingValue>
                                    <SettingValue mono>{formatBytes(p.workBytes)} work</SettingValue>
                                    <SettingValue mono tone="ok">
                                        {formatBytes(p.syncableBytes)} syncable
                                    </SettingValue>
                                </SettingRow>
                            ))}
                        </>
                    )}
                </SettingGroup>

                {/* ── Governance ─────────────────────────────────────────── */}
                <SettingGroup title="Storage governance">
                    <SettingRow
                        title="Rotate the journal by month"
                        description="Move journal lines from earlier months into MEMORY/archive/YYYY-MM.md; the live file keeps the current month only."
                    >
                        <Toggle
                            checked={draft.journalRotate}
                            onChange={(next) => patch({ journalRotate: next })}
                            label="Rotate by month"
                        />
                    </SettingRow>
                    <SettingRow
                        title="Dormant after"
                        description="Days without a shift before the roster flags a persona as dormant."
                    >
                        {dormantError != null && <SettingValue tone="warn">{dormantError}</SettingValue>}
                        <SettingInput
                            value={draft.dormantDays}
                            onChange={(next) => patch({ dormantDays: next })}
                            ariaLabel="Dormant after days"
                            width="w-20"
                            attrs={{ "data-persona-dormantdays": "1" }}
                        />
                        <SettingValue>days</SettingValue>
                    </SettingRow>
                    <SettingRow
                        title="Soft limit per persona"
                        description="A warning threshold, not a hard cap — nothing is deleted when a persona crosses it."
                    >
                        {softLimitError != null && <SettingValue tone="warn">{softLimitError}</SettingValue>}
                        <SettingInput
                            value={draft.softLimitMb}
                            onChange={(next) => patch({ softLimitMb: next })}
                            ariaLabel="Soft limit in MB"
                            width="w-20"
                            attrs={{ "data-persona-softlimitmb": "1" }}
                        />
                        <SettingValue>MB</SettingValue>
                    </SettingRow>
                    <div className="px-1 pb-3 pt-1">
                        <div className="mb-2 text-sm font-medium text-primary">When the soft limit is crossed</div>
                        <RadioCardGroup name="persona-softlimitaction">
                            {SoftLimitActions.map((action) => (
                                <RadioCard
                                    key={action.id}
                                    name="persona-softlimitaction"
                                    value={action.id}
                                    selected={draft.softLimitAction === action.id}
                                    onSelect={() => patch({ softLimitAction: action.id })}
                                    title={action.title}
                                    description={action.description}
                                    attrs={{ "data-persona-softlimitaction": action.id }}
                                />
                            ))}
                        </RadioCardGroup>
                    </div>
                </SettingGroup>

                {/* ── Migration: print the command, never run a destructive action ── */}
                <SettingGroup title="Move to a new location">
                    <SettingRow
                        title="Repointing does not move files"
                        description="Changing the root above only tells the app where to look; existing persona homes stay on the old disk. Run the dry-run first — it lists every directory and size and writes nothing."
                    >
                        <SettingButton
                            onClick={() => copyCommand("dry-run")}
                            attrs={{ "data-persona-copy-dryrun": "1" }}
                        >
                            Copy dry-run
                        </SettingButton>
                        <SettingButton onClick={() => copyCommand("apply")} attrs={{ "data-persona-copy-apply": "1" }}>
                            Copy apply
                        </SettingButton>
                    </SettingRow>
                    <div className="px-1 pb-3">
                        <code
                            className="block overflow-x-auto rounded-md border border-border bg-panel px-2.5 py-2 font-mono text-[11.5px] text-primary"
                            data-persona-relocate-command="dry-run"
                        >
                            {dryRunCommand}
                        </code>
                        <code
                            className="mt-1.5 block overflow-x-auto rounded-md border border-border bg-panel px-2.5 py-2 font-mono text-[11.5px] text-secondary"
                            data-persona-relocate-command="apply"
                        >
                            {applyCommand}
                        </code>
                        <p className="m-0 mt-2 max-w-[640px] text-[12px] leading-[1.5] text-muted-foreground">
                            Dry-run shows the plan; add <code className="font-mono">--yes</code> to apply (per-directory
                            move, file-count and byte check, rollback of the already-moved part on failure).{" "}
                            <code className="font-mono">--copy-not-move</code> keeps a copy at the old root. When{" "}
                            <code className="font-mono">PERSONA_ROOT</code> is set, settings are not rewritten — the env
                            var wins.
                        </p>
                    </div>
                </SettingGroup>

                <SaveBar
                    hint={status !== "" ? status : copyNotice}
                    dirty={dirty}
                    onSave={save}
                    onDiscard={discard}
                    attrs={{ "data-persona-savebar": "1" }}
                />
            </div>
        </div>
    );
});

PersonaSettingsContent.displayName = "PersonaSettingsContent";
