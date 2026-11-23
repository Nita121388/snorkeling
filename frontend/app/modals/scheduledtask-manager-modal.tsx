// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 定时任务管理面（任务 11-23-schedtask-modal）。
//
// 为什么弹窗化：以前管理定时任务必须开一个 `scheduledtasks` Block 视图（块内 absolute
// overlay 编辑），管理面被块边界裁切、还要先"建块"才能管理。现在管理面复用全仓唯一
// 弹窗壳 `<Modal>`（与 CommonText compose 同款 chrome：结构化 header / ✕ / Esc / footer），
// 打开即用，不再建块、不页面跳转。
//
// 契约：
//   · 列表数据走 `ScheduledTaskListCommand`；增删改后**局部 state 即时 ±1**，不整块刷新/重挂；
//   · 新建 / 编辑都 `pushModal("ScheduledTaskEditorModal", ...)` 复用既有表单（不复制字段，
//     hero 选择器也随编辑弹窗一起带过来）；
//   · 删除走二次确认（行内 confirm，不弹 window.confirm，避免模态叠模态）；
//   · 启停就地改一条（条数守恒）；
//   · 打开/关闭时的 `atoms.modalOpen` 由 `<Modal>` 经 modal-open-registry 自动登记，
//     这里**不**手工再写一遍；
//   · Esc：焦点在弹窗内时自己关；焦点在 body 时由 keymodel 的全局 Escape →
//     `modalsModel.cancelTopModal()` 兜底（与既有弹窗同口径）。
//
// 兼容：`scheduledtasks` Block 视图保留可用（老布局不失效），只是不再是唯一入口。

import { Modal } from "@/app/modals/modal";
import { loadHeroRoster } from "@/app/store/hero-roster";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { describeSchedule, schedTaskStatusColorVar } from "@/app/view/scheduledtasks/schedtask-shared";
import type { HeroRosterEntry } from "@/app/workspace/hero-launch";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export type ScheduledTaskManagerModalProps = {
    /** 关闭回调。默认 pop 栈顶（弹窗经 modalsModel 打开时无需传）。 */
    onClose?: () => void;
};

/** 本弹窗在 modalregistry 里的 displayName（必须稳定：栈判定、Esc 顶栈判定都靠它）。 */
export const ScheduledTaskManagerModalName = "ScheduledTaskManagerModal";

function nowIso(): string {
    return new Date().toISOString();
}

function newTaskId(): string {
    try {
        return crypto.randomUUID();
    } catch {
        return "task-" + Date.now();
    }
}

/** 给编辑弹窗的空白草稿（agent/model 由编辑弹窗自己按 catalog 补齐）。 */
function makeDefaultDraft(): ScheduledTaskType {
    return {
        id: "",
        name: "",
        enabled: true,
        prompt: "",
        workdir: "",
        connection: "local",
        schedule: { type: "daily", timeOfDay: "09:00", timezone: "Asia/Shanghai" },
        notifyOnComplete: true,
        notifyOnError: true,
        notificationMode: "os",
        createdBy: "user",
    };
}

/** 栈顶是我自己（或直接渲染、根本不在栈上）才响应本地 Esc，避免抢掉编辑弹窗的 Esc。 */
function isTopOfModalStack(): boolean {
    const stack = globalStore.get(modalsModel.modalsAtom);
    if (stack.length === 0) {
        return true;
    }
    return stack[stack.length - 1]?.displayName === ScheduledTaskManagerModalName;
}

export function ScheduledTaskManagerModal({ onClose }: ScheduledTaskManagerModalProps): React.JSX.Element {
    const { t } = useTranslation("modals");
    const [tasks, setTasks] = useState<ScheduledTaskType[]>([]);
    const [heroes, setHeroes] = useState<HeroRosterEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>(null);
    const [status, setStatus] = useState<string>("");
    const [pendingDeleteId, setPendingDeleteId] = useState<string>(null);

    const heroById = useMemo(() => {
        const map = new Map<string, HeroRosterEntry>();
        for (const hero of heroes) {
            map.set(hero.id, hero);
        }
        return map;
    }, [heroes]);

    const handleClose = useCallback(() => {
        if (onClose != null) {
            onClose();
            return;
        }
        modalsModel.popModal();
    }, [onClose]);

    const handleCloseRef = useRef(handleClose);
    handleCloseRef.current = handleClose;

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await RpcApi.ScheduledTaskListCommand(TabRpcClient);
                if (!cancelled) setTasks(list ?? []);
            } catch (e) {
                if (!cancelled) setError(String(e));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        void loadHeroRoster()
            .then((roster) => {
                if (!cancelled) setHeroes(roster?.heroes ?? []);
            })
            .catch(() => {
                /* hero 名册只影响 emoji 展示，失败静默 */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // 状态提示自动消失（"已排队"之类），与 block 视图同款 3s。
    useEffect(() => {
        if (status === "") return;
        const timer = setTimeout(() => setStatus(""), 3000);
        return () => clearTimeout(timer);
    }, [status]);

    const openCreate = useCallback(() => {
        modalsModel.pushModal("ScheduledTaskEditorModal", {
            task: makeDefaultDraft(),
            isNew: true,
            onSave: async (draft: ScheduledTaskType) => {
                try {
                    draft.id = newTaskId();
                    draft.createdAt = nowIso();
                    draft.updatedAt = draft.createdAt;
                    await RpcApi.ScheduledTaskCreateCommand(TabRpcClient, draft);
                    // 局部 state +1：不整块刷新、不重挂。
                    setTasks((prev) => [...prev, draft]);
                    return null;
                } catch (e) {
                    return String(e);
                }
            },
        });
    }, []);

    const openEdit = useCallback((task: ScheduledTaskType) => {
        modalsModel.pushModal("ScheduledTaskEditorModal", {
            task: structuredClone(task),
            isNew: false,
            onSave: async (draft: ScheduledTaskType) => {
                try {
                    draft.updatedAt = nowIso();
                    await RpcApi.ScheduledTaskUpdateCommand(TabRpcClient, draft);
                    setTasks((prev) => prev.map((item) => (item.id === draft.id ? { ...item, ...draft } : item)));
                    return null;
                } catch (e) {
                    return String(e);
                }
            },
        });
    }, []);

    const toggleEnabled = useCallback((task: ScheduledTaskType) => {
        const updated = structuredClone(task);
        updated.enabled = !updated.enabled;
        // 乐观就地改一条（条数守恒）：失败再回滚。
        setTasks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        void (async () => {
            try {
                await RpcApi.ScheduledTaskUpdateCommand(TabRpcClient, updated);
            } catch (e) {
                setError(String(e));
                setTasks((prev) => prev.map((item) => (item.id === task.id ? task : item)));
            }
        })();
    }, []);

    const deleteTask = useCallback((task: ScheduledTaskType) => {
        setPendingDeleteId(null);
        void (async () => {
            try {
                await RpcApi.ScheduledTaskDeleteCommand(TabRpcClient, task.id);
                // 局部 state -1。
                setTasks((prev) => prev.filter((item) => item.id !== task.id));
            } catch (e) {
                setError(String(e));
            }
        })();
    }, []);

    const runNow = useCallback((task: ScheduledTaskType) => {
        void (async () => {
            try {
                await RpcApi.ScheduledTaskRunNowCommand(TabRpcClient, task.id);
                setStatus(i18n.t("modals:schedTaskManager.queued", { name: task.name }));
            } catch (e) {
                setError(String(e));
            }
        })();
    }, []);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key !== "Escape") return;
        if (!isTopOfModalStack()) return;
        e.stopPropagation();
        e.preventDefault();
        handleCloseRef.current();
    }, []);

    return (
        <Modal
            title={t("modals:schedTaskManager.title")}
            subtitle={t("modals:schedTaskManager.subtitle")}
            onClose={handleClose}
            padding={false}
            scrollBody={false}
            className="schedtask-manager-modal"
        >
            {/* Esc 挂在内容根上：React 事件在 #main 根容器收口，stopPropagation 可挡住
                keymodel 的 document 级全局 Escape，避免"自己关一次、全局再关一次"。 */}
            <div className="schedtask-manager flex flex-col min-h-0 h-full" onKeyDown={handleKeyDown}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
                    <span className="text-xs text-muted flex-1">
                        {i18n.t("modals:schedTaskManager.count", { count: tasks.length })}
                    </span>
                    <button
                        type="button"
                        data-schedtask-new=""
                        className="px-2.5 py-1 text-xs rounded bg-action text-actiontext hover:bg-actionhover cursor-pointer"
                        onClick={openCreate}
                    >
                        {t("modals:schedTaskManager.newTask")}
                    </button>
                </div>

                {error != null && <div className="px-4 py-2 text-xs text-error shrink-0">{error}</div>}
                {status !== "" && <div className="px-4 py-1 text-xs text-muted shrink-0">{status}</div>}

                {loading ? (
                    <div className="flex-1 flex items-center justify-center text-secondary text-sm">
                        {t("modals:schedTaskManager.loading")}
                    </div>
                ) : tasks.length === 0 ? (
                    <div
                        data-schedtask-empty=""
                        className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center"
                    >
                        <i className="fa-sharp fa-solid fa-clock text-3xl text-muted" />
                        <div className="text-sm font-semibold text-secondary">
                            {t("modals:schedTaskManager.empty.title")}
                        </div>
                        <div className="text-xs text-muted">{t("modals:schedTaskManager.empty.description")}</div>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto wide-scrollbar">
                        {tasks.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                hero={task.hero != null && task.hero !== "" ? heroById.get(task.hero) : null}
                                pendingDelete={pendingDeleteId === task.id}
                                onEdit={() => openEdit(task)}
                                onToggle={() => toggleEnabled(task)}
                                onRun={() => runNow(task)}
                                onDeleteClick={() => setPendingDeleteId(task.id)}
                                onDeleteCancel={() => setPendingDeleteId(null)}
                                onDeleteConfirm={() => deleteTask(task)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}

function TaskRow({
    task,
    hero,
    pendingDelete,
    onEdit,
    onToggle,
    onRun,
    onDeleteClick,
    onDeleteCancel,
    onDeleteConfirm,
}: {
    task: ScheduledTaskType;
    hero: HeroRosterEntry | null;
    pendingDelete: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onRun: () => void;
    onDeleteClick: () => void;
    onDeleteCancel: () => void;
    onDeleteConfirm: () => void;
}): React.JSX.Element {
    const { t } = useTranslation("modals");
    const scheduleText = describeSchedule(task.schedule);
    const statusText = task.lastRunStatus ?? t("modals:schedTaskManager.statusPending");
    return (
        <div
            data-schedtask-row=""
            data-schedtask-id={task.id}
            className={cn(
                "flex items-center gap-2 px-4 py-2 border-b border-border hover:bg-hoverbg",
                !task.enabled && "opacity-70"
            )}
        >
            <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    {hero != null && (
                        <span data-schedtask-hero="" title={hero.name} className="shrink-0">
                            {(hero.emoji ?? "") !== "" ? hero.emoji : hero.name}
                        </span>
                    )}
                    <span
                        className={cn("text-sm truncate", task.enabled ? "text-primary" : "text-muted line-through")}
                        title={task.name}
                    >
                        {task.name}
                    </span>
                </div>
                <div className="text-[11px] text-muted truncate">{scheduleText}</div>
            </div>
            <span
                data-schedtask-status={task.lastRunStatus ?? "pending"}
                className="text-[11px] shrink-0"
                style={{ color: schedTaskStatusColorVar(task.lastRunStatus) }}
            >
                {statusText}
            </span>
            <button
                type="button"
                data-schedtask-toggle=""
                role="switch"
                aria-checked={task.enabled}
                aria-label={i18n.t("modals:schedTaskManager.toggleLabel", { name: task.name })}
                className="shrink-0 hover:bg-hoverbg rounded p-1 cursor-pointer"
                onClick={onToggle}
            >
                <i className={cn("fa-solid", task.enabled ? "fa-toggle-on text-accent" : "fa-toggle-off text-muted")} />
            </button>
            <button
                type="button"
                data-schedtask-run=""
                title={t("modals:schedTaskManager.actions.runNow")}
                className="shrink-0 hover:bg-hoverbg rounded p-1 cursor-pointer"
                onClick={onRun}
            >
                <i className="fa-solid fa-play" />
            </button>
            <button
                type="button"
                data-schedtask-edit=""
                title={t("modals:schedTaskManager.actions.edit")}
                className="shrink-0 hover:bg-hoverbg rounded p-1 cursor-pointer"
                onClick={onEdit}
            >
                <i className="fa-solid fa-pen-to-square" />
            </button>
            {pendingDelete ? (
                <span className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        data-schedtask-delete-confirm=""
                        className="px-1.5 py-0.5 text-[11px] rounded bg-error text-white cursor-pointer"
                        onClick={onDeleteConfirm}
                    >
                        {t("modals:schedTaskManager.actions.confirmDelete")}
                    </button>
                    <button
                        type="button"
                        data-schedtask-delete-cancel=""
                        className="px-1.5 py-0.5 text-[11px] rounded bg-actionsoft text-actionsofttext cursor-pointer"
                        onClick={onDeleteCancel}
                    >
                        {t("modals:schedTaskManager.actions.cancelDelete")}
                    </button>
                </span>
            ) : (
                <button
                    type="button"
                    data-schedtask-delete=""
                    title={t("modals:schedTaskManager.actions.delete")}
                    className="shrink-0 hover:bg-hoverbg rounded p-1 cursor-pointer text-error"
                    onClick={onDeleteClick}
                >
                    <i className="fa-solid fa-trash" />
                </button>
            )}
        </div>
    );
}

ScheduledTaskManagerModal.displayName = ScheduledTaskManagerModalName;
