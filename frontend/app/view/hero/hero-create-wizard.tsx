// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// HeroCreateWizard (A2, design §4): a two-step wizard shared by every entry
// point. Step 1 = identity, step 2 = the A1 scaffold tree preview plus the
// command that would land it.
//
// Two contracts worth keeping:
//  1. The file tree comes from the backend `HeroScaffoldPreview` RPC, which
//     calls the SAME `hero.Create(DryRun: true)` the CLI uses — the tree the
//     user sees can never drift from what `wsh hero create --yes` writes.
//  2. The wizard never writes. It hands the user the command (human-run), so
//     the propose gate (A2.5) stays on the CLI side.

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsService } from "@/app/store/services";
import { i18n } from "@/i18n/config";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    buildCreateCommand,
    mergePrefill,
    slugPreview,
    treeDepth,
    validateCreateDraft,
    type HeroCreateDraft,
    type HeroCreatePrefill,
} from "./hero-create-model";

export type HeroCreateWizardProps = HeroCreatePrefill & {
    /** Direct-render close (tests). Modal-registry renders get popModal(). */
    onClose?: () => void;
};

const StepIdentity = 1;
const StepPreview = 2;

function HeroCreateWizard({ source, sessionTitle, projectPath, onClose }: HeroCreateWizardProps) {
    // Subscription only — the markup below reads `i18n.t(...)` so the whole
    // wizard re-renders when `ui:locale` changes.
    useTranslation("hero");
    const [step, setStep] = useState(StepIdentity);
    const [draft, setDraft] = useState<HeroCreateDraft>(() => mergePrefill({ source, sessionTitle, projectPath }));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [files, setFiles] = useState<Array<{ path: string; preview?: string; exists: boolean }>>([]);
    const [scaffoldId, setScaffoldId] = useState("");
    const [scaffoldDir, setScaffoldDir] = useState("");

    const nameError = validateCreateDraft(draft);
    const command = useMemo(() => buildCreateCommand(draft), [draft]);

    const close = useCallback(() => {
        // The modal registry does not inject onClose (ModalsRenderer spreads
        // only the pushed props), so closing defaults to popModal(). A passed
        // onClose (direct render / tests) wins.
        if (onClose) {
            onClose();
        } else {
            modalsModel.popModal();
        }
    }, [onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                close();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [close]);

    const fetchPreview = useCallback((current: HeroCreateDraft) => {
        setLoading(true);
        setError("");
        AISessionsService.HeroScaffoldPreview({
            name: current.name.trim(),
            emoji: current.emoji.trim() || undefined,
            role: current.role.trim() || undefined,
        })
            .then((resp) => {
                setFiles(resp?.files ?? []);
                setScaffoldId(resp?.id ?? "");
                setScaffoldDir(resp?.dir ?? "");
            })
            .catch((e) => {
                setError(e instanceof Error ? e.message : String(e));
                setFiles([]);
            })
            .finally(() => setLoading(false));
    }, []);

    const goPreview = useCallback(() => {
        if (validateCreateDraft(draft) !== "") {
            return;
        }
        setStep(StepPreview);
        fetchPreview(draft);
    }, [draft, fetchPreview]);

    const setField = (key: keyof HeroCreateDraft) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setDraft((prev) => ({ ...prev, [key]: e.target.value }));
    };

    const copyCommand = () => {
        void navigator.clipboard.writeText(command).catch(() => undefined);
    };

    const idPreview = scaffoldId || slugPreview(draft.name);

    return (
        <Modal
            className="hero-create-wizard w-[min(94vw,720px)]"
            title={i18n.t("hero:wizard.title")}
            subtitle={
                step === StepIdentity
                    ? i18n.t("hero:wizard.stepIdentity")
                    : scaffoldDir
                      ? i18n.t("hero:wizard.stepPreviewWithDir", { dir: scaffoldDir })
                      : i18n.t("hero:wizard.stepPreview")
            }
            onClose={close}
            footer={
                <div className="flex w-full items-center justify-end gap-2">
                    {step === StepPreview ? (
                        <button
                            type="button"
                            className="cursor-pointer rounded border border-border bg-surface px-3 py-1 text-xs text-secondary transition-colors hover:text-foreground"
                            onClick={() => setStep(StepIdentity)}
                        >
                            {i18n.t("hero:wizard.back")}
                        </button>
                    ) : null}
                    {step === StepIdentity ? (
                        <button
                            type="button"
                            disabled={nameError !== ""}
                            className={clsx(
                                "rounded px-3 py-1 text-xs text-white transition-opacity",
                                nameError !== ""
                                    ? "cursor-not-allowed bg-accent/40"
                                    : "cursor-pointer bg-accent hover:opacity-90"
                            )}
                            onClick={goPreview}
                        >
                            {i18n.t("hero:wizard.next")}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="cursor-pointer rounded bg-accent px-3 py-1 text-xs text-white hover:opacity-90"
                            onClick={close}
                        >
                            {i18n.t("hero:wizard.done")}
                        </button>
                    )}
                </div>
            }
        >
            {step === StepIdentity ? (
                <div className="flex flex-col gap-3 px-1 pb-1">
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted/80">
                            {i18n.t("hero:wizard.nameLabel")}
                        </span>
                        <input
                            type="text"
                            value={draft.name}
                            onChange={setField("name")}
                            placeholder={sessionTitle || i18n.t("hero:wizard.namePlaceholder")}
                            className="rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                            autoFocus
                        />
                        <span className={clsy(nameError)}>
                            {nameError !== ""
                                ? i18n.t(nameError as never)
                                : i18n.t("hero:wizard.idPreview", { id: idPreview || "—" })}
                        </span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label={i18n.t("hero:wizard.emojiLabel")}
                            value={draft.emoji}
                            onChange={setField("emoji")}
                            placeholder="🦸"
                        />
                        <Field
                            label={i18n.t("hero:wizard.roleLabel")}
                            value={draft.role}
                            onChange={setField("role")}
                            placeholder={i18n.t("hero:wizard.rolePlaceholder")}
                        />
                    </div>
                    <p className="text-[11px] text-muted/80">
                        {i18n.t("hero:wizard.source", { source: source || "—" })}
                        {projectPath ? i18n.t("hero:wizard.mainWorkdir", { path: projectPath }) : ""}
                        {i18n.t("hero:wizard.sourceTrailer")}
                        <code className="mx-1 rounded bg-surface-soft px-1">--memory-from-session</code>
                        {i18n.t("hero:wizard.sourceTrailerAfter")}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-[1.1fr_1fr] gap-4 px-1 pb-1">
                    <div className="min-h-0 overflow-y-auto overscroll-contain rounded border border-border/60">
                        {loading ? (
                            <div className="flex items-center justify-center py-8 text-muted">
                                <i className="fa fa-solid fa-spinner fa-spin mr-2"></i>
                                <span className="text-xs">{i18n.t("hero:wizard.buildingTree")}</span>
                            </div>
                        ) : error !== "" ? (
                            <div className="px-3 py-6 text-center text-xs text-error">
                                {error}
                                <div className="mt-2">
                                    <button
                                        type="button"
                                        className="cursor-pointer rounded border border-border px-2 py-0.5 text-xs hover:border-accent"
                                        onClick={() => fetchPreview(draft)}
                                    >
                                        {i18n.t("hero:wizard.retry")}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <ul className="py-1">
                                {files.map((file) => (
                                    <li
                                        key={file.path}
                                        className="flex items-center gap-2 px-2 py-0.5 font-mono text-[11px] text-secondary"
                                        style={{ paddingLeft: `${8 + treeDepth(file.path) * 14}px` }}
                                        title={file.preview}
                                    >
                                        <span
                                            className={clsx(
                                                "w-3 shrink-0 text-center",
                                                file.exists ? "text-muted/60" : "text-accent"
                                            )}
                                        >
                                            {file.exists ? "•" : "+"}
                                        </span>
                                        <span className="truncate">{file.path.split("/").pop()}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="flex min-h-0 flex-col gap-2">
                        <div className="text-[11px] text-muted/80">
                            {i18n.t("hero:wizard.directoryName")}{" "}
                            <code className="rounded bg-surface-soft px-1">{idPreview || "—"}</code>{" "}
                            {i18n.t("hero:wizard.cliAuthoritative")}
                        </div>
                        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded border border-border bg-surface p-2 font-mono text-[11px] text-secondary">
                            {command}
                        </pre>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                className="cursor-pointer rounded border border-border bg-surface px-3 py-1 text-xs text-secondary hover:text-foreground"
                                onClick={copyCommand}
                            >
                                {i18n.t("hero:wizard.copyCommand")}
                            </button>
                        </div>
                        <p className="text-[11px] text-muted/70">
                            {i18n.t("hero:wizard.noWriteBefore")}
                            <code className="mx-1 rounded bg-surface-soft px-1">--memory-from-session</code>
                            {i18n.t("hero:wizard.noWriteAfter")}
                        </p>
                    </div>
                </div>
            )}
        </Modal>
    );
}

function clsy(errorText: string): string {
    return clsx("text-[10px]", errorText !== "" ? "text-error" : "text-muted/70");
}

function Field({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted/80">{label}</span>
            <input
                type="text"
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                className="rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
            />
        </label>
    );
}

HeroCreateWizard.displayName = "HeroCreateWizard";

export { HeroCreateWizard };

/** Module-level bus so every entry point opens the same wizard instance. */
export function openHeroCreateWizard(prefill?: HeroCreatePrefill): void {
    modalsModel.pushModal(HeroCreateWizard.displayName!, prefill ?? {});
}
