// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FlexiModal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { describeCron } from "@/app/view/scheduledtasks/cron-describe";
import type { AgentProfileInfo } from "@/app/workspace/agent-catalog";
import { findAgentProfile, loadAgentCatalog, modelOptionsFor, pickDefaultModel } from "@/app/workspace/agent-catalog";
import * as React from "react";

const ScheduleTypes = ["cron", "interval", "daily", "weekly", "once"];

/** Props passed through modalsModel.pushModal("ScheduledTaskEditorModal", ...). */
export type ScheduledTaskEditorModalProps = {
    task: ScheduledTaskType;
    isNew: boolean;
    onSave: (draft: ScheduledTaskType) => Promise<string | null>;
};

/**
 * App-level scheduled-task editor. It used to be an `absolute inset-0` overlay inside the
 * Scheduled Tasks block, which made it tiny and clipped by the block bounds. Rendering it
 * through the global modal layer (FlexiModal portals into #main) gives it the same footprint
 * as the other app dialogs and lets ESC/backdrop close it via modalsModel.
 */
function ScheduledTaskEditorModal({ task, isNew, onSave }: ScheduledTaskEditorModalProps) {
    const [form, setForm] = React.useState<ScheduledTaskType>(() => ({
        ...task,
        schedule: { ...task.schedule },
    }));
    const [agentCatalog, setAgentCatalog] = React.useState<AgentProfileInfo[]>([]);
    const [catalogLoading, setCatalogLoading] = React.useState(true);
    const [err, setErr] = React.useState<string>(null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;
        void loadAgentCatalog().then((profiles) => {
            if (cancelled) return;
            setAgentCatalog(profiles ?? []);
            setCatalogLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const close = React.useCallback(() => {
        modalsModel.popModal();
    }, []);

    const set = <K extends keyof ScheduledTaskType>(k: K, v: ScheduledTaskType[K]) =>
        setForm((f) => ({ ...f, [k]: v }));
    const setSched = <K extends keyof ScheduledTaskScheduleType>(k: K, v: ScheduledTaskScheduleType[K]) =>
        setForm((f) => ({ ...f, schedule: { ...f.schedule, [k]: v } }));

    const profile = findAgentProfile(agentCatalog, form.agentProfile);
    const modelOptions = modelOptionsFor(profile, form.model);

    // Switching agents re-points the model at that agent's default so a stale model id
    // from the previous agent is never silently carried over.
    const selectAgent = (name: string) => {
        const nextProfile = findAgentProfile(agentCatalog, name);
        setForm((f) => ({ ...f, agentProfile: name, model: pickDefaultModel(nextProfile) }));
    };

    const notify = form.notifyOnComplete || form.notifyOnError;

    const save = async () => {
        setSaving(true);
        const e = await onSave(form);
        setSaving(false);
        if (e) {
            setErr(e);
            return;
        }
        close();
    };

    return (
        <FlexiModal
            className="w-[min(760px,calc(100vw-40px))] max-h-[min(86vh,calc(100vh-56px))] overflow-hidden p-0"
            onClickBackdrop={close}
        >
            <div className="flex h-full min-h-0 w-full flex-col bg-modalbg text-primary">
                <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
                    <span className="text-sm font-semibold">
                        {isNew ? "New Scheduled Task" : "Edit Scheduled Task"}
                    </span>
                    <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={close} title="Close (ESC)">
                        ✕
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4 wide-scrollbar">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <Field label="Name" className="md:col-span-2">
                            <input
                                className={inputCls}
                                value={form.name}
                                onChange={(e) => set("name", e.target.value)}
                                placeholder="Daily Code Review"
                                autoFocus
                            />
                        </Field>

                        <Field label="Agent Profile">
                            {agentCatalog.length === 0 ? (
                                // Catalog unavailable (RPC failed): keep the editor usable with free text.
                                <input
                                    className={inputCls}
                                    value={form.agentProfile ?? ""}
                                    onChange={(e) => set("agentProfile", e.target.value)}
                                    placeholder="pi"
                                />
                            ) : (
                                <select
                                    className={inputCls}
                                    value={form.agentProfile ?? ""}
                                    onChange={(e) => selectAgent(e.target.value)}
                                >
                                    {agentCatalog.map((a) => (
                                        <option key={a.name} value={a.name}>
                                            {a.label}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {catalogLoading && <span className="text-xs text-muted mt-0.5">Loading agents…</span>}
                            {!catalogLoading && agentCatalog.length === 0 && (
                                <span className="text-xs text-muted mt-0.5">
                                    Agent catalog unavailable — type the agent command name.
                                </span>
                            )}
                        </Field>

                        <Field label={profile != null ? `Model — ${profile.label}` : "Model"}>
                            {modelOptions.length === 0 ? (
                                <input
                                    className={inputCls}
                                    value={form.model ?? ""}
                                    onChange={(e) => set("model", e.target.value)}
                                    placeholder="Default (agent chooses)"
                                />
                            ) : (
                                <select
                                    className={inputCls}
                                    value={form.model ?? ""}
                                    onChange={(e) => set("model", e.target.value)}
                                >
                                    {modelOptions.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.provider != null && m.provider !== ""
                                                ? `${m.label} (${m.provider})`
                                                : m.label}
                                        </option>
                                    ))}
                                </select>
                            )}
                            {profile != null && profile.models.length === 0 && (
                                <span className="text-xs text-muted mt-0.5">
                                    No models configured for this agent — add agent:profiles.{profile.name}.models in
                                    settings, or type a model id.
                                </span>
                            )}
                        </Field>

                        <Field label="Prompt" className="md:col-span-2">
                            <textarea
                                className={`${inputCls} min-h-[96px] resize-y`}
                                value={form.prompt}
                                onChange={(e) => set("prompt", e.target.value)}
                                placeholder="Review the latest commit and suggest improvements"
                            />
                        </Field>

                        <Field label="Working Directory" className="md:col-span-2">
                            <input
                                className={inputCls}
                                value={form.workdir ?? ""}
                                onChange={(e) => set("workdir", e.target.value)}
                                placeholder="~/myproject"
                            />
                        </Field>

                        <Field label="Schedule Type">
                            <select
                                className={inputCls}
                                value={form.schedule?.type ?? "cron"}
                                onChange={(e) => setSched("type", e.target.value)}
                            >
                                {ScheduleTypes.map((t) => (
                                    <option key={t} value={t}>
                                        {t}
                                    </option>
                                ))}
                            </select>
                        </Field>

                        {(form.schedule?.type ?? "cron") === "cron" && (
                            <Field label="Cron Expression">
                                <input
                                    className={`${inputCls} font-mono`}
                                    value={form.schedule?.cronExpr ?? ""}
                                    onChange={(e) => setSched("cronExpr", e.target.value)}
                                    placeholder="0 9 * * 1-5"
                                />
                                <span className="text-xs text-secondary mt-0.5 min-h-[16px]">
                                    {describeCron(form.schedule?.cronExpr) || "—"}
                                </span>
                            </Field>
                        )}
                        {(form.schedule?.type ?? "cron") === "interval" && (
                            <Field label="Interval (ms)">
                                <input
                                    className={inputCls}
                                    type="number"
                                    value={form.schedule?.intervalMs ?? 3600000}
                                    onChange={(e) => setSched("intervalMs", Number(e.target.value))}
                                />
                            </Field>
                        )}
                        {(form.schedule?.type ?? "cron") === "daily" && (
                            <Field label="Time (HH:MM)">
                                <input
                                    className={inputCls}
                                    value={form.schedule?.timeOfDay ?? ""}
                                    onChange={(e) => setSched("timeOfDay", e.target.value)}
                                    placeholder="09:00"
                                />
                            </Field>
                        )}
                        {(form.schedule?.type ?? "cron") === "weekly" && (
                            <>
                                <Field label="Time (HH:MM)">
                                    <input
                                        className={inputCls}
                                        value={form.schedule?.timeOfDay ?? ""}
                                        onChange={(e) => setSched("timeOfDay", e.target.value)}
                                        placeholder="09:00"
                                    />
                                </Field>
                                <Field label="Day of Week (0=Sun)">
                                    <input
                                        className={inputCls}
                                        type="number"
                                        min={0}
                                        max={6}
                                        value={form.schedule?.dayOfWeek ?? 0}
                                        onChange={(e) => setSched("dayOfWeek", Number(e.target.value))}
                                    />
                                </Field>
                            </>
                        )}
                        {(form.schedule?.type ?? "cron") === "once" && (
                            <Field label="Run At (ISO)">
                                <input
                                    className={`${inputCls} font-mono`}
                                    value={form.schedule?.runAt ?? ""}
                                    onChange={(e) => setSched("runAt", e.target.value)}
                                    placeholder="2026-09-09T09:00:00Z"
                                />
                            </Field>
                        )}

                        <Field label="Timezone">
                            <input
                                className={`${inputCls} font-mono`}
                                value={form.schedule?.timezone ?? ""}
                                onChange={(e) => setSched("timezone", e.target.value)}
                                placeholder="Asia/Shanghai"
                            />
                        </Field>

                        {notify && (
                            <Field label="Notification Mode">
                                <select
                                    className={inputCls}
                                    value={form.notificationMode ?? "os"}
                                    onChange={(e) => set("notificationMode", e.target.value)}
                                >
                                    <option value="os">OS</option>
                                    <option value="bell">Bell</option>
                                    <option value="both">Both</option>
                                    <option value="none">None</option>
                                </select>
                            </Field>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-4">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.enabled}
                                onChange={(e) => set("enabled", e.target.checked)}
                            />
                            Enabled
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.notifyOnComplete}
                                onChange={(e) => set("notifyOnComplete", e.target.checked)}
                            />
                            Notify on complete
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input
                                type="checkbox"
                                checked={form.notifyOnError}
                                onChange={(e) => set("notifyOnError", e.target.checked)}
                            />
                            Notify on error
                        </label>
                    </div>

                    {err != null && <div className="pt-3 text-xs text-error">{err}</div>}
                </div>

                <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-2">
                    <button className={btnCls} onClick={close}>
                        Cancel
                    </button>
                    <button
                        className={`${btnCls} bg-accent text-[var(--accent-foreground)]`}
                        disabled={saving || !form.name}
                        onClick={save}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </FlexiModal>
    );
}

ScheduledTaskEditorModal.displayName = "ScheduledTaskEditorModal";

const inputCls =
    "w-full bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent";

const btnCls = "px-3 py-1 text-xs rounded border border-border hover:bg-hoverbg cursor-pointer";

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <label className={`flex flex-col gap-1 ${className ?? ""}`}>
            <span className="text-xs text-muted">{label}</span>
            {children}
        </label>
    );
}

export { ScheduledTaskEditorModal };
