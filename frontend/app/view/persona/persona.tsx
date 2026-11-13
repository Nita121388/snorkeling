// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Persona roster block (A4, design §6): "who is on shift, how much does each
// remember, what is waiting for approval".
//
// Left column  = one row per persona directory (emoji + name + role +
//                provider/model + last journal line + pending proposal count).
// Right column = CHARTER full text, capacity buckets, pending proposals with
//                copyable CLI commands, and the [叫TA登场] launch action.
//
// Data comes from a single read-only RPC (`aisessions.PersonaOverview`) that
// shares root resolution with PersonaRoster/PersonaStats, so the roster count
// equals the number of persona dirs on disk. Launching reuses the A3 pipeline
// (buildPersonaLaunchBlockDef) and deliberately does NOT inject a main workdir:
// the roster has no "today's project" semantics.

import { globalStore } from "@/app/store/jotaiStore";
import type { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { buildPersonaLaunchBlockDef } from "@/app/workspace/persona-launch";
import { copyText } from "@/util/clipboard";
import { fireAndForget, isBlank } from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import {
    EmptyCharterText,
    EmptyJournalText,
    PersonaCreateCommand,
    deriveRosterRows,
    emptyStateText,
    formatBytes,
    personaApproveCommand,
    personaHomeBaseHint,
    personaInboxCommand,
    roleLine,
    type PersonaRosterRow,
} from "./persona-model";

export type PersonaEnv = WaveEnvSubset<{
    services: {
        aisessions: {
            PersonaOverview: WaveEnv["services"]["aisessions"]["PersonaOverview"];
        };
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    createBlock: WaveEnv["createBlock"];
}>;

export class PersonaViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    env: PersonaEnv;

    viewIcon = jotai.atom<string>("masks-theater");
    viewName = jotai.atom<string>("Personas");
    manageConnection = jotai.atom<boolean>(false);

    overviewAtom: jotai.PrimitiveAtom<AISessionsPersonaOverviewResponse>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    errorAtom: jotai.PrimitiveAtom<string>;
    selectedIdAtom: jotai.PrimitiveAtom<string>;
    rowsAtom: jotai.Atom<PersonaRosterRow[]>;
    selectedRowAtom: jotai.Atom<PersonaRosterRow>;

    disposed = false;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "persona";
        this.blockId = blockId;
        this.env = waveEnv as PersonaEnv;

        this.overviewAtom = jotai.atom<AISessionsPersonaOverviewResponse>(
            null
        ) as jotai.PrimitiveAtom<AISessionsPersonaOverviewResponse>;
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
        return PersonaView;
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
            const overview = await this.env.services.aisessions.PersonaOverview({});
            if (this.disposed) {
                return;
            }
            globalStore.set(this.overviewAtom, overview ?? { root: "", personas: [] });
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
    launch(row: PersonaRosterRow | null, root: string, settings: SettingsType | undefined): Promise<string> {
        if (row == null) {
            return Promise.resolve(null);
        }
        const { blockDef } = buildPersonaLaunchBlockDef({
            settings,
            persona: row.persona,
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

type PersonaViewProps = {
    blockId: string;
    model: PersonaViewModel;
};

function RosterRowView({
    row,
    selected,
    onSelect,
}: {
    row: PersonaRosterRow;
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

function PersonaDetail({
    row,
    root,
    onLaunch,
}: {
    row: PersonaRosterRow;
    root: string;
    onLaunch: (row: PersonaRosterRow) => void;
}) {
    const storage = row.storage;
    const homeBase = personaHomeBaseHint(root, row.id);
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
                    叫TA登场
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
                        total {formatBytes(storage?.totalBytes ?? 0)} · 同步只带 archive/history（
                        {formatBytes(storage?.syncableBytes ?? 0)}）
                    </div>
                </section>

                <section className="mb-4">
                    <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted">
                        <span>待批准提议</span>
                        <span className="rounded-full bg-warning/15 px-1.5 py-[1px] text-[10px] normal-case text-warning">
                            ⚡{row.pendingProposals}
                        </span>
                    </div>
                    {row.pendingProposals === 0 ? (
                        <div className="text-[11px] text-muted">没有待批准的记忆提议。</div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <div className="text-[11px] text-secondary">
                                v1 只读：先看提议列表拿到 stamp，再用命令逐条批准（写操作留在 CLI）。
                            </div>
                            <CopyLine text={personaInboxCommand(row.id)} />
                            <CopyLine text={personaApproveCommand(row.id)} />
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

function PersonaView({ model }: PersonaViewProps) {
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
        (row: PersonaRosterRow) => {
            fireAndForget(async () => {
                try {
                    await model.launch(row, overview?.root ?? "", settings);
                } catch (e) {
                    console.warn("persona launch failed", e);
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
                <span className="text-[11px] text-secondary">人设名册</span>
                <span className="truncate font-mono text-[10px] text-muted" title={overview?.root ?? ""}>
                    {overview?.root ?? ""}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-muted">{rows.length} 位</span>
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-secondary hover:bg-hover hover:text-primary disabled:opacity-50"
                >
                    {loading ? "刷新中…" : "Refresh"}
                </button>
            </div>

            {error !== "" && (
                <div className="border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-secondary">
                    读取名册失败：{error}
                </div>
            )}

            {rows.length === 0 ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                    <div className="text-[12px] text-secondary">{emptyStateText()}</div>
                    <CopyLine text={PersonaCreateCommand} />
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
                        <PersonaDetail row={selectedRow} root={overview?.root ?? ""} onLaunch={onLaunch} />
                    ) : (
                        <div className="flex flex-1 items-center justify-center text-[11px] text-muted">
                            选一个人设查看详情
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export { PersonaView };
