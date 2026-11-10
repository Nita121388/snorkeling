// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent TUI 右侧 Message 刻度轨：复用 GUI 的 SessionOutlineRail。
// TUI 不滚动 terminal；点击 tick 只固定显示该用户消息的 ToolTip。

import { getCachedUserOutline, loadUserOutline } from "@/app/store/outline-cache";
import { AISessionsServiceType } from "@/app/store/services";
import { ensureSessionNote } from "@/app/store/session-note-cache";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { type OutlinePrompt, SessionOutlineRail } from "@/app/view/session-outline-rail";
import { extractAgentCommandFromTerminalText, resolveAgentSessionId } from "@/app/view/term/agent-session";
import { logAgentSessionEvent } from "@/app/view/term/session-debug";
import type { TermWrap } from "@/app/view/term/termwrap";
import { WOS } from "@/store/global";
import { cn, fireAndForget, useAtomValueSafe } from "@/util/util";
import * as React from "react";

const OutlinePreviewMaxLength = 400;

// 刷新节奏（见下方刷新 effect）：
// - 快重试：新会话首条用户消息落盘前 outline 必然为空，3s 一次把「首拉即空永久停落」
//   旧问题盖住；上限 ~2 分钟后降级，避免用户只是开着 agent 没说话时无限空转。
// - 事件驱动：agentstatus 每次 turn 后都会来事件，去抖后立刻 forced 补拉。
// - 慢轮询：没有装 hook 的 provider 靠 30s 轮询兑底。
const OutlineFastRetryDelayMs = 3_000;
const OutlineFastRetryMaxAttempts = 40;
const OutlineSlowIntervalMs = 30_000;
const OutlineStatusDebounceMs = 800;
const OutlineStatusMinIntervalMs = 2_000;

function hasUserPrompts(outline: AISessionsUserOutlineResponse | null): boolean {
    return (outline?.messages ?? []).some((message) => message.role === "user" && message.text?.trim() !== "");
}

type TermAgentMessageRailProps = {
    blockId: string;
    blockData: Block | null;
    termWrap: TermWrap | null;
};

function agentSessionConnection(blockData: Block | null): string | undefined {
    const connection = blockData?.meta?.connection;
    return typeof connection === "string" && connection.trim() !== "" ? connection.trim() : undefined;
}

function userOutlinePreview(text: string): string {
    const normalized = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join("\n")
        .replace(/[ \t]+/g, " ")
        .trim();
    return normalized.length <= OutlinePreviewMaxLength
        ? normalized
        : `${normalized.slice(0, OutlinePreviewMaxLength).trim()}...`;
}

/** TUI 会话 sessionId 解析：meta → shell lastcmd → scrollback。 */
export function useTerminalAgentSessionId(
    blockData: Block | null,
    termWrap: TermWrap | null
): { sessionId: string; isAgent: boolean } {
    const shellLastCommand = useAtomValueSafe<string | null>(termWrap?.lastCommandAtom);
    const fallbackShellLastCommand = React.useMemo(() => {
        if (shellLastCommand || !termWrap) return shellLastCommand;
        const command = extractAgentCommandFromTerminalText(termWrap.getScrollbackContent());
        return command !== "" ? command : null;
    }, [shellLastCommand, termWrap]);
    const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
    return React.useMemo(() => {
        const resolution = resolveAgentSessionId(meta, fallbackShellLastCommand);
        return { sessionId: resolution.sessionId, isAgent: resolution.isAgent };
    }, [fallbackShellLastCommand, meta]);
}

/**
 * Agent TUI 右侧 Message rail。
 * 每条用户消息是一根 GUI 同款小横杠；最新消息加长高亮；
 * hover 显示 ToolTip，click 固定 ToolTip，不移动终端滚动位置。
 */
const TermAgentMessageRail = React.memo(({ blockId, blockData, termWrap }: TermAgentMessageRailProps) => {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const agentSession = useTerminalAgentSessionId(blockData, termWrap);
    const { sessionId, isAgent } = agentSession;
    const connection = agentSessionConnection(blockData);
    const [outline, setOutline] = React.useState<AISessionsUserOutlineResponse | null>(null);

    // Note 不再放在 rail 上，但仍在 rail 挂载时预热，保证 Header hover 卡片首显不等待 RPC。
    React.useEffect(() => {
        if (sessionId !== "") ensureSessionNote(service, sessionId, connection);
    }, [connection, service, sessionId]);

    // Outline 刷新调度：只在 sessionId 变化时拉一次的旧实现，让新会话「首拉即空 → 轨道
    // 永久消失」（第一条用户消息在首拉之后才落盘）。这里改成：挂载先拉一次 →
    // 空结果快重试 / 非空慢轮询，同时订阅 agentstatus 事件做即时 forced 补拉。
    React.useEffect(() => {
        if (sessionId === "") {
            setOutline(null);
            return;
        }
        setOutline(getCachedUserOutline(sessionId, connection));
        let disposed = false;
        let refreshTimer: number | null = null;
        let statusTimer: number | null = null;
        let fastAttempts = 0;
        let fastMode = true;
        let lastForcedAt = 0;

        const clearRefreshTimer = (): void => {
            if (refreshTimer != null) {
                window.clearTimeout(refreshTimer);
                refreshTimer = null;
            }
        };

        const schedule = (delayMs: number): void => {
            clearRefreshTimer();
            refreshTimer = window.setTimeout(() => {
                refreshTimer = null;
                load(false);
            }, delayMs);
        };

        const scheduleAfterResult = (hasPrompts: boolean): void => {
            if (hasPrompts) {
                fastMode = false;
                schedule(OutlineSlowIntervalMs);
                return;
            }
            if (fastMode && ++fastAttempts <= OutlineFastRetryMaxAttempts) {
                schedule(OutlineFastRetryDelayMs);
                return;
            }
            fastMode = false;
            schedule(OutlineSlowIntervalMs);
        };

        function load(force: boolean): void {
            if (disposed) return;
            // 窗口隐藏时不打 RPC，短延迟重排等可见。
            if (document.visibilityState === "hidden") {
                schedule(OutlineFastRetryDelayMs);
                return;
            }
            if (force) lastForcedAt = Date.now();
            loadUserOutline(service, sessionId, { connection, limit: 50, forceRefresh: force })
                .then((next) => {
                    if (disposed) return;
                    setOutline(next);
                    scheduleAfterResult(hasUserPrompts(next));
                })
                .catch(() => {
                    if (disposed) return;
                    // 会话文件还没创建（新建块比第一条消息早）等错误按空结果重试。
                    scheduleAfterResult(false);
                });
        }

        load(false);

        const unsubscribe = waveEventSubscribeSingle({
            eventType: "agentstatus",
            scope: WOS.makeORef("block", blockId),
            handler: () => {
                if (disposed || document.visibilityState === "hidden") return;
                if (Date.now() - lastForcedAt < OutlineStatusMinIntervalMs) return;
                if (statusTimer != null) return;
                statusTimer = window.setTimeout(() => {
                    statusTimer = null;
                    if (disposed) return;
                    clearRefreshTimer();
                    load(true);
                }, OutlineStatusDebounceMs);
            },
        });

        return () => {
            disposed = true;
            clearRefreshTimer();
            if (statusTimer != null) window.clearTimeout(statusTimer);
            unsubscribe();
        };
    }, [blockId, connection, service, sessionId]);

    // sessionId 回写 meta，让 Block Header 与 TUI 共用同一真相源。
    const persistedSessionId = React.useMemo(() => {
        const sid = (blockData?.meta as Record<string, unknown> | undefined)?.["agent:sessionid"];
        return typeof sid === "string" ? sid.trim() : "";
    }, [blockData]);
    React.useEffect(() => {
        if (sessionId === "" || persistedSessionId !== "") return;
        fireAndForget(async () => {
            try {
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "agent:sessionid": sessionId } as MetaType,
                });
                logAgentSessionEvent("agent.rail", "persist-sessionid", blockId, sessionId, { outcome: "ok" });
            } catch (error) {
                logAgentSessionEvent("agent.rail", "persist-sessionid", blockId, sessionId, {
                    outcome: "error",
                    reason: String(error),
                });
            }
        });
    }, [blockId, persistedSessionId, sessionId]);

    // 新建 Agent 在首条消息落盘前还没有 sessionId；仍保留空 rail，
    // 避免新会话与恢复会话的布局/挂载路径不同。拿到 sessionId 后，
    // 上面的 effect 会立即加载 outline 并回写 block meta。
    if (!isAgent && sessionId === "") return null;

    const userMessages = (outline?.messages ?? []).filter(
        (message) => message.role === "user" && message.text?.trim() !== ""
    );
    const prompts: OutlinePrompt[] = userMessages.map((message) => ({
        seq: message.seq,
        preview: userOutlinePreview(message.text),
    }));
    const activeSeq = prompts.length > 0 ? prompts[prompts.length - 1].seq : null;

    return (
        <div className={cn("term-agent-msg-rail", prompts.length >= 2 && "has-messages")}>
            <SessionOutlineRail prompts={prompts} activeSeq={activeSeq} />
        </div>
    );
});

TermAgentMessageRail.displayName = "TermAgentMessageRail";

export { TermAgentMessageRail };
