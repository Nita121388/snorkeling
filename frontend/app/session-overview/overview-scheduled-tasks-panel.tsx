// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 独立「定时任务」区（N-1123-hero-sched-ui）。
//
// 为什么是独立区（不挂在 hero 卡上）：定时任务不是某个 hero 的私有物——同一个 hero
// 可以有多个任务，任务也可以不绑 hero。挂在 hero 卡上会把两类数据耦合死。
//
// 契约（prd）：
//   · 无任务 → 整区不渲染（0 视觉变化，不占一行空白）；
//   · 每卡：hero emoji（有 hero 才画）+ 任务名 + 下次运行时间 + 上次状态 + 启停开关；
//     点击卡 → 打开编辑弹窗；
//   · disabled 保留但置灰（数量守恒），排序与投影在 `overview-scheduled-tasks.ts` 纯函数里。
//
// RPC：拉取走 ScheduledTaskListCommand（与 scheduledtasks-model 同口径）；启停/保存走
// ScheduledTaskUpdateCommand / CreateCommand。读 hero 名册用 store/hero-roster 的缓存加载器
// （编辑弹窗共用一份）。

import { loadHeroRoster } from "@/app/store/hero-roster";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { schedTaskStatusColorVar } from "@/app/view/scheduledtasks/schedtask-shared";
import type { HeroRosterEntry } from "@/app/workspace/hero-launch";
import { i18n } from "@/i18n/config";
import { cn, makeIconClass } from "@/util/util";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    buildScheduledTaskCards,
    type ScheduledTaskCard,
    type ScheduledTaskWithHero,
} from "./overview-scheduled-tasks";

/** 上次状态 → 颜色（收口到 scheduledtasks 共享模块，与 block 视图同口径）。 */
const statusColor = schedTaskStatusColorVar;

export function OverviewScheduledTasksSection(): React.JSX.Element | null {
    const { t } = useTranslation("session-overview");
    const [tasks, setTasks] = useState<ScheduledTaskWithHero[] | null>(null);
    const [heroes, setHeroes] = useState<HeroRosterEntry[]>([]);
    const [now, setNow] = useState(() => Date.now());

    const reload = useCallback(async () => {
        try {
            const list = await RpcApi.ScheduledTaskListCommand(TabRpcClient);
            setTasks((list ?? []) as ScheduledTaskWithHero[]);
            setNow(Date.now());
        } catch (err) {
            console.warn("[overviewScheduledTasks] list failed:", err);
            setTasks([]);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        void reload();
        void loadHeroRoster().then((roster) => {
            if (!cancelled) setHeroes(roster?.heroes ?? []);
        });
        return () => {
            cancelled = true;
        };
    }, [reload]);

    const cards = useMemo(
        () => (tasks == null ? [] : buildScheduledTaskCards(tasks, { heroes, now })),
        [tasks, heroes, now]
    );

    const openEditor = useCallback(
        (taskId: string) => {
            const task = tasks?.find((item) => item.id === taskId);
            if (task == null) return;
            modalsModel.pushModal("ScheduledTaskEditorModal", {
                task: structuredClone(task),
                isNew: false,
                onSave: async (draft: ScheduledTaskWithHero) => {
                    try {
                        draft.updatedAt = new Date().toISOString();
                        await RpcApi.ScheduledTaskUpdateCommand(TabRpcClient, draft);
                        void reload();
                        return null;
                    } catch (err) {
                        return String(err);
                    }
                },
            });
        },
        [tasks, reload]
    );

    const toggleEnabled = useCallback(
        (taskId: string) => {
            const task = tasks?.find((item) => item.id === taskId);
            if (task == null) return;
            const updated = structuredClone(task);
            updated.enabled = !updated.enabled;
            void (async () => {
                try {
                    await RpcApi.ScheduledTaskUpdateCommand(TabRpcClient, updated);
                } catch (err) {
                    console.warn("[overviewScheduledTasks] toggle failed:", err);
                } finally {
                    void reload();
                }
            })();
        },
        [tasks, reload]
    );

    // 无任务（或还没拉到数据）→ 整区不渲染，0 视觉变化。
    if (cards.length === 0) {
        return null;
    }

    return (
        <div className="session-overview-scheduled-tasks" data-overview-scheduled-tasks="">
            <div className="session-overview-scheduled-tasks-title">
                <i className={makeIconClass("clock", false)} />
                <span>{t("session-overview:scheduledTasks.title")}</span>
            </div>
            <div className="session-overview-scheduled-tasks-strip">
                {cards.map((card) => (
                    <ScheduledTaskCardRow key={card.taskId} card={card} onOpen={openEditor} onToggle={toggleEnabled} />
                ))}
            </div>
        </div>
    );
}

function ScheduledTaskCardRow({
    card,
    onOpen,
    onToggle,
}: {
    card: ScheduledTaskCard;
    onOpen: (taskId: string) => void;
    onToggle: (taskId: string) => void;
}): React.JSX.Element {
    const hero =
        card.heroId === "" ? null : card.heroEmoji === "" ? card.heroName : `${card.heroEmoji} ${card.heroName}`;
    return (
        <div
            className={cn("session-overview-scheduled-task-card", !card.enabled && "is-disabled")}
            data-schedtask-id={card.taskId}
            role="button"
            tabIndex={0}
            title={i18n.t("session-overview:scheduledTasks.cardTitle", { name: card.name })}
            onClick={() => onOpen(card.taskId)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(card.taskId);
                }
            }}
        >
            {hero != null && (
                <span className="session-overview-scheduled-task-hero" title={card.heroName}>
                    {hero}
                </span>
            )}
            <span className="session-overview-scheduled-task-name">{card.name}</span>
            <span className="session-overview-scheduled-task-nextrun">
                {card.nextRunLabel !== "" ? card.nextRunLabel : "—"}
            </span>
            <span
                className="session-overview-scheduled-task-status"
                data-schedtask-status={card.lastStatus || "pending"}
                style={{ color: statusColor(card.lastStatus) }}
            >
                {card.lastStatus !== "" ? card.lastStatus : i18n.t("session-overview:scheduledTasks.statusPending")}
            </span>
            <button
                type="button"
                className={cn("session-overview-scheduled-task-toggle", card.enabled && "is-on")}
                data-schedtask-toggle=""
                role="switch"
                aria-checked={card.enabled}
                aria-label={i18n.t("session-overview:scheduledTasks.toggleLabel", { name: card.name })}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle(card.taskId);
                }}
            />
        </div>
    );
}
