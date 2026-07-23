// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabAgentStatusDot } from "@/app/agent-status/agent-status-tab-aggregate";
import { sortBadgesForTab } from "@/app/store/badge";
import { cn, makeIconClass } from "@/util/util";
import { useMemo } from "react";
import { v7 as uuidv7 } from "uuid";

export interface TabBadgesProps {
    badges?: Badge[] | null;
    flagColor?: string | null;
    /** C 层 agent-status 聚合点 (22 号方案). 不进 badge.ts set/clear 管线, 仅借 TabBadges 槽位渲染. */
    agentDots?: TabAgentStatusDot[] | null;
    className?: string;
}

const DefaultClassName =
    "tab-badges pointer-events-none absolute left-[4px] top-1/2 z-[3] flex h-[20px] w-[20px] -translate-y-1/2 items-center justify-center px-[2px] py-[1px]";

function dotToBadge(dot: TabAgentStatusDot, badgeId: string): Badge {
    return {
        icon: dot.kind === "D" ? "circle-check" : "circle-dot",
        color: dot.color,
        // D (完成态未阅) 与 R (working/blocked) 在主槽竞争时, 让 D 的 priority 高一些;
        // 与 collectBlockDots 的 rankPriority 量级对齐, 但保持用 badge.ts 的 sortBadgesForTab
        // 兼容现有 priority 数字语义 (priority 大者居主槽).
        priority: dot.kind === "D" ? 1000 : 600,
        badgeid: badgeId,
    };
}

export function TabBadges({ badges, flagColor, agentDots, className }: TabBadgesProps) {
    const flagBadgeId = useMemo(() => uuidv7(), []);
    const agentBadgeIds = useMemo(
        () => (agentDots ?? []).map(() => uuidv7()),
        [agentDots]
    );
    const allBadges = useMemo(() => {
        const base = badges ?? [];
        const dots = agentDots ?? [];
        if (dots.length === 0 && !flagColor) {
            return base;
        }
        const agentBadges: Badge[] = dots.map((dot, idx) => dotToBadge(dot, agentBadgeIds[idx]));
        const combined = [...base, ...agentBadges];
        if (!flagColor) {
            return sortBadgesForTab(combined);
        }
        const flagBadge: Badge = { icon: "flag", color: flagColor, priority: 0, badgeid: flagBadgeId };
        return sortBadgesForTab([...combined, flagBadge]);
    }, [badges, flagColor, flagBadgeId, agentDots, agentBadgeIds]);
    if (!allBadges[0]) {
        return null;
    }
    const firstBadge = allBadges[0];
    const extraBadges = allBadges.slice(1, 3);
    return (
        <div className={cn(DefaultClassName, className)}>
            <i
                className={makeIconClass(firstBadge.icon, true, { defaultIcon: "circle-small" }) + " text-[12px]"}
                style={{ color: firstBadge.color || "#fbbf24" }}
            />
            {extraBadges.length > 0 && (
                <div className="ml-[2px] flex flex-col items-center justify-center gap-[2px]">
                    {extraBadges.map((badge, idx) => (
                        <div
                            key={idx}
                            className="h-[4px] w-[4px] rounded-full"
                            style={{ backgroundColor: badge.color || "#fbbf24" }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
