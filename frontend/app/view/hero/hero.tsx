// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero roster block (A4, design §6): "who is on shift, how much does each
// remember, what is waiting for approval".
//
// Left column  = one row per hero directory (emoji + name + role +
//                provider/model + last journal line + pending proposal count).
// Right column = CHARTER full text, capacity buckets, pending proposals with
//                copyable CLI commands, and the [叫TA登场] launch action.
//
// Data comes from a single read-only RPC (`aisessions.HeroOverview`) that
// shares root resolution with HeroRoster/HeroStats, so the roster count
// equals the number of hero dirs on disk. Launching reuses the A3 pipeline
// (buildHeroLaunchBlockDef) and deliberately does NOT inject a main workdir:
// the roster has no "today's project" semantics.

import { globalStore } from "@/app/store/jotaiStore";
import type { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { buildHeroLaunchBlockDef } from "@/app/workspace/hero-launch";
import { copyText } from "@/util/clipboard";
import { fireAndForget, isBlank } from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import {
    EmptyCharterText,
    EmptyJournalText,
    HeroCreateCommand,
    deriveRosterRows,
    emptyStateText,
    formatBytes,
    heroApproveCommand,
    heroHomeBaseHint,
    heroInboxCommand,
    roleLine,
    type HeroRosterRow,
} from "./hero-model";

export type HeroEnv = WaveEnvSubset<{
    services: {
        aisessions: {
            HeroOverview: WaveEnv["services"]["aisessions"]["HeroOverview"];
        };
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    createBlock: WaveEnv["createBlock"];
}>;

export class HeroViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    env: HeroEnv;

    viewIcon = jotai.atom<string>("user-shield");
    viewName = jotai.atom<string>("Heroes");
    manageConnection = jotai.atom<boolean>(false);

    overviewAtom: jotai.PrimitiveAtom<AISessionsHeroOverviewResponse>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    selectedIdAtom: jotai.PrimitiveAtom<string>;
    rowsAtom: jotai.Atom<HeroRosterRow[]>;
    selectedRowAtom: jotai.Atom<HeroRosterRow>;

    disposed = false;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "hero";
        this.blockId = blockId;
        this.env = waveEnv as HeroEnv;

        this.overviewAtom = jotai.atom<AISessionsHeroOverviewResponse>(
            null
        ) as jotai.PrimitiveAtom<AISessionsHeroOverviewResponse>;
        this.loadingAtom = jotai.atom<boolean>(true);
        this.errorAtom = jotai.atom<string>("");
        this.selectedIdAtom = jotai.atom<string>("");
        this.rowsAtom = jotai.atom((get) => deriveRosterRows(get(this.overviewAtom)));
        this.selectedRowAtom = jotai.atom((get) => {
            const rows = get(this.rowsAtom);
            const selectedId = get(this.selectedIdAtom);
            return rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
        });

        this.refresh();
    }

    get viewComponent(): ViewComponent {
        return HeroView;
    }

    dispose(): void {
        this.disposed = true;
    }

    select(id: string): void {
        globalStore.set(this.selectedIdAtom, id);
    }

    async refresh(): Promise<void> {
        if (this.disposed) {
            return;
        }
        globalStore.set(this.loadingAtom, true);
        try {
            const overview = await this.env.services.aisessions.HeroOverview({});
            if (this.disposed) {
                return;
            }
            globalStore.set(this.overviewAtom, overview ?? { root: "", heroes: [] });
            globalStore.set(this.errorAtom, "");
        } catch (e) {
            if (this.disposed) {
                return;
            }
            globalStore.set(this.errorAtom, e instanceof Error ? e.message : String(e));
        } finally {
            if (!this.disposed) {
                globalStore.set(this.loadingAtom, false);
            }
        }
    }

    /** Stage entry: reuse the A3 builder; never inject a main workdir here. */
    launch(row: HeroRosterRow | null, root: string, settings: SettingsType | undefined): Promise<string> {
        if (row == null) {
            return Promise.resolve(null);
        }
        const { blockDef } = buildHeroLaunchBlockDef({
            settings,
            hero: row.hero,
            root: root ?? "",
        });
        return this.env.createBlock(blockDef, false);
    }
}

function CapacityCell({ label, bytes, files }: { label: string; bytes: number; files?: number }) {
    return (
        <div className="rounded border border-border/70 bg-surface px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-0.5 text-[13px] text-primary">{formatBytes(bytes)}</div>
            {files != null && <div className="text-[10px] text-secondary">{files} files</div>}
        </div>
    );
}

function CopyLine({ text }: { text: string }) {
    const [copied, setCopied] = React.useState(false);
    const onCopy = React.useCallback(() => {
        fireAndForget(async () => {
            await copyText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        });
    }, [text]);
    return (
        <div className="flex items-center gap-2 rounded border border-border/70 bg-surface px-2 py-1">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary" title={text}>
                {text}
            </code>
            <button
                type="button"
                onClick={onCopy}
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary"
            >
                {copied ? "copied" : "copy"}
            </button>
        </div>
    );
}

type HeroViewProps = {
    blockId: string;
    model: HeroViewModel;
};

function RosterRowView({
    row,
    selected,
    onSelect,
}: {
    row: HeroRosterRow;
    selected: boolean;
    onSelect: (id: string) => void;
}) {
    return (
        <button
            type="button"
            onClick={() => onSelect(row.id)}
            className={clsx(
                "w-full border-b border-border/50 px-3 py-2 text-left transition-colors",
                selected ? "bg-hover" : "hover:bg-hover/60"
            )}
        >
            <div className="flex items-center gap-1.5">
                <span className="text-[13px] leading-none">{row.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-primary">{row.name}</span>
                {row.pendingProposals > 0 && (
                    <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-[1px] text-[10px] text-warning">
                        ⚡{row.pendingProposals}
                    </span>
                )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-secondary">{roleLine(row)}</div>
            <div className="mt-0.5 truncate text-[10px] text-muted">{row.providerModel}</div>
            <div className="mt-0.5 truncate text-[10px] text-muted" title={row.lastJournalLine || undefined}>
                {row.lastJournalLine === "" ? EmptyJournalText : row.lastJournalLine}
            </div>
        </button>
    );
}

function HeroDetail({
    row,
    root,
    onLaunch,
}: {
    row: HeroRosterRow;
    root: string;
    onLaunch: (row: HeroRosterRow) => void;
}) {
    const storage = row.storage;
    const homeBase = heroHomeBaseHint(root, row.id);
    const charter = isBlank(row.charter) ? "" : row.charter;
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-start gap-2 border-b border-border/60 px-4 py-2.5">
                <span className="text-lg leading-none">{row.emoji}</span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-primary">{row.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted">{row.id}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-secondary">{row.providerModel}</div>
                    {homeBase !== "" && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted" title={homeBase}>
                            {homeBase}
                        </div>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => onLaunch(row)}
                    className="shrink-0 rounded border border-accent/40 bg-accentbg px-2.5 py-1 text-[11px] text-accent hover:bg-hover"
                >
                    Confirm
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <section className="mb-4">
                    <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted">Capacity</div>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                        <CapacityCell
                            label="archive"
                            bytes={storage?.archiveBytes ?? 0}
                            files={storage?.archiveFiles ?? 0}
                        />
                        <CapacityCell
                            label="history"
                            bytes={storage?.historyBytes ?? 0}
                            files={storage?.historyFiles ?? 0}
                        />
                        <CapacityCell label="work" bytes={storage?.workBytes ?? 0} files={storage?.workFiles ?? 0} />
                        <CapacityCell label="syncable" bytes={storage?.syncableBytes ?? 0} />
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                        total {formatBytes(storage?.totalBytes ?? 0)} · sync ships archive/history only (
                        {formatBytes(storage?.syncableBytes ?? 0)})
                    </div>
                </section>

                <section className="mb-4">
                    <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
                        <span>Pending proposals</span>
                        <span className="rounded-full bg-warning/15 px-1.5 py-[1px] text-[10px] normal-case text-warning">
                            ⚡{row.pendingProposals}
                        </span>
                    </div>
                    {row.pendingProposals === 0 ? (
                        <div className="text-[11px] text-muted">No pending memory proposals.</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <div className="text-[11px] text-secondary">
                                Read-only in v1: copy a stamp from the proposals list and approve it via the CLI (writes
                                stay in the CLI).
                            </div>
                            <CopyLine text={heroInboxCommand(row.id)} />
                            <CopyLine text={heroApproveCommand(row.id)} />
                        </div>
                    )}
                </section>

                <section>
                    <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted">CHARTER</div>
                    {charter === "" ? (
                        <div className="text-[11px] text-muted">{EmptyCharterText}</div>
                    ) : (
                        <pre className="whitespace-pre-wrap break-words rounded border border-border/70 bg-surface px-3 py-2 font-mono text-[11px] leading-relaxed text-secondary">
                            {charter}
                        </pre>
                    )}
                </section>
            </div>
        </div>
    );
}

function HeroView({ model }: HeroViewProps) {
    const overview = jotai.useAtomValue(model.overviewAtom);
    const rows = jotai.useAtomValue(model.rowsAtom);
    const selectedRow = jotai.useAtomValue(model.selectedRowAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const fullConfig = jotai.useAtomValue(model.env.atoms.fullConfigAtom);
    const settings = fullConfig?.settings;

    const onSelect = React.useCallback(
        (id: string) => {
            model.select(id);
        },
        [model]
    );

    const onLaunch = React.useCallback(
        (row: HeroRosterRow) => {
            fireAndForget(async () => {
                try {
                    await model.launch(row, overview?.root ?? "", settings);
                } catch (e) {
                    console.warn("hero launch failed", e);
                }
            });
        },
        [model, overview?.root, settings]
    );

    const onRefresh = React.useCallback(() => {
        fireAndForget(() => model.refresh());
    }, [model]);

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-block">
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
                <span className="text-[11px] text-secondary">Heroes</span>
                <span className="truncate font-mono text-[10px] text-muted" title={overview?.root ?? ""}>
                    {overview?.root ?? ""}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-muted">{rows.length} total</span>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary disabled:opacity-50"
                >
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
            </div>

            {error !== "" && (
                <div className="border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-secondary">
                    Failed to load heroes: {error}
                </div>
            )}

            {rows.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-soft text-2xl text-muted/70">
                        🦸
                    </div>
                    <div className="text-sm font-medium text-secondary">No heroes yet</div>
                    <div className="max-w-[320px] text-[11px] leading-relaxed text-muted">{emptyStateText()}</div>
                    <CopyLine text={HeroCreateCommand} />
                    <div className="text-[10px] text-muted/70">
                        A hero keeps a home base and memory, and can be called to work from the right bar.
                    </div>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1">
                    <div className="flex w-[260px] shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-surface-soft">
                        {rows.map((row) => (
                            <RosterRowView
                                key={row.id}
                                row={row}
                                selected={selectedRow?.id === row.id}
                                onSelect={onSelect}
                            />
                        ))}
                    </div>
                    {selectedRow != null ? (
                        <HeroDetail row={selectedRow} root={overview?.root ?? ""} onLaunch={onLaunch} />
                    ) : (
                        <div className="flex flex-1 items-center justify-center text-[11px] text-muted">
                            Select a hero to see details
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export { HeroView };
