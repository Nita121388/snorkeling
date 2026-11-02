// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// TabInfoCard — App Tab 悬浮信息卡。
//
// 展示 Tab 的身份（workspace 图标/颜色 + Tab 全名 + flag 颜色）与内容构成，
// 以及 Tab 内所有 Agent block 的实时状态清单。
//
// 结构（Notion / Things 3 风格，见 design/prototypes/tab-card-v2 变体 #4）：
//  - identity：workspace 图标 + Tab 名 + flag + 右侧 agent 计数
//  - hairline
//  - agents：分组标题（provider 相同时并入）+ 26px 行（emoji + 可选 provider + 状态 pill）
//  - props：非 agent 类型的内容构成 chips（`12 files` / `2 chats` …）
//
// 设计原则（与 BlockInfoCard 一致）：
//  - 只读信息展示；操作（切换/跳转）留给后续 Phase。
//  - 数据全部来自现成 store：tab/workspace WaveObj、block meta、AgentStatusStore。
//  - 槽位信息只出现一次：header 只放 agent 数量，其余类型走 chips。

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
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { getObjectValue, makeORef } from "@/app/store/wos";
import {
    agentGroupHidesProvider,
    agentGroupLabel,
    classifyTabBlock,
    countTabBlocks,
    nonAgentChips,
    presentAgentState,
} from "./tab-info-card-model";
import * as React from "react";

/** 读一个 block 的 agent provider（归一后），非 agent block 返回空串。 */
function readAgentProvider(block: Block | null): string {
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    if (!isAgentTerminalMeta(block?.meta ?? null)) {
        return "";
    }
    return normalizeAgentProvider(meta.provider ?? meta["agent:provider"]);
}

// ── Agent 状态行（每个 agent block 一个子组件，独立订阅状态） ──

function TabAgentRow({ blockId, hideProvider }: { blockId: string; hideProvider: boolean }) {
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
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const agentIcon = getAgentIcon(rawProvider === "" ? "agent" : rawProvider, {
        meta,
        personas,
        sessionEmojis,
        sessionId: (meta["agent:sessionid"] as string | undefined) ?? null,
    });

    const presentation = presentAgentState(status);

    return (
        <div className={cn("tab-card-agent-row", `is-${presentation.kind}`)}>
            {agentIcon != null ? (
                agentIcon.kind === "emoji" ? (
                    <span className="agent-emoji-icon tab-card-agent-emoji">{agentIcon.emoji}</span>
                ) : (
                    <span
                        className="tab-card-agent-emoji"
                        style={agentIcon.iconColor != null ? { color: agentIcon.iconColor } : undefined}
                    >
                        {agentIcon.icon}
                    </span>
                )
            ) : (
                <span className="tab-card-agent-emoji">
                    <i className="fa-sharp fa-solid fa-robot" />
                </span>
            )}
            {hideProvider ? null : <span className="tab-card-agent-name">{provider}</span>}
            <span className="tab-card-agent-pill">{presentation.label}</span>
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

    const blockIds = tab?.blockids ?? [];
    const blocks = React.useMemo(() => blockIds.map((id) => getObjectValue<Block>(makeORef("block", id))), [blockIds]);
    const counts = React.useMemo(() => countTabBlocks(blocks), [blocks]);
    const chips = React.useMemo(() => nonAgentChips(counts), [counts]);

    const agentEntries = React.useMemo(
        () =>
            blockIds
                .map((blockId, idx) => ({
                    blockId,
                    kind: classifyTabBlock(blocks[idx] ?? null),
                    provider: readAgentProvider(blocks[idx] ?? null),
                }))
                .filter((entry) => entry.kind === "agent")
                .map(({ blockId, provider }) => ({ blockId, provider })),
        [blockIds, blocks]
    );

    const providers = React.useMemo(() => agentEntries.map((entry) => entry.provider), [agentEntries]);
    const groupLabel = agentGroupLabel(providers);
    const hideProvider = agentGroupHidesProvider(providers);

    const agentCount = counts.agent;

    return (
        <InfoCard className="tab-card">
            {/* 身份区：workspace 图标 + Tab 全名 + flag + agent 计数 */}
            <InfoCardSection className="tab-card-identity">
                <InfoCardHead>
                    {workspace != null && (workspace.icon || workspace.name) ? (
                        <span
                            className="tab-card-workspace-icon"
                            style={workspace.color ? { color: workspace.color } : undefined}
                        >
                            <i className={cn("fa-solid", makeIconClass(workspace.icon ?? "", false))} />
                        </span>
                    ) : (
                        <InfoCardIcon icon="fa-sharp fa-solid fa-table-columns" />
                    )}
                    <InfoCardTitle className="tab-card-title">{tabName !== "" ? tabName : "Untitled tab"}</InfoCardTitle>
                    {flagColor != null ? (
                        <span className="tab-card-flag" style={{ background: flagColor }} title="Flag" />
                    ) : null}
                    {agentCount > 0 ? (
                        <span className="tab-card-count">
                            {agentCount} agent{agentCount > 1 ? "s" : ""}
                        </span>
                    ) : null}
                </InfoCardHead>
            </InfoCardSection>

            <div className="tab-card-rule" />

            {/* Agent 状态清单 */}
            {agentCount > 0 && (
                <InfoCardSection>
                    <div className="tab-card-sub">{groupLabel}</div>
                    <div className="tab-card-agent-list">
                        {agentEntries.map((entry) => (
                            <TabAgentRow key={entry.blockId} blockId={entry.blockId} hideProvider={hideProvider} />
                        ))}
                    </div>
                </InfoCardSection>
            )}

            {/* 非 agent 内容构成（chat / file / note / terminal），与 header 计数不重复 */}
            {chips.length > 0 && (
                <InfoCardSection className={cn("tab-card-props", agentCount > 0 && "has-agents")}>
                    {chips.map((chip) => (
                        <span key={chip.kind} className="tab-card-prop">
                            {chip.label}
                        </span>
                    ))}
                </InfoCardSection>
            )}

            {agentCount === 0 && chips.length === 0 && (
                <InfoCardSection>
                    <InfoCardText>Empty tab</InfoCardText>
                </InfoCardSection>
            )}
        </InfoCard>
    );
}
