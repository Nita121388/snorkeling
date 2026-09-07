// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent TUI 右侧 Message 刻度轨：复用 GUI 的 SessionOutlineRail。
// TUI 不滚动 terminal；点击 tick 只固定显示该用户消息的 ToolTip。

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { getCachedUserOutline, loadUserOutline } from "@/app/store/outline-cache";
import { ensureSessionNote } from "@/app/store/session-note-cache";
import { AISessionsServiceType } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { extractAgentCommandFromTerminalText, resolveAgentSessionId } from "@/app/view/term/agent-session";
import { logAgentSessionEvent } from "@/app/view/term/session-debug";
import type { TermWrap } from "@/app/view/term/termwrap";
import { type OutlinePrompt, SessionOutlineRail } from "@/app/view/session-outline-rail";
import { WOS } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { cn } from "@/util/util";
import * as React from "react";

const OutlinePreviewMaxLength = 400;

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
export function useTerminalAgentSessionId(blockData: Block | null, termWrap: TermWrap | null): string {
    const shellLastCommand = useAtomValueSafe<string | null>(termWrap?.lastCommandAtom);
    const fallbackShellLastCommand = React.useMemo(() => {
        if (shellLastCommand || !termWrap) return shellLastCommand;
        const command = extractAgentCommandFromTerminalText(termWrap.getScrollbackContent());
        return command !== "" ? command : null;
    }, [shellLastCommand, termWrap]);
    const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
    return React.useMemo(
        () => resolveAgentSessionId(meta, fallbackShellLastCommand).sessionId,
        [fallbackShellLastCommand, meta]
    );
}

/**
 * Agent TUI 右侧 Message rail。
 * 每条用户消息是一根 GUI 同款小横杠；最新消息加长高亮；
 * hover 显示 ToolTip，click 固定 ToolTip，不移动终端滚动位置。
 */
const TermAgentMessageRail = React.memo(({ blockId, blockData, termWrap }: TermAgentMessageRailProps) => {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const sessionId = useTerminalAgentSessionId(blockData, termWrap);
    const connection = agentSessionConnection(blockData);
    const [outline, setOutline] = React.useState<AISessionsUserOutlineResponse | null>(null);

    // Note 不再放在 rail 上，但仍在 rail 挂载时预热，保证 Header hover 卡片首显不等待 RPC。
    React.useEffect(() => {
        if (sessionId !== "") ensureSessionNote(service, sessionId, connection);
    }, [connection, service, sessionId]);

    const refreshOutline = React.useCallback(() => {
        if (sessionId === "") return;
        loadUserOutline(service, sessionId, { connection, limit: 50 })
            .then(setOutline)
            .catch(() => undefined);
    }, [connection, service, sessionId]);

    React.useEffect(() => {
        setOutline(sessionId === "" ? null : getCachedUserOutline(sessionId, connection));
        refreshOutline();
    }, [connection, refreshOutline, sessionId]);

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

    if (sessionId === "") return null;

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
