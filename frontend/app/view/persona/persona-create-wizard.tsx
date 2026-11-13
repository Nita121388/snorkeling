// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// PersonaCreateWizard (A2, design §4): a two-step wizard shared by every entry
// point. Step 1 = identity, step 2 = the A1 scaffold tree preview plus the
// command that would land it.
//
// Two contracts worth keeping:
//  1. The file tree comes from the backend `PersonaScaffoldPreview` RPC, which
//     calls the SAME `persona.Create(DryRun: true)` the CLI uses — the tree the
//     user sees can never drift from what `wsh persona create --yes` writes.
//  2. The wizard never writes. It hands the user the command (human-run), so
//     the propose gate (A2.5) stays on the CLI side.

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsService } from "@/app/store/services";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    buildCreateCommand,
    mergePrefill,
    slugPreview,
    treeDepth,
    validateCreateDraft,
    type PersonaCreateDraft,
    type PersonaCreatePrefill,
} from "./persona-create-model";

export type PersonaCreateWizardProps = PersonaCreatePrefill & {
    onClose: () => void;
};

const StepIdentity = 1;
const StepPreview = 2;

function PersonaCreateWizard({ source, sessionTitle, projectPath, onClose }: PersonaCreateWizardProps) {
    const [step, setStep] = useState(StepIdentity);
    const [draft, setDraft] = useState<PersonaCreateDraft>(() => mergePrefill({ source, sessionTitle, projectPath }));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [files, setFiles] = useState<Array<{ path: string; preview?: string; exists: boolean }>>([]);
    const [scaffoldId, setScaffoldId] = useState("");
    const [scaffoldDir, setScaffoldDir] = useState("");

    const nameError = validateCreateDraft(draft);
    const command = useMemo(() => buildCreateCommand(draft), [draft]);

    const close = useCallback(() => onClose(), [onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const fetchPreview = useCallback((current: PersonaCreateDraft) => {
        setLoading(true);
        setError("");
        AISessionsService.PersonaScaffoldPreview({
            name: current.name.trim(),
            emoji: current.emoji.trim() || undefined,
            role: current.role.trim() || undefined,
            provider: current.provider.trim() || undefined,
            model: current.model.trim() || undefined,
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

    const setField = (key: keyof PersonaCreateDraft) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setDraft((prev) => ({ ...prev, [key]: e.target.value }));
    };

    const copyCommand = () => {
        void navigator.clipboard.writeText(command).catch(() => undefined);
    };

    const idPreview = scaffoldId || slugPreview(draft.name);

    return (
        <Modal
            className="persona-create-wizard w-[min(94vw,720px)]"
            title="🎭 设为新人设"
            subtitle={
                step === StepIdentity
                    ? "步骤 1 / 2 · 身份"
                    : `步骤 2 / 2 · 预览${scaffoldDir ? ` · ${scaffoldDir}` : ""}`
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
                            上一步
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
                            下一步 · 预览文件树
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="cursor-pointer rounded bg-accent px-3 py-1 text-xs text-white hover:opacity-90"
                            onClick={close}
                        >
                            完成（命令已就绪）
                        </button>
                    )}
                </div>
            }
        >
            {step === StepIdentity ? (
                <div className="flex flex-col gap-3 px-1 pb-1">
                    <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted/80">
                            名字（必填）
                        </span>
                        <input
                            type="text"
                            value={draft.name}
                            onChange={setField("name")}
                            placeholder={sessionTitle || "Backup Guard"}
                            className="rounded border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                            autoFocus
                        />
                        <span className={clsy(nameError)}>
                            {nameError !== "" ? nameError : `id 预览：${idPreview || "—"}`}
                        </span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Emoji" value={draft.emoji} onChange={setField("emoji")} placeholder="🎭" />
                        <Field
                            label="Provider"
                            value={draft.provider}
                            onChange={setField("provider")}
                            placeholder="pi"
                        />
                        <Field
                            label="Role（一句话职责）"
                            value={draft.role}
                            onChange={setField("role")}
                            placeholder="备份归档"
                        />
                        <Field label="Model" value={draft.model} onChange={setField("model")} placeholder="（可选）" />
                    </div>
                    <p className="text-[11px] text-muted/80">
                        来源：{source || "—"}
                        {projectPath ? ` · 主工作目录 ${projectPath}` : ""}。记忆初稿（会话 Note/Tags）由 CLI 参数
                        <code className="mx-1 rounded bg-surface-soft px-1">--memory-from-session</code>
                        提供，本向导不直接写 MEMORY。
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-[1.1fr_1fr] gap-4 px-1 pb-1">
                    <div className="min-h-0 overflow-y-auto overscroll-contain rounded border border-border/60">
                        {loading ? (
                            <div className="flex items-center justify-center py-8 text-muted">
                                <i className="fa fa-solid fa-spinner fa-spin mr-2"></i>
                                <span className="text-xs">正在生成文件树…</span>
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
                                        重试
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
                            目录名 <code className="rounded bg-surface-soft px-1">{idPreview || "—"}</code>
                            （最终以 CLI 为准）
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
                                复制命令
                            </button>
                        </div>
                        <p className="text-[11px] text-muted/70">
                            本向导不直接落盘：命令由你执行，propose 闸门保持在 CLI 侧。加
                            <code className="mx-1 rounded bg-surface-soft px-1">--memory-from-session</code>
                            可把会话 Note/Tags 变成 MEMORY 初稿提议。
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

PersonaCreateWizard.displayName = "PersonaCreateWizard";

export { PersonaCreateWizard };

/** Module-level bus so every entry point opens the same wizard instance. */
export function openPersonaCreateWizard(prefill?: PersonaCreatePrefill): void {
    modalsModel.pushModal(PersonaCreateWizard.displayName!, prefill ?? {});
}
