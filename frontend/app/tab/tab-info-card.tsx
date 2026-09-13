// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TabInfoCard — App Tab 悬浮信息卡。
//
// 展示 Tab 的身份（workspace 图标/颜色 + Tab 全名 + flag 颜色）与内容构成
// （各 block 类型计数），以及 Tab 内所有 Agent block 的实时状态清单。
//
// 设计原则（与 BlockInfoCard 一致）：
//  - 只读信息展示；操作（切换/跳转）留给后续 Phase。
//  - 数据全部来自现成 store：tab/workspace WaveObj、block meta、AgentStatusStore。
//  - 无 agent 的 Tab 只显示身份 + 内容构成，Agent 清单区块自动隐藏。

import {
    InfoCard,
    InfoCardHead,
    InfoCardIcon,
    InfoCardSection,
    InfoCardText,
    InfoCardTitle,
} from "@/app/element/info-card";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import { cn, makeIconClass, useAtomValueSafe } from "@/util/util";
import { isAgentTerminalMeta, normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { getAgentLogoByProvider } from "@/app/view/term/agent-logo";
import { SnorkelingBlockKindMetaKey, SnorkelingBlockKindNote } from "@/app/workspace/toggle-block";
import { getObjectValue, makeORef } from "@/app/store/wos";
import * as React from "react";

// ── block 类型分类 ──

type TabBlockKind = "agent" | "file" | "note" | "terminal" | "other";

function classifyBlock(block: Block | null): TabBlockKind {
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    if (isAgentTerminalMeta(block?.meta ?? null)) {
        return "agent";
    }
    if (meta[SnorkelingBlockKindMetaKey] === SnorkelingBlockKindNote) {
        return "note";
    }
    if (meta.view === "preview") {
        return "file";
    }
    if (meta.view === "term") {
        return "terminal";
    }
    return "other";
}

// ── Agent 状态行（每个 agent block 一个子组件，独立订阅状态） ──

function TabAgentRow({ blockId }: { blockId: string }) {
    const store = AgentStatusStore.getInstance();
    const [statusAtom, setStatusAtom] = React.useState<ReturnType<AgentStatusStore["acquire"]> | null>(null);
    React.useEffect(() => {
        const atom = store.acquire(blockId);
        setStatusAtom(atom);
        return () => store.release(blockId);
    }, [store, blockId]);
    const status = useAtomValueSafe(statusAtom);

    const block = React.useMemo(() => getObjectValue<Block>(makeORef("block", blockId)), [blockId]);
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    const rawProvider = normalizeAgentProvider(meta.provider ?? meta["agent:provider"]);
    const provider = rawProvider === "" ? "Agent" : rawProvider;
    const agentLogo = getAgentLogoByProvider(rawProvider === "" ? "agent" : rawProvider);

    const state = status?.state ?? "unknown";
    const stateColor =
        state === "working"
            ? "var(--agent-working-color)"
            : state === "done"
              ? "var(--agent-done-color)"
              : state === "blocked" || state === "rate-limited"
                ? "var(--warning-color, #f59e0b)"
                : state === "error"
                  ? "var(--error-color)"
                  : "var(--secondary-text-color)";
    const stateLabel =
        status == null
            ? "—"
            : state === "working"
              ? status.phase === "tool"
                  ? status.toolName
                      ? `Tool: ${status.toolName}`
                      : "Tools"
                  : status.phase === "thinking"
                    ? "Thinking"
                    : "Working"
              : state === "done"
                ? "Done"
                : state === "blocked"
                  ? "Blocked"
                  : state === "error"
                    ? "Error"
                    : state === "rate-limited"
                      ? "Rate limited"
                      : state === "stale"
                        ? "Stale"
                        : "Idle";

    return (
        <div className="tab-card-agent-row">
            <span
                className={cn("tab-card-agent-dot", {
                    "is-working": state === "working",
                    "is-thinking": status?.phase === "thinking",
                })}
                style={{ background: stateColor }}
            />
            {agentLogo != null ? (
                <span className="tab-card-agent-logo" style={agentLogo.iconColor != null ? { color: agentLogo.iconColor } : undefined}>
                    {agentLogo.icon}
                </span>
            ) : (
                <InfoCardIcon icon="fa-sharp fa-solid fa-microchip" />
            )}
            <span className="tab-card-agent-provider">{provider}</span>
            <span className="tab-card-agent-state" style={{ color: stateColor }}>
                {stateLabel}
            </span>
        </div>
    );
}

// ── TabInfoCard ──

/**
 * Tab 悬浮信息卡。
 *
 * @param tabId 目标 tab 的 id。
 * @param workspaceId 所属 workspace 的 id（用于取 workspace 图标/颜色/名称）。
 */
export function TabInfoCard({ tabId, workspaceId }: { tabId: string; workspaceId?: string }) {
    const tab = React.useMemo(() => getObjectValue<Tab>(makeORef("tab", tabId)), [tabId]);
    const workspace = React.useMemo(
        () => (workspaceId != null ? getObjectValue<Workspace>(makeORef("workspace", workspaceId)) : null),
        [workspaceId]
    );

    const tabName = tab?.name ?? "";
    const flagColor = tab?.meta?.["tab:flagcolor"] as string | undefined;

    // block 分类统计
    const blockIds = tab?.blockids ?? [];
    const counts = React.useMemo(() => {
        const acc: Record<TabBlockKind, number> = { agent: 0, file: 0, note: 0, terminal: 0, other: 0 };
        for (const blockId of blockIds) {
            const block = getObjectValue<Block>(makeORef("block", blockId));
            acc[classifyBlock(block)]++;
        }
        return acc;
    }, [blockIds]);

    const agentBlockIds = React.useMemo(() => blockIds.filter((id) => classifyBlock(getObjectValue<Block>(makeORef("block", id))) === "agent"), [blockIds]);

    const hasContent = counts.agent + counts.file + counts.note + counts.terminal > 0;

    return (
        <InfoCard className="tab-card">
            {/* 身份区：workspace 图标 + Tab 全名 + flag */}
            <InfoCardSection>
                <InfoCardHead>
                    {workspace != null && (workspace.icon || workspace.name) ? (
                        <span className="tab-card-workspace-icon" style={workspace.color ? { color: workspace.color } : undefined}>
                            <i className={cn("fa-solid", makeIconClass(workspace.icon ?? "", false))} />
                        </span>
                    ) : (
                        <InfoCardIcon icon="fa-sharp fa-solid fa-table-columns" />
                    )}
                    <InfoCardTitle>{tabName !== "" ? tabName : "Untitled tab"}</InfoCardTitle>
                    {flagColor != null ? <span className="tab-card-flag" style={{ background: flagColor }} title="Flag" /> : null}
                </InfoCardHead>
            </InfoCardSection>

            {/* 内容构成：block 类型计数 */}
            {hasContent && (
                <InfoCardSection>
                    <div className="tab-card-blocks">
                        {counts.agent > 0 && (
                            <span className="tab-card-block-count">
                                <i className="fa-sharp fa-solid fa-microchip" />
                                {counts.agent} agent{counts.agent > 1 ? "s" : ""}
                            </span>
                        )}
                        {counts.file > 0 && (
                            <span className="tab-card-block-count">
                                <i className="fa-solid fa-file-lines" />
                                {counts.file} file{counts.file > 1 ? "s" : ""}
                            </span>
                        )}
                        {counts.note > 0 && (
                            <span className="tab-card-block-count">
                                <i className="fa-solid fa-note-sticky" />
                                {counts.note} note{counts.note > 1 ? "s" : ""}
                            </span>
                        )}
                        {counts.terminal > 0 && (
                            <span className="tab-card-block-count">
                                <i className="fa-solid fa-terminal" />
                                {counts.terminal} term{counts.terminal > 1 ? "s" : ""}
                            </span>
                        )}
                    </div>
                </InfoCardSection>
            )}

            {/* Agent 状态清单 */}
            {agentBlockIds.length > 0 && (
                <InfoCardSection>
                    <InfoCardHead>
                        <InfoCardIcon icon="fa-sharp fa-solid fa-bolt" />
                        <InfoCardTitle>Agents</InfoCardTitle>
                    </InfoCardHead>
                    <div className="tab-card-agent-list">
                        {agentBlockIds.map((blockId) => (
                            <TabAgentRow key={blockId} blockId={blockId} />
                        ))}
                    </div>
                </InfoCardSection>
            )}

            {!hasContent && (
                <InfoCardSection>
                    <InfoCardText>Empty tab</InfoCardText>
                </InfoCardSection>
            )}
        </InfoCard>
    );
}
