// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TabAgentStatusEntry } from "@/app/agent-status/agent-status-tab-aggregate";
import type { TabAgentStatusDot, TabAgentStatusDotKind } from "@/app/agent-status/agent-status-tab-aggregate";
import { agentStatusAccent } from "@/app/agent-status/agent-status-view";
import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { sortBadgesForTab } from "@/app/store/badge";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { normalizeTabAgentStatusMode, type TabAgentStatusMode } from "./tab-agent-status-mode";
import { cn, makeIconClass } from "@/util/util";
import { useMemo, type CSSProperties } from "react";
import { v7 as uuidv7 } from "uuid";

export interface TabBadgesProps {
    badges?: Badge[] | null;
    flagColor?: string | null;
    /** Legacy unread-only dots. Kept for compatibility with older consumers/tests. */
    agentDots?: TabAgentStatusDot[] | null;
    /** Full per-Agent status list used by B / C / G. */
    agentStatuses?: TabAgentStatusEntry[] | null;
    agentStatusMode?: TabAgentStatusMode;
    /** Horizontal tabs show fewer tokens; vertical tabs can pass a larger limit. */
    maxAgentTokens?: number;
    className?: string;
}

const DefaultClassName =
    "tab-badges pointer-events-none absolute left-[4px] top-1/2 z-[3] flex h-[20px] min-w-[20px] -translate-y-1/2 items-center justify-center gap-[3px] px-[2px] py-[1px]";

// Legacy main-slot icons: D=check, S=clock, R=dot.
function tabDotIcon(kind: TabAgentStatusDotKind): string {
    if (kind === "D") return "circle-check";
    if (kind === "S") return "clock-rotate-left";
    return "circle-dot";
}

const TabDotPriority: Record<TabAgentStatusDotKind, number> = {
    D: 1000,
    R: 600,
    S: 400,
};

function dotToBadge(dot: TabAgentStatusDot, badgeId: string): Badge {
    return {
        icon: tabDotIcon(dot.kind),
        color: dot.color,
        priority: TabDotPriority[dot.kind],
        badgeid: badgeId,
    };
}

function TabAgentAvatar({ entry }: { entry: TabAgentStatusEntry }) {
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const icon = getAgentIcon(entry.provider, {
        meta: entry.meta as MetaType | null,
        personas,
        sessionEmojis,
        sessionId: entry.sessionId,
    });
    const color = agentStatusAccent(entry.view.tone, entry.view.read);
    const title = entry.view.title;
    return (
        <span
            className={cn(
                "tab-agent-avatar",
                `is-${entry.view.state}`,
                entry.view.read === "seen" && "is-seen",
                entry.view.state === "working" && "is-working"
            )}
            style={{ "--agent-status-color": color } as CSSProperties}
            title={title}
            aria-label={title}
            data-agent-block-id={entry.blockId}
            data-agent-state={entry.view.state}
            data-agent-read={entry.view.read}
        >
            <span className="tab-agent-avatar-icon" aria-hidden="true">
                {icon?.kind === "emoji" ? (
                    <span className="tab-agent-avatar-emoji">{icon.emoji}</span>
                ) : icon?.kind === "logo" ? (
                    <span style={{ color: icon.iconColor }}>{icon.icon}</span>
                ) : (
                    <i className="fa-sharp fa-solid fa-robot" />
                )}
            </span>
            <span className="tab-agent-avatar-dot" aria-hidden="true" />
        </span>
    );
}

function LegacyBadgeStack({ badges }: { badges: Badge[] }) {
    if (badges.length === 0) return null;
    const firstBadge = badges[0];
    const extraBadges = badges.slice(1, 3);
    return (
        <span className="tab-legacy-badges">
            <i
                className={makeIconClass(firstBadge.icon, true, { defaultIcon: "circle-small" }) + " text-[12px]"}
                style={{ color: firstBadge.color || "#fbbf24" }}
            />
            {extraBadges.length > 0 && (
                <span className="ml-[2px] flex flex-col items-center justify-center gap-[2px]">
                    {extraBadges.map((badge, idx) => (
                        <span
                            key={idx}
                            className="h-[4px] w-[4px] rounded-full"
                            style={{ backgroundColor: badge.color || "#fbbf24" }}
                        />
                    ))}
                </span>
            )}
        </span>
    );
}

function AgentStatusSurface({
    entries,
    mode,
    maxAgentTokens,
}: {
    entries: TabAgentStatusEntry[];
    mode: TabAgentStatusMode;
    maxAgentTokens: number;
}) {
    const visibleAvatars = mode === "rail" ? [] : entries.slice(0, maxAgentTokens);
    const hiddenAvatars = entries.length - visibleAvatars.length;
    const hiddenTitle = useMemo(() => {
        if (hiddenAvatars <= 0) return "";
        return entries
            .slice(maxAgentTokens)
            .map((entry) => `${entry.view.label} — ${entry.provider}`)
            .join("\n");
    }, [entries, hiddenAvatars, maxAgentTokens]);

    return (
        <>
            {visibleAvatars.length > 0 && (
                <span
                    className="tab-agent-avatars"
                    data-agent-visible={visibleAvatars.length}
                    data-agent-hidden={hiddenAvatars}
                >
                    {visibleAvatars.map((entry) => (
                        <TabAgentAvatar key={entry.blockId} entry={entry} />
                    ))}
                    {hiddenAvatars > 0 && (
                        <span className="tab-agent-overflow" title={hiddenTitle} aria-label={hiddenTitle}>
                            +{hiddenAvatars}
                        </span>
                    )}
                </span>
            )}
            {mode !== "avatars" && (
                <span
                    className="tab-agent-rail"
                    aria-label={entries.map((entry) => entry.view.title).join()}
                    data-agent-total={entries.length}
                >
                    {entries.map((entry) => {
                        const color = agentStatusAccent(entry.view.tone, entry.view.read);
                        return (
                            <span
                                key={entry.blockId}
                                className={cn(
                                    "tab-agent-rail-segment",
                                    `is-${entry.view.state}`,
                                    entry.view.read === "seen" && "is-seen",
                                    entry.view.state === "working" && "is-working"
                                )}
                                style={{ "--agent-status-color": color } as CSSProperties}
                                title={entry.view.title}
                                data-agent-block-id={entry.blockId}
                                data-agent-state={entry.view.state}
                                data-agent-read={entry.view.read}
                            />
                        );
                    })}
                </span>
            )}
        </>
    );
}

export function TabBadges({
    badges,
    flagColor,
    agentDots,
    agentStatuses,
    agentStatusMode,
    maxAgentTokens = 3,
    className,
}: TabBadgesProps) {
    const flagBadgeId = useMemo(() => uuidv7(), []);
    const agentBadgeIds = useMemo(
        () => (agentDots ?? []).map(() => uuidv7()),
        [agentDots]
    );
    const baseBadges = useMemo(() => {
        const base = badges ?? [];
        if (!flagColor) return sortBadgesForTab(base);
        const flagBadge: Badge = { icon: "flag", color: flagColor, priority: 0, badgeid: flagBadgeId };
        return sortBadgesForTab([...base, flagBadge]);
    }, [badges, flagColor, flagBadgeId]);

    // New B / C / G surface. An empty list still means "new pipeline", so legacy
    // unread dots cannot accidentally reappear after a Tab loses its last Agent.
    if (agentStatuses != null) {
        if (agentStatuses.length === 0 && baseBadges.length === 0) return null;
        const mode = normalizeTabAgentStatusMode(agentStatusMode);
        return (
            <div
                className={cn(DefaultClassName, `tab-badges--agent-${mode}`, className)}
                data-agent-status-mode={mode}
                data-agent-total={agentStatuses.length}
            >
                <LegacyBadgeStack badges={baseBadges} />
                {agentStatuses.length > 0 && (
                    <AgentStatusSurface entries={agentStatuses} mode={mode} maxAgentTokens={maxAgentTokens} />
                )}
            </div>
        );
    }

    // Backward-compatible unread-dot renderer.
    const allBadges = useMemo(() => {
        const dots = agentDots ?? [];
        if (dots.length === 0) return baseBadges;
        const agentBadges: Badge[] = dots.map((dot, idx) => dotToBadge(dot, agentBadgeIds[idx]));
        return sortBadgesForTab([...baseBadges, ...agentBadges]);
    }, [baseBadges, agentDots, agentBadgeIds]);
    if (!allBadges[0]) return null;
    return (
        <div className={cn(DefaultClassName, className)}>
            <LegacyBadgeStack badges={allBadges} />
        </div>
    );
}
