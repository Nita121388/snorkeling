// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { BlockServiceType } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { resolveAgentSessionIdFromMeta } from "@/app/view/term/agent-session";
import * as jotai from "jotai";
import { useEffect, useMemo, useState } from "react";

export type SessionRunningState = {
    status: "running";
    blockId: string;
    tabId: string;
};

const STATUS_REQUEST_CONCURRENCY = 4;

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex++];
            await task(item);
        }
    });
    await Promise.all(workers);
}

type AgentBlockRef = { blockId: string; sessionId: string; tabId: string };

/**
 * Pure projection from per-block controller statuses to per-session running state.
 * A session is "running" if at least one of its agent blocks has `shellprocstatus === "running"`.
 * Blocks with no status yet (null) or non-running status contribute nothing.
 */
export function projectSessionRunning(
    agentBlocks: AgentBlockRef[],
    statuses: Record<string, BlockControllerRuntimeStatus | null>
): Map<string, SessionRunningState> {
    const map = new Map<string, SessionRunningState>();
    for (const { blockId, sessionId, tabId } of agentBlocks) {
        const status = statuses[blockId];
        if (status == null) continue;
        if (status.shellprocstatus === "running") {
            map.set(sessionId, { status: "running", blockId, tabId });
        }
    }
    return map;
}

function collectAgentBlocks(get: jotai.Getter, tabIds: string[], selfView: string): AgentBlockRef[] {
    const result: AgentBlockRef[] = [];
    for (const tabId of tabIds) {
        const tab = get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        if (tab == null) continue;
        for (const blockId of tab.blockids ?? []) {
            const block = get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (block == null) continue;
            const meta = (block.meta ?? {}) as Record<string, unknown>;
            const view = typeof meta.view === "string" ? meta.view : "";
            if (view === selfView) continue;
            const sessionId = resolveAgentSessionIdFromMeta(meta).trim();
            if (sessionId === "") continue;
            result.push({ blockId, sessionId, tabId });
        }
    }
    return result;
}

export function useSessionsRunning(active: boolean): Map<string, SessionRunningState> {
    const service = useMemo(() => new BlockServiceType(), []);

    const workspace = jotai.useAtomValue(atoms.workspace);
    const tabIds = workspace?.tabids ?? [];
    const tabIdsKey = tabIds.join("\n");
    const agentBlocksAtom = useMemo(
        () => jotai.atom((get) => collectAgentBlocks(get, tabIds, "aisessions")),
        [workspace?.oid, tabIdsKey]
    );
    const agentBlocks = jotai.useAtomValue(agentBlocksAtom);
    const blockIdsKey = agentBlocks
        .map((b) => b.blockId)
        .sort()
        .join("\n");

    const [statuses, setStatuses] = useState<Record<string, BlockControllerRuntimeStatus | null>>({});

    useEffect(() => {
        if (!active) {
            return;
        }
        let cancelled = false;
        const blockIds = agentBlocks.map((b) => b.blockId);
        setStatuses((current) => {
            const next: Record<string, BlockControllerRuntimeStatus | null> = {};
            for (const blockId of blockIds) {
                next[blockId] = current[blockId] ?? null;
            }
            return next;
        });

        void runWithConcurrency(blockIds, STATUS_REQUEST_CONCURRENCY, async (blockId) => {
            try {
                const status = await service.GetControllerStatus(blockId);
                if (cancelled) return;
                setStatuses((current) => ({ ...current, [blockId]: status }));
            } catch {
                if (cancelled) return;
                setStatuses((current) => ({ ...current, [blockId]: null }));
            }
        });

        const unsubscribers = blockIds.map((blockId) =>
            waveEventSubscribeSingle({
                eventType: "controllerstatus",
                scope: WOS.makeORef("block", blockId),
                handler: (event) => {
                    if (event.data == null) return;
                    const incoming = event.data as BlockControllerRuntimeStatus;
                    setStatuses((current) => {
                        const prev = current[blockId];
                        if (prev != null && prev.version > incoming.version) return current;
                        return { ...current, [blockId]: incoming };
                    });
                },
            })
        );

        return () => {
            cancelled = true;
            for (const unsubscribe of unsubscribers) {
                unsubscribe();
            }
        };
    }, [active, service, blockIdsKey]);

    const runningMap = useMemo(() => projectSessionRunning(agentBlocks, statuses), [agentBlocks, statuses]);

    return runningMap;
}
