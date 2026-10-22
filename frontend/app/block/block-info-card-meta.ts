// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Session 类 Block 的 meta 判定与会话 id 解析。
//
// 为什么单独一个文件：BlockInfoCard 需要对「会话详情 / GUI Chat / Agent」三类 block 做分派，
// 而这三类 block 的会话 id 分散在不同 meta 键上（aisessions:sessionid 与 agent:sessionid）。
// 这里收敛成纯函数，方便单测，也避免把 aisessions 语义塞进 isAgentTerminalMeta
// （那个函数有 5 个直接调用方，属于高风险符号，不改它的语义）。

import { isAgentTerminalMeta } from "@/app/view/term/agent-meta";
import { resolveAgentSessionId } from "@/app/view/term/agent-session";

type MetaRecord = Record<string, unknown> | null | undefined;

const AiSessionsSessionIdMetaKey = "aisessions:sessionid";
const AiSessionsNewChatMetaKey = "aisessions:newchat";
const AgentSessionIdMetaKey = "agent:sessionid";

function trimmedString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * 会话类 Block 的 canonical session id。
 *
 * 顺序：
 *  1. `aisessions:sessionid` —— GUI Chat / 会话详情 block 的权威来源
 *     （对齐 aisessions.tsx 与 agent.tsx 的 getBoundSessionId）。
 *  2. `agent:sessionid` —— TUI agent block 由 OSC / shellcontroller 回写。
 *  3. `resolveAgentSessionId(meta)` —— 从 cmd / cmd:args 解析（codex resume 等）。
 *
 * 返回 `""` 表示该 block 尚未绑定任何会话。
 */
export function resolveBlockSessionId(meta: MetaRecord): string {
    const record = (meta ?? {}) as Record<string, unknown>;
    return (
        trimmedString(record[AiSessionsSessionIdMetaKey]) ||
        trimmedString(record[AgentSessionIdMetaKey]) ||
        trimmedString(resolveAgentSessionId(record).sessionId)
    );
}

/**
 * 单会话详情 block：`view === "aisessions"` 且绑定了 `aisessions:sessionid`。
 *
 * 与 session-detail-block.ts 的 isSessionDetailMeta 保持同一判定，
 * 这里独立实现是为了避免 block 层反向依赖 view 层。
 */
export function isSessionDetailBlockMeta(meta: MetaRecord): boolean {
    const record = (meta ?? {}) as Record<string, unknown>;
    if (record.view !== "aisessions") {
        return false;
    }
    return trimmedString(record[AiSessionsSessionIdMetaKey]) !== "";
}

/**
 * GUI Chat block：`view === "aisessions"`，且要么已绑定会话，要么是 newchat 占位块。
 * newchat 块在第一条消息前没有 session id，也必须能渲染卡片骨架。
 */
export function isChatBlockMeta(meta: MetaRecord): boolean {
    const record = (meta ?? {}) as Record<string, unknown>;
    if (record.view !== "aisessions") {
        return false;
    }
    return (
        trimmedString(record[AiSessionsSessionIdMetaKey]) !== "" || record[AiSessionsNewChatMetaKey] === true
    );
}

/**
 * 需要 InfoCard 的会话类 Block：会话详情、GUI Chat、或任意已绑定会话 id 的 block。
 *
 * 这是 isAgentTerminalMeta 的超集：既保留「有 agent:provider / agent:autoresume 但
 * 还没拿到 session id」的新会话 block，也覆盖 aisessions 的详情/聊天 block。
 * 因此 terminal block 的现有卡片行为不变。
 */
export function isAgentCardMeta(meta: MetaRecord): boolean {
    return (
        isSessionDetailBlockMeta(meta) ||
        isChatBlockMeta(meta) ||
        resolveBlockSessionId(meta) !== "" ||
        isAgentTerminalMeta((meta ?? null) as MetaType)
    );
}
