// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab「更多」下拉行的悬浮 Agent Card。
//
// 消费方: tab-more-menu.tsx 的 TabMoreRowItem（只在 InfoCardPortal 打开时被渲染，
// 因此这里的 agent 状态订阅/block 读取也只在 hover 期间存在）。
//
// 口径：
//  - 1 个 agent block → 直接复用 AgentHoverCard（与 block header 悬浮卡完全一致）。
//  - ≥2 个 → 「N agents in this tab」标题 + 首块完整卡 + 其余紧凑行（AgentMiniRow）。
//  - 0 个 → 返回 null（调用方据此不挂 portal）。
//
// 排序：按 agent 状态 updatedAt 降序；拿不到状态时间时退回 blockIds 原始顺序。

import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import { CopyButton } from "@/app/element/copybutton";
import { agentStatusPresentation, formatAgentProvider } from "@/app/agent-status/agent-status-derive";
import { resolveBlockSessionId } from "@/app/block/block-info-card-meta";
import { makeORef } from "@/app/store/wos";
import { useAgentStatusForCard } from "@/app/store/session-note-hook";
import { normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { copyText } from "@/util/clipboard";
import { cn } from "@/util/util";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { atom, Atom, useAtomValue } from "jotai";
import { memo, useMemo, useState } from "react";
import { collectTabAgentBlocks, TabAgentBlockRef } from "./tab-more-model";

type TabMoreAgentCardEnv = WaveEnvSubset<{ wos: WaveEnv["wos"] }>;

// 以 env 为一级键避免测试里不同 mock env 之间复用同一份 atom 缓存（同 TabMoreMetaAtomCache 的坑）。
const AgentBlocksAtomCache = new WeakMap<object, Map<string, Atom<TabAgentBlockRef[]>>>();

function getAgentBlocksAtom(blockIds: readonly string[], env: TabMoreAgentCardEnv): Atom<TabAgentBlockRef[]> {
    const key = blockIds.join(" ");
    let byKey = AgentBlocksAtomCache.get(env);
    if (byKey == null) {
        byKey = new Map();
        AgentBlocksAtomCache.set(env, byKey);
    }
    const cached = byKey.get(key);
    if (cached != null) {
        return cached;
    }
    const store = AgentStatusStore.getInstance();
    const derived = atom<TabAgentBlockRef[]>((get) =>
        collectTabAgentBlocks(
            blockIds,
            (blockId) => get(env.wos.getWaveObjectAtom<Block>(makeORef("block", blockId))) as Block | null,
            (blockId) => {
                const statusAtom = store.peekPresentedStatusAtom(blockId) ?? store.peekStatusAtom(blockId);
                if (statusAtom == null) {
                    return 0;
                }
                const status = get(statusAtom);
                return status?.updatedAt ?? 0;
            },
            (block) => block.meta?.["agent:sessionid"] != null || block.meta?.["agent:provider"] != null
        )
    );
    byKey.set(key, derived);
    return derived;
}

/** 首块（或唯一一块）：完整 AgentHoverCard。 */
const AgentBlockCard = memo(({ blockId }: { blockId: string }) => {
    const env = useWaveEnv<TabMoreAgentCardEnv>();
    const blockAtom = useMemo(
        () => env.wos.getWaveObjectAtom<Block>(makeORef("block", blockId)),
        [env, blockId]
    );
    const blockData = useAtomValue(blockAtom);
    return <AgentHoverCard blockId={blockId} blockData={(blockData ?? null) as Block | null} mode="gui" />;
});
AgentBlockCard.displayName = "AgentBlockCard";

/**
 * 紧凑行：logo + provider·model + 状态点 + 短 session id + 复制。
 * 不带 note/tags，避免多 agent 时卡片过高。
 */
const AgentMiniRow = memo(({ blockId }: { blockId: string }) => {
    const env = useWaveEnv<TabMoreAgentCardEnv>();
    const blockAtom = useMemo(
        () => env.wos.getWaveObjectAtom<Block>(makeORef("block", blockId)),
        [env, blockId]
    );
    const blockData = useAtomValue(blockAtom);
    const agentStatus = useAgentStatusForCard(blockId);
    const [copyFailed, setCopyFailed] = useState(false);

    const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
    const rawProvider =
        agentStatus?.provider != null && agentStatus.provider.trim() !== ""
            ? agentStatus.provider
            : normalizeAgentProvider(meta["agent:provider"]);
    const provider = formatAgentProvider(rawProvider);
    const model =
        (meta["agent:requestedmodel"] as string)?.trim() || (meta["model"] as string)?.trim() || "";
    const sessionId = resolveBlockSessionId(meta);
    const statusState = agentStatus?.state ?? "unknown";
    const statusLabel = agentStatus != null ? agentStatusPresentation(agentStatus).label : "";
    const statusAccent =
        statusState === "working"
            ? "var(--agent-working-color)"
            : statusState === "done"
              ? "var(--agent-done-color)"
              : statusState === "blocked" || statusState === "rate-limited"
                ? "var(--warning-color, #f59e0b)"
                : statusState === "error"
                  ? "var(--error-color)"
                  : "var(--secondary-text-color)";
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const agentIcon = getAgentIcon(rawProvider === "" ? "agent" : rawProvider, {
        meta,
        personas,
        sessionEmojis,
        sessionId: (meta["agent:sessionid"] as string | undefined) ?? null,
    });

    return (
        <div
            data-testid="tab-more-agent-mini"
            className="flex items-center gap-2 border-t border-border/60 px-2 py-1.5 text-xs"
        >
            <span
                className="flex h-[14px] w-[14px] shrink-0 items-center justify-center"
                style={agentIcon?.kind === "logo" && agentIcon.iconColor != null ? { color: agentIcon.iconColor } : undefined}
            >
                {agentIcon?.kind === "emoji" ? (
                    <span className="agent-emoji-icon">{agentIcon.emoji}</span>
                ) : agentIcon?.kind === "logo" ? (
                    agentIcon.icon
                ) : (
                    <i className="fa-sharp fa-solid fa-microchip text-[10px]" />
                )}
            </span>
            <span className="shrink-0 truncate text-primary">{provider}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{model || "未指定"}</span>
            {statusLabel !== "" && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted" title={statusLabel}>
                    <span
                        className={cn("h-1.5 w-1.5 rounded-full", {
                            "animate-pulse": statusState === "working",
                        })}
                        style={{ background: statusAccent }}
                    />
                    {statusLabel}
                </span>
            )}
            {sessionId !== "" && (
                <span
                    className={cn(
                        "max-w-[64px] shrink-0 truncate font-mono text-[10px] text-muted",
                        copyFailed && "text-error"
                    )}
                    title={sessionId}
                >
                    {sessionId.slice(0, 8)}
                </span>
            )}
            {sessionId !== "" && (
                <CopyButton
                    title="Copy session id"
                    onClick={async (event) => {
                        event.stopPropagation();
                        setCopyFailed(false);
                        try {
                            await copyText(sessionId);
                        } catch {
                            setCopyFailed(true);
                        }
                    }}
                />
            )}
        </div>
    );
});
AgentMiniRow.displayName = "AgentMiniRow";

export interface TabMoreAgentCardProps {
    agentBlockIds?: readonly string[];
}

/**
 * 一个 Tab 的悬浮 Agent Card 容器。`agentBlockIds` 由 tab-more-model 的 meta 提前算好
 * （与 `blockIds` 同一次 block 读取），这里只在打开时按状态时间排序。
 */
export function TabMoreAgentCard({ agentBlockIds }: TabMoreAgentCardProps) {
    const env = useWaveEnv<TabMoreAgentCardEnv>();
    const blockIds = agentBlockIds ?? [];
    const listKey = blockIds.join(" ");
    const blocksAtom = useMemo(() => getAgentBlocksAtom(blockIds, env), [env, listKey]);
    const refs = useAtomValue(blocksAtom);

    if (refs.length === 0) {
        return null;
    }
    if (refs.length === 1) {
        return <AgentBlockCard blockId={refs[0].blockId} />;
    }
    return (
        <div className="flex w-[300px] flex-col overflow-hidden rounded-lg border border-border bg-modalbg shadow-xl">
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-secondary">
                <i className="fa-sharp fa-solid fa-robot text-[10px]" />
                <span>{refs.length} agents in this tab</span>
            </div>
            <AgentBlockCard blockId={refs[0].blockId} />
            {refs.slice(1).map((ref) => (
                <AgentMiniRow key={ref.blockId} blockId={ref.blockId} />
            ))}
        </div>
    );
}
