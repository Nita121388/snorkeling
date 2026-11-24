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
//  - 数据全部来自现成 store，且**必须订阅 WOS atom**：历史上这里用 `getObjectValue`
//    做一次性快照读，waveobj:update 抵达后不重渲染，非激活 Tab 的块首次读取还是 null，
//    于是卡片长期显示「0 agents / 1 other」直到移开鼠标再悬浮一次
//    （见 design/plans/tab-info-card-stale-20261120.md）。
//  - 槽位信息只出现一次：header 只放 agent 数量，其余类型走 chips。
//  - block 全集 = `tab.blockids` + 各块 `subblockids`，与顶部状态点 / 「更多」菜单同口径
//    （共享纯函数 `tab-block-collect.expandBlockIdsWithSubblocks`，别自己再写一遍展开）。

import { useAgentPersonas } from "@/app/agent-persona/use-agent-personas";
import { useSessionEmojis } from "@/app/agent-persona/use-session-personas";
import { buildAgentStatusChipView } from "@/app/agent-status/agent-status-chip-view";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import { useAgentChipNow, useAgentStatusView } from "@/app/agent-status/use-agent-status-view";
import {
    InfoCard,
    InfoCardHead,
    InfoCardIcon,
    InfoCardSection,
    InfoCardText,
    InfoCardTitle,
} from "@/app/element/info-card";
import { getWaveObjectAtom, makeORef } from "@/app/store/wos";
import { getAgentIcon } from "@/app/view/term/agent-logo";
import { isAgentTerminalMeta, normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { cn, makeIconClass, useAtomValueSafe } from "@/util/util";
import { atom, Atom, useAtomValue } from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/config";
import { expandBlockIdsWithSubblocks } from "./tab-block-collect";
import { reconcileTabCard } from "./tab-card-reconcile";
import {
    agentGroupHidesProvider,
    agentGroupLabel,
    agentPillText,
    classifyTabBlock,
    countTabBlocks,
    nonAgentChips,
    presentAgentStateFromView,
} from "./tab-info-card-model";

/** 读一个 block 的 agent provider（归一后），非 agent block 返回空串。 */
function readAgentProvider(block: Block | null): string {
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    if (!isAgentTerminalMeta(block?.meta ?? null)) {
        return "";
    }
    return normalizeAgentProvider(meta.provider ?? meta["agent:provider"]);
}

// ── 卡片数据（响应式派生） ──
//
// 一个派生 atom 订阅：tab atom → 展开后的每个 block atom + workspace atom。
// 为什么收成一个 atom 而不是组件里逐个 useAtomValue：
//  - block 数量随 tab 变化，逐个 hook 会破坏 hooks 稳定性；
//  - 「更多」菜单（getTabMoreMetaAtom）与「更多」悬浮卡（getAgentBlocksAtom）都是这个模式。

export type TabCardAgentEntry = { blockId: string; provider: string; block: Block | null };

export type TabCardData = {
    tab: Tab | null;
    workspace: Workspace | null;
    /** 展开后的 block 全集（顶层 + subblockids），顺序与展开函数一致。 */
    blocks: (Block | null)[];
    counts: ReturnType<typeof countTabBlocks>;
    agentEntries: TabCardAgentEntry[];
};

const TabCardDataAtomCache = new Map<string, Atom<TabCardData>>();

/**
 * 测试专用：清掉派生 atom 缓存。
 * 生产代码不应调用 —— 同一 tabId|workspaceId 在组件 mount/unmount 全周期内必须返回同一 atom
 * 引用（否则 useAtomValue 的 dep 抖动 → 重渲染风暴，同 TabAgentStatusDotAtomCache 的注释）。
 */
export function __resetTabCardDataAtomCacheForTests(): void {
    TabCardDataAtomCache.clear();
}

/**
 * 按 `tabId|workspaceId` 缓存的派生 atom。
 *
 * 缓存是硬要求：不缓存时每次 render 都 new atom → `useAtomValue` 内部 effect 的 dep 变化
 * → cleanup + 立刻 rerender → 再 new atom → "Maximum update depth exceeded"
 * （同一坑见 agent-status-tab-aggregate 的 TabAgentStatusDotAtomCache、tab-more-menu 的 TabMoreMetaAtomCache）。
 */
export function getTabCardDataAtom(tabId: string, workspaceId?: string): Atom<TabCardData> {
    const key = `${tabId}|${workspaceId ?? ""}`;
    const cached = TabCardDataAtomCache.get(key);
    if (cached != null) {
        return cached;
    }
    const tabAtom = getWaveObjectAtom<Tab>(makeORef("tab", tabId));
    const workspaceAtom = workspaceId != null ? getWaveObjectAtom<Workspace>(makeORef("workspace", workspaceId)) : null;
    const derived = atom<TabCardData>((get) => {
        const tab = (get(tabAtom) ?? null) as Tab | null;
        const workspace = workspaceAtom != null ? ((get(workspaceAtom) ?? null) as Workspace | null) : null;
        const readBlock = (blockId: string) =>
            (get(getWaveObjectAtom<Block>(makeORef("block", blockId))) ?? null) as Block | null;
        // 订阅顶层块 → 读 subblockids → 订阅子块：任一 id 集合变化都会重 derive。
        const expandedIds = expandBlockIdsWithSubblocks(tab?.blockids ?? [], readBlock);
        const blocks = expandedIds.map(readBlock);
        const counts = countTabBlocks(blocks);
        const agentEntries: TabCardAgentEntry[] = [];
        for (let idx = 0; idx < expandedIds.length; idx++) {
            const block = blocks[idx];
            if (classifyTabBlock(block) !== "agent") {
                continue;
            }
            agentEntries.push({ blockId: expandedIds[idx], provider: readAgentProvider(block), block });
        }
        return { tab, workspace, blocks, counts, agentEntries };
    });
    TabCardDataAtomCache.set(key, derived);
    return derived;
}

// ── Agent 状态行（每个 agent block 一个子组件，独立订阅状态） ──

function TabAgentRow({ entry, hideProvider }: { entry: TabCardAgentEntry; hideProvider: boolean }) {
    const { t } = useTranslation("tab");
    const blockId = entry.blockId;
    const store = AgentStatusStore.getInstance();
    const [statusAtom, setStatusAtom] = React.useState<ReturnType<AgentStatusStore["acquire"]> | null>(null);
    React.useEffect(() => {
        const atom = store.acquire(blockId);
        setStatusAtom(atom);
        return () => store.release(blockId);
    }, [store, blockId]);
    const status = useAtomValueSafe(statusAtom);
    const statusView = useAgentStatusView(blockId, status);

    // block 由派生 atom 下传（已订阅）：meta 变化 / 迟到加载都会让本行拿到新值。
    const block = entry.block;
    const meta = (block?.meta ?? {}) as Record<string, unknown>;
    const rawProvider = normalizeAgentProvider(meta.provider ?? meta["agent:provider"]);
    const provider = rawProvider === "" ? t("tab:infoCard.agentFallback") : rawProvider;
    const personas = useAgentPersonas();
    const sessionEmojis = useSessionEmojis();
    const agentIcon = getAgentIcon(rawProvider === "" ? "agent" : rawProvider, {
        meta,
        personas,
        sessionEmojis,
        sessionId: (meta["agent:sessionid"] as string | undefined) ?? null,
    });

    const presentation = presentAgentStateFromView(statusView);
    // 文案与跑时走与头部徽章/悬浮卡**同一个纯函数**：`agentStatusViewLabel` 只产状态词
    // （Done 未读时带分钟级 elapsed），跑时 "3min21s" 只由 buildAgentStatusChipView().runtime
    // 产出。pill 之前只读前者，所以 working/tool 期间这里没有时长 —— 本行就是那个断层。
    // variant 只影响 className（本组件不采用），label/runtime 在四个变体间由单测锁死一致。
    const chipNow = useAgentChipNow(status);
    const chipView = buildAgentStatusChipView({
        variant: "list",
        status,
        read: statusView?.read ?? "seen",
        nowMs: chipNow,
    });
    const pillLabel = agentPillText(chipView, presentation.label);

    return (
        <div
            className={cn(
                "tab-card-agent-row",
                `is-${presentation.kind}`,
                presentation.read === "seen" ? "is-seen" : "is-unread"
            )}
            data-agent-read={presentation.read}
        >
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
            <span className="tab-card-agent-pill">{pillLabel}</span>
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
    const { t } = useTranslation("tab");
    const dataAtom = React.useMemo(() => getTabCardDataAtom(tabId, workspaceId), [tabId, workspaceId]);
    const { tab, workspace, counts, agentEntries } = useAtomValue(dataAtom);

    // 冷读面的自愈：本 renderer 的 WOS 可能漏掉广播（每个 Tab 一个 renderer，各自一份缓存）。
    // 卡片 mount == 打开（InfoCardPortal 只在 open 时渲染 children），做一次重对账：
    // reload tab 对象 → 按最新 blockids 整批重拉块。内部 2s 节流 + version guard，幂等。
    // 不挂在 dataAtom 上：对账要打 RPC，放到 effect 里而不是派生 atom 的 get 里。
    React.useEffect(() => {
        void reconcileTabCard(tabId, workspaceId);
    }, [tabId, workspaceId]);

    const tabName = tab?.name ?? "";
    const flagColor = tab?.meta?.["tab:flagcolor"] as string | undefined;

    const chips = React.useMemo(() => nonAgentChips(counts), [counts]);

    const providers = React.useMemo(() => agentEntries.map((entry) => entry.provider), [agentEntries]);
    const groupLabel = agentGroupLabel(providers);
    const hideProvider = agentGroupHidesProvider(providers);

    // 与行数同源：agent 行现在包含 inline 子块，header 计数不能再用 counts.agent 另算一遍。
    const agentCount = agentEntries.length;

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
                    <InfoCardTitle className="tab-card-title">
                        {tabName !== "" ? tabName : t("tab:infoCard.untitledTab")}
                    </InfoCardTitle>
                    {flagColor != null ? (
                        <span
                            className="tab-card-flag"
                            style={{ background: flagColor }}
                            title={t("tab:infoCard.flag")}
                        />
                    ) : null}
                    {agentCount > 0 ? (
                        <span className="tab-card-count">
                            {i18n.t("tab:infoCard.agentCount", { count: agentCount })}
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
                            <TabAgentRow key={entry.blockId} entry={entry} hideProvider={hideProvider} />
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
                    <InfoCardText>{t("tab:infoCard.emptyTab")}</InfoCardText>
                </InfoCardSection>
            )}
        </InfoCard>
    );
}
