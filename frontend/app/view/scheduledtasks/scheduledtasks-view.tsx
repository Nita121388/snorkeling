// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { describeCron } from "./cron-describe";
import type { ScheduledTasksViewModel } from "./scheduledtasks-model";
import * as jotai from "jotai";
import * as React from "react";

const AgentProfiles = [
    { id: "pi", label: "Pi" },
    { id: "codex", label: "Codex" },
    { id: "claude", label: "Claude" },
    { id: "gemini", label: "Gemini" },
    { id: "opencode", label: "OpenCode" },
];

const PiModels = [
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek" },
    { id: "gpt-5", label: "GPT-5", provider: "openai" },
    { id: "claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
];

const ScheduleTypes = ["cron", "interval", "daily", "weekly", "once"];

function describeSchedule(s: ScheduledTaskScheduleType): string {
    switch (s?.type) {
        case "cron":
            return describeCron(s.cronExpr);
        case "interval": {
            const secs = s.intervalMs ? s.intervalMs / 1000 : null;
            if (secs == null) return "every ?s";
            if (secs < 60) return `Every ${secs}s`;
            if (secs % 3600 === 0) return `Every ${secs / 3600} hour${secs / 3600 > 1 ? "s" : ""}`;
            return `Every ${secs / 60} minutes`;
        }
        case "daily":
            return `Daily at ${s.timeOfDay ?? ""}`;
        case "weekly": {
            const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const d = s.dayOfWeek;
            const wd = d >= 0 && d <= 6 ? names[d] : String(d ?? "?");
            return `Weekly on ${wd} at ${s.timeOfDay ?? ""}`;
        }
        case "once":
            return s.runAt ? `Once at ${s.runAt}` : "Once";
        default:
            return s?.type ?? "-";
    }
}

function statusColor(status?: string): string {
    switch (status) {
        case "success":
            return "text-[var(--success)]";
        case "error":
        case "timeout":
            return "text-[var(--error)]";
        case "running":
            return "text-accent";
        default:
            return "text-muted";
    }
}

export const ScheduledTasksView: React.FC<ViewComponentProps<ScheduledTasksViewModel>> = React.memo(
    function ScheduledTasksView({ blockId: _blockId, blockRef: _blockRef, contentRef: _contentRef, model }) {
        const tasks = jotai.useAtomValue(model.tasksAtom);
        const loading = jotai.useAtomValue(model.loadingAtom);
        const error = jotai.useAtomValue(model.errorAtom);
        const status = jotai.useAtomValue(model.statusAtom);
        const editorOpen = jotai.useAtomValue(model.editorOpenAtom);
        const editingTask = jotai.useAtomValue(model.editingTaskAtom);
        const historyOpen = jotai.useAtomValue(model.historyOpenAtom);
        const historyTask = jotai.useAtomValue(model.historyTaskAtom);
        const history = jotai.useAtomValue(model.historyAtom);

        return (
            <div className="flex flex-col w-full h-full overflow-hidden">
                {/* toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <span className="text-sm font-semibold flex-1">Scheduled Tasks</span>
                    <button
                        className="px-2 py-1 text-xs rounded bg-actionsoft text-actionsofttext border border-actionsoftborder hover:bg-hoverbg cursor-pointer"
                        onClick={() => model.openCreate()}
                    >
                        + New Task
                    </button>
                </div>

                {error != null && <div className="px-3 py-2 text-xs text-error shrink-0">{error}</div>}
                {status && <div className="px-3 py-1 text-xs text-muted shrink-0">{status}</div>}

                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-secondary text-sm">Loading…</div>
                ) : tasks.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 bg-panel rounded-lg m-4 text-center">
                        <i className="fa-sharp fa-solid fa-clock text-4xl text-muted" />
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold text-secondary">No scheduled tasks</h3>
                            <p className="text-muted">Schedule an agent to run on a cron, interval, or daily schedule.</p>
                        </div>
                        <button
                            className="flex items-center gap-2 px-4 py-2 bg-action text-actiontext hover:bg-actionhover rounded cursor-pointer transition-colors"
                            onClick={() => model.openCreate()}
                        >
                            <i className="fa-sharp fa-solid fa-plus" />
                            <span className="font-medium">New Task</span>
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto wide-scrollbar">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-muted border-b border-border">
                                    <th className="px-3 py-2 font-medium">Name</th>
                                    <th className="px-2 py-2 font-medium">Agent</th>
                                    <th className="px-2 py-2 font-medium">Model</th>
                                    <th className="px-2 py-2 font-medium">Schedule</th>
                                    <th className="px-2 py-2 font-medium">Status</th>
                                    <th className="px-2 py-2 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tasks.map((task) => (
                                    <TaskRow
                                        key={task.id}
                                        task={task}
                                        onEdit={() => model.openEdit(task)}
                                        onToggle={() => model.toggleEnabled(task)}
                                        onDelete={() => model.deleteTask(task)}
                                        onRun={() => model.runNow(task)}
                                        onHistory={() => model.openHistory(task)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {historyOpen && historyTask != null && (
                    <HistoryOverlay model={model} historyTask={historyTask} history={history} />
                )}
                {editorOpen && editingTask != null && <EditorOverlay model={model} draft={editingTask} />}
            </div>
        );
    }
);

function TaskRow({
    task,
    onEdit,
    onToggle,
    onDelete,
    onRun,
    onHistory,
}: {
    task: ScheduledTaskType;
    onEdit: () => void;
    onToggle: () => void;
    onDelete: () => void;
    onRun: () => void;
    onHistory: () => void;
}) {
    return (
        <tr className="border-b border-border hover:bg-hoverbg align-top">
            <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                    <span className={`text-sm ${task.enabled ? "" : "text-muted line-through"}`}>{task.name}</span>
                    {!task.enabled && <span className="text-[10px] uppercase text-muted border border-border rounded px-1">off</span>}
                </div>
            </td>
            <td className="px-2 py-2 text-muted">{task.agentProfile ?? "-"}</td>
            <td className="px-2 py-2 text-muted">{task.model ?? "-"}</td>
            <td className="px-2 py-2">
                <div className="text-muted">{describeSchedule(task.schedule)}</div>
                {task.schedule?.type === "cron" && task.schedule.cronExpr && (
                    <div className="text-muted font-mono text-[10px]">{task.schedule.cronExpr}</div>
                )}
            </td>
            <td className="px-2 py-2">
                <span className={statusColor(task.lastRunStatus)}>{task.lastRunStatus ?? "pending"}</span>
                {task.lastRunAt && <span className="text-muted block text-[10px]">{new Date(task.lastRunAt).toLocaleString()}</span>}
            </td>
            <td className="px-2 py-2">
                <div className="flex items-center gap-1">
                    <Tooltip content="Edit">
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onEdit}>
                            <i className="fa-solid fa-pen-to-square" />
                        </button>
                    </Tooltip>
                    <Tooltip content={task.enabled ? "Disable" : "Enable"}>
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onToggle}>
                            <i className={`fa-solid ${task.enabled ? "fa-toggle-on text-accent" : "fa-toggle-off text-muted"}`} />
                        </button>
                    </Tooltip>
                    <Tooltip content="Run now">
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onRun}>
                            <i className="fa-solid fa-play" />
                        </button>
                    </Tooltip>
                    <Tooltip content="History">
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onHistory}>
                            <i className="fa-solid fa-clock-rotate-left" />
                        </button>
                    </Tooltip>
                    <Tooltip content="Delete">
                        <button
                            className="hover:bg-hoverbg rounded p-1 cursor-pointer text-error"
                            onClick={() => {
                                if (window.confirm(`Delete scheduled task “${task.name}”?`)) onDelete();
                            }}
                        >
                            <i className="fa-solid fa-trash" />
                        </button>
                    </Tooltip>
                </div>
            </td>
        </tr>
    );
}

function HistoryOverlay({
    model,
    historyTask,
    history,
}: {
    model: ScheduledTasksViewModel;
    historyTask: ScheduledTaskType;
    history: ScheduledTaskRunRecord[];
}) {
    return (
        <Overlay>
            <OverlayHeader title={`History — ${historyTask.name}`} onClose={() => model.closeHistory()} />
            {history.length === 0 ? (
                <div className="p-6 text-sm text-secondary">No runs recorded yet.</div>
            ) : (
                <div className="overflow-y-auto max-h-[60vh]">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-muted border-b border-border">
                                <th className="px-4 py-2 font-medium">Status</th>
                                <th className="px-2 py-2 font-medium">Duration</th>
                                <th className="px-2 py-2 font-medium">Error</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((r, i) => (
                                <tr key={i} className="border-b border-border align-top">
                                    <td className="px-4 py-1.5">
                                        <span className={statusColor(r.status)}>{r.status}</span>
                                    </td>
                                    <td className="px-2 py-1.5 text-muted">{r.durationMs}ms</td>
                                    <td className="px-2 py-1.5 text-error break-all">{r.error ?? ""}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </Overlay>
    );
}

function EditorOverlay({ model, draft }: { model: ScheduledTasksViewModel; draft: ScheduledTaskType }) {
    const [form, setForm] = React.useState<ScheduledTaskType>(() => ({
        ...draft,
        schedule: { ...draft.schedule },
    }));
    const [err, setErr] = React.useState<string>(null);
    const [saving, setSaving] = React.useState(false);

    const set = <K extends keyof ScheduledTaskType>(k: K, v: ScheduledTaskType[K]) =>
        setForm((f) => ({ ...f, [k]: v }));
    const setSched = <K extends keyof ScheduledTaskScheduleType>(k: K, v: ScheduledTaskScheduleType[K]) =>
        setForm((f) => ({ ...f, schedule: { ...f.schedule, [k]: v } }));

    const notify = form.notifyOnComplete || form.notifyOnError;

    return (
        <Overlay>
            <OverlayHeader title={draft.id ? "Edit Scheduled Task" : "New Scheduled Task"} onClose={() => model.closeEditor()} />
            <div className="p-4 space-y-3 overflow-y-auto max-h-[70vh]">
                <Field label="Name">
                    <input
                        className={inputCls}
                        value={form.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="Daily Code Review"
                        autoFocus
                    />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="Agent Profile">
                        <select className={inputCls} value={form.agentProfile ?? "pi"} onChange={(e) => set("agentProfile", e.target.value)}>
                            {AgentProfiles.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.label}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label={`Model${form.agentProfile === "pi" ? " — Pi" : ""}`}>
                        <select className={inputCls} value={form.model ?? ""} onChange={(e) => set("model", e.target.value)}>
                            {form.agentProfile === "pi" ? (
                                PiModels.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.label}
                                    </option>
                                ))
                            ) : (
                                <option value={form.model ?? ""}>{form.model ?? "Default"}</option>
                            )}
                        </select>
                    </Field>
                </div>

                <Field label="Prompt">
                    <textarea
                        className={`${inputCls} min-h-[72px] resize-y`}
                        value={form.prompt}
                        onChange={(e) => set("prompt", e.target.value)}
                        placeholder="Review the latest commit and suggest improvements"
                    />
                </Field>

                <Field label="Working Directory">
                    <input
                        className={inputCls}
                        value={form.workdir ?? ""}
                        onChange={(e) => set("workdir", e.target.value)}
                        placeholder="~/myproject"
                    />
                </Field>

                <Field label="Schedule Type">
                    <select className={inputCls} value={form.schedule?.type ?? "cron"} onChange={(e) => setSched("type", e.target.value)}>
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
                    <div className="grid grid-cols-2 gap-3">
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
                    </div>
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

                <div className="flex items-center gap-4 pt-1">
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
                {notify && (
                    <Field label="Notification Mode">
                        <select className={inputCls} value={form.notificationMode ?? "os"} onChange={(e) => set("notificationMode", e.target.value)}>
                            <option value="os">OS</option>
                            <option value="bell">Bell</option>
                            <option value="both">Both</option>
                            <option value="none">None</option>
                        </select>
                    </Field>
                )}

                {err != null && <div className="text-xs text-error">{err}</div>}

                <div className="flex justify-end gap-2 pt-2">
                    <button className={btnCls} onClick={() => model.closeEditor()}>
                        Cancel
                    </button>
                    <button
                        className={`${btnCls} bg-accent text-[var(--accent-foreground)]`}
                        disabled={saving || !form.name}
                        onClick={async () => {
                            setSaving(true);
                            const e = await model.save(form);
                            setSaving(false);
                            if (e) setErr(e);
                        }}
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </div>
            </div>
        </Overlay>
    );
}

const inputCls =
    "w-full bg-[var(--form-element-bg-color)] text-[var(--form-element-text-color)] border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent";

const btnCls = "px-3 py-1 text-xs rounded border border-border hover:bg-hoverbg cursor-pointer";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">{label}</span>
            {children}
        </label>
    );
}

function Overlay({ children }: { children: React.ReactNode }) {
    return (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
            <div className="bg-modalbg border border-border rounded-lg shadow-xl w-[640px] max-w-[92%]">{children}</div>
        </div>
    );
}

function OverlayHeader({ title, onClose }: { title: string; onClose: () => void }) {
    return (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-sm font-semibold">{title}</span>
            <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onClose}>
                ✕
            </button>
        </div>
    );
}