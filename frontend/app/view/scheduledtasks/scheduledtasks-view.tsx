// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import type { AgentProfileInfo } from "@/app/workspace/agent-catalog";
import { findAgentProfile } from "@/app/workspace/agent-catalog";
import * as jotai from "jotai";
import * as React from "react";
import { describeCron } from "./cron-describe";
import type { ScheduledTasksViewModel } from "./scheduledtasks-model";

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

function agentLabel(agentCatalog: AgentProfileInfo[], name: string | undefined): string {
    if (name == null || name === "") {
        return "-";
    }
    return findAgentProfile(agentCatalog, name)?.label ?? name;
}

function modelLabel(
    agentCatalog: AgentProfileInfo[],
    agentName: string | undefined,
    model: string | undefined
): string {
    if (model == null || model === "") {
        return "default";
    }
    const found = findAgentProfile(agentCatalog, agentName)?.models.find((m) => m.id === model);
    return found?.label ?? model;
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
        const historyOpen = jotai.useAtomValue(model.historyOpenAtom);
        const historyTask = jotai.useAtomValue(model.historyTaskAtom);
        const history = jotai.useAtomValue(model.historyAtom);
        const agentCatalog = jotai.useAtomValue(model.agentCatalogAtom);

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
                            <p className="text-muted">
                                Schedule an agent to run on a cron, interval, or daily schedule.
                            </p>
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
                                        agentCatalog={agentCatalog}
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
            </div>
        );
    }
);

function TaskRow({
    task,
    agentCatalog,
    onEdit,
    onToggle,
    onDelete,
    onRun,
    onHistory,
}: {
    task: ScheduledTaskType;
    agentCatalog: AgentProfileInfo[];
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
                    {!task.enabled && (
                        <span className="text-[10px] uppercase text-muted border border-border rounded px-1">off</span>
                    )}
                </div>
            </td>
            <td className="px-2 py-2 text-muted">{agentLabel(agentCatalog, task.agentProfile)}</td>
            <td className="px-2 py-2 text-muted">{modelLabel(agentCatalog, task.agentProfile, task.model)}</td>
            <td className="px-2 py-2">
                <div className="text-muted">{describeSchedule(task.schedule)}</div>
                {task.schedule?.type === "cron" && task.schedule.cronExpr && (
                    <div className="text-muted font-mono text-[10px]">{task.schedule.cronExpr}</div>
                )}
            </td>
            <td className="px-2 py-2">
                <span className={statusColor(task.lastRunStatus)}>{task.lastRunStatus ?? "pending"}</span>
                {task.lastRunAt && (
                    <span className="text-muted block text-[10px]">{new Date(task.lastRunAt).toLocaleString()}</span>
                )}
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
                            <i
                                className={`fa-solid ${task.enabled ? "fa-toggle-on text-accent" : "fa-toggle-off text-muted"}`}
                            />
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
