// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import type { AgentProfileInfo } from "@/app/workspace/agent-catalog";
import { findAgentProfile } from "@/app/workspace/agent-catalog";
import { i18n } from "@/i18n/config";
import * as jotai from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { describeCron } from "./cron-describe";
import type { ScheduledTasksViewModel } from "./scheduledtasks-model";

function describeSchedule(s: ScheduledTaskScheduleType): string {
    switch (s?.type) {
        case "cron":
            return describeCron(s.cronExpr);
        case "interval": {
            const secs = s.intervalMs ? s.intervalMs / 1000 : null;
            if (secs == null) return i18n.t("scheduledtasks:schedule.unknownInterval");
            if (secs < 60) return i18n.t("scheduledtasks:schedule.everySeconds", { count: secs });
            if (secs % 3600 === 0) return i18n.t("scheduledtasks:schedule.everyHours", { count: secs / 3600 });
            return i18n.t("scheduledtasks:schedule.everyMinutes", { count: secs / 60 });
        }
        case "daily":
            return i18n.t("scheduledtasks:schedule.dailyAt", { time: s.timeOfDay ?? "" });
        case "weekly": {
            const weekdayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
            const d = s.dayOfWeek;
            const wd = d >= 0 && d <= 6 ? i18n.t(`scheduledtasks:weekday.${weekdayKeys[d]}`) : String(d ?? "?");
            return i18n.t("scheduledtasks:schedule.weeklyOn", { day: wd, time: s.timeOfDay ?? "" });
        }
        case "once":
            return s.runAt
                ? i18n.t("scheduledtasks:schedule.onceAt", { time: s.runAt })
                : i18n.t("scheduledtasks:schedule.once");
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
        return i18n.t("scheduledtasks:model.default");
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
        // Subscription only — the markup below reads `i18n.t(...)`.
        useTranslation("scheduledtasks");

        return (
            <div className="flex flex-col w-full h-full overflow-hidden">
                {/* toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <span className="text-sm font-semibold flex-1">{i18n.t("scheduledtasks:toolbar.title")}</span>
                    <button
                        className="px-2 py-1 text-xs rounded bg-actionsoft text-actionsofttext border border-actionsoftborder hover:bg-hoverbg cursor-pointer"
                        onClick={() => model.openCreate()}
                    >
                        {i18n.t("scheduledtasks:toolbar.newTask")}
                    </button>
                </div>

                {error != null && <div className="px-3 py-2 text-xs text-error shrink-0">{error}</div>}
                {status && <div className="px-3 py-1 text-xs text-muted shrink-0">{status}</div>}

                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-secondary text-sm">
                        {i18n.t("scheduledtasks:loading")}
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 bg-panel rounded-lg m-4 text-center">
                        <i className="fa-sharp fa-solid fa-clock text-4xl text-muted" />
                        <div className="flex flex-col gap-1">
                            <h3 className="text-lg font-semibold text-secondary">
                                {i18n.t("scheduledtasks:empty.title")}
                            </h3>
                            <p className="text-muted">{i18n.t("scheduledtasks:empty.description")}</p>
                        </div>
                        <button
                            className="flex items-center gap-2 px-4 py-2 bg-action text-actiontext hover:bg-actionhover rounded cursor-pointer transition-colors"
                            onClick={() => model.openCreate()}
                        >
                            <i className="fa-sharp fa-solid fa-plus" />
                            <span className="font-medium">{i18n.t("scheduledtasks:empty.action")}</span>
                        </button>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto wide-scrollbar">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-muted border-b border-border">
                                    <th className="px-3 py-2 font-medium">{i18n.t("scheduledtasks:columns.name")}</th>
                                    <th className="px-2 py-2 font-medium">{i18n.t("scheduledtasks:columns.agent")}</th>
                                    <th className="px-2 py-2 font-medium">{i18n.t("scheduledtasks:columns.model")}</th>
                                    <th className="px-2 py-2 font-medium">
                                        {i18n.t("scheduledtasks:columns.schedule")}
                                    </th>
                                    <th className="px-2 py-2 font-medium">{i18n.t("scheduledtasks:columns.status")}</th>
                                    <th className="px-2 py-2 font-medium">
                                        {i18n.t("scheduledtasks:columns.actions")}
                                    </th>
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
                        <span className="text-[10px] uppercase text-muted border border-border rounded px-1">
                            {i18n.t("scheduledtasks:badge.off")}
                        </span>
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
                <span className={statusColor(task.lastRunStatus)}>
                    {task.lastRunStatus ?? i18n.t("scheduledtasks:status.pending")}
                </span>
                {task.lastRunAt && (
                    <span className="text-muted block text-[10px]">{new Date(task.lastRunAt).toLocaleString()}</span>
                )}
            </td>
            <td className="px-2 py-2">
                <div className="flex items-center gap-1">
                    <Tooltip content={i18n.t("scheduledtasks:actions.edit")}>
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onEdit}>
                            <i className="fa-solid fa-pen-to-square" />
                        </button>
                    </Tooltip>
                    <Tooltip
                        content={
                            task.enabled
                                ? i18n.t("scheduledtasks:actions.disable")
                                : i18n.t("scheduledtasks:actions.enable")
                        }
                    >
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onToggle}>
                            <i
                                className={`fa-solid ${task.enabled ? "fa-toggle-on text-accent" : "fa-toggle-off text-muted"}`}
                            />
                        </button>
                    </Tooltip>
                    <Tooltip content={i18n.t("scheduledtasks:actions.runNow")}>
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onRun}>
                            <i className="fa-solid fa-play" />
                        </button>
                    </Tooltip>
                    <Tooltip content={i18n.t("scheduledtasks:actions.history")}>
                        <button className="hover:bg-hoverbg rounded p-1 cursor-pointer" onClick={onHistory}>
                            <i className="fa-solid fa-clock-rotate-left" />
                        </button>
                    </Tooltip>
                    <Tooltip content="Delete">
                        <button
                            className="hover:bg-hoverbg rounded p-1 cursor-pointer text-error"
                            onClick={() => {
                                if (window.confirm(i18n.t("scheduledtasks:deleteConfirm", { name: task.name })))
                                    onDelete();
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
            <OverlayHeader
                title={i18n.t("scheduledtasks:history.title", { name: historyTask.name })}
                onClose={() => model.closeHistory()}
            />
            {history.length === 0 ? (
                <div className="p-6 text-sm text-secondary">{i18n.t("scheduledtasks:history.empty")}</div>
            ) : (
                <div className="overflow-y-auto max-h-[60vh]">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-muted border-b border-border">
                                <th className="px-4 py-2 font-medium">{i18n.t("scheduledtasks:history.status")}</th>
                                <th className="px-2 py-2 font-medium">{i18n.t("scheduledtasks:history.duration")}</th>
                                <th className="px-2 py-2 font-medium">{i18n.t("scheduledtasks:history.error")}</th>
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
