// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabAgentStatusDotsAtom, getTabsWithUnreadDotsAtom } from "@/app/agent-status/agent-status-tab-aggregate";
import { getTabBadgeAtom } from "@/app/store/badge";
import { makeORef } from "@/app/store/wos";
import { useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { validateCssColor } from "@/util/color-validator";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    size,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { atom, Atom, useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";
import { collapsedTabIdsAtom } from "./tab-collapse-state";
import {
    buildTabMoreRows,
    collectCollapseTargets,
    countHiddenRows,
    filterTabMoreRows,
    shouldShowTabMoreSearch,
    TabMoreMeta,
    TabMoreRow,
} from "./tab-more-model";
import { openedThisLaunchTabIdsAtom } from "./tab-open-state";
import { TabBadges } from "./tabbadges";

type TabMoreMenuEnv = WaveEnvSubset<{
    atoms: {
        staticTabId: WaveEnv["atoms"]["staticTabId"];
    };
    wos: WaveEnv["wos"];
}>;

const TabMoreMetaAtomCache = new Map<string, Atom<Record<string, TabMoreMeta>>>();

/**
 * 为「更多」下拉构建 Tab 视觉元信息 (名称 / badges / agent 点 / flag 色).
 *
 * 与 VTabWrapper 同源, 但这里是"一次性把全部 Tab 读成一个 map"的派生 atom ——
 * 面板里可能同时渲染几十个 Tab, 逐个 useAtomValue 会破坏 hooks 稳定性 (tabIds 长度可变).
 */
function getTabMoreMetaAtom(tabIds: readonly string[], env: TabMoreMenuEnv): Atom<Record<string, TabMoreMeta>> {
    const key = tabIds.join(" ");
    const cached = TabMoreMetaAtomCache.get(key);
    if (cached != null) {
        return cached;
    }
    const entries = tabIds.map((tabId) => {
        const tabAtom = env.wos.getWaveObjectAtom<Tab>(makeORef("tab", tabId));
        const badgeAtom = getTabBadgeAtom(tabId, env);
        const dotAtom = getTabAgentStatusDotsAtom(tabId);
        return { tabId, tabAtom, badgeAtom, dotAtom };
    });
    const derived = atom<Record<string, TabMoreMeta>>((get) => {
        const out: Record<string, TabMoreMeta> = {};
        for (const entry of entries) {
            const tab = get(entry.tabAtom);
            if (tab == null) {
                continue;
            }
            const rawFlagColor = tab.meta?.["tab:flagcolor"];
            let flagColor: string | null = null;
            if (rawFlagColor) {
                try {
                    validateCssColor(rawFlagColor);
                    flagColor = rawFlagColor;
                } catch {
                    flagColor = null;
                }
            }
            out[entry.tabId] = {
                name: tab.name ?? "",
                badges: get(entry.badgeAtom),
                agentDots: get(entry.dotAtom),
                flagColor,
            };
        }
        return out;
    });
    TabMoreMetaAtomCache.set(key, derived);
    return derived;
}

export interface TabMoreMenuProps {
    tabIds: string[];
    /** 浮层展开方向 + 对齐: 垂直栏 top-start, 水平栏 bottom-end. */
    placement: "top-start" | "bottom-end";
    /** 触发器外观: 垂直栏显示文字标签, 水平栏只有图标 + 计数. */
    variant: "vertical" | "horizontal";
    /** 水平栏溢出 (滚出视口) 的 Tab: 只并入计数, 视觉上已由主栏滚动呈现. */
    overflowTabIds?: string[];
    onActivateTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onNewTab: () => void;
    onCollapseInactive: () => void;
    onOpenChange?: (open: boolean) => void;
}

/** 单行: 图标 + 名称 + 关闭. 不参与拖拽. */
const TabMoreRowItem = memo(
    ({ row, onActivate, onClose }: { row: TabMoreRow; onActivate: () => void; onClose: () => void }) => {
        // 灰色 = 该 Tab 当前在主栏不可见 (默认折叠 or 用户手动收起).
        // 未打开过的 Tab 不进灰色判定: 它可能在主栏可见, 下拉里不该跟折叠的混为一谈.
        // 有未阅点的永远不灰 — 那是用户必须立刻看到的状态.
        const dimmed = row.isHidden && !row.hasUnreadDot;
        return (
            <div
                role="menuitem"
                tabIndex={0}
                data-tabid={row.tabId}
                data-hidden={row.isHidden ? "true" : "false"}
                onClick={onActivate}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onActivate();
                    }
                }}
                className={cn(
                    "group relative flex h-[30px] w-full cursor-pointer items-center gap-1.5 rounded pr-1.5 pl-2 text-xs select-none",
                    "transition-colors",
                    row.isActive ? "bg-foreground/10 text-primary" : "text-secondary hover:bg-hover hover:text-primary",
                    dimmed && "opacity-55"
                )}
            >
                {row.isActive && (
                    <div className="pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded bg-accent" />
                )}
                <div className="relative flex h-[16px] w-[16px] shrink-0 items-center justify-center">
                    <TabBadges
                        badges={row.badges}
                        agentDots={row.agentDots}
                        flagColor={row.flagColor}
                        className="static top-auto left-auto h-[16px] w-[16px] translate-y-0 justify-start px-0 py-0 [&_i]:text-[10px]"
                    />
                </div>
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <button
                    type="button"
                    aria-label="Close tab"
                    className="shrink-0 cursor-pointer rounded p-0.5 text-[10px] text-muted opacity-0 transition group-hover:opacity-100 hover:text-primary"
                    onClick={(event) => {
                        event.stopPropagation();
                        onClose();
                    }}
                >
                    <i className="fa fa-solid fa-xmark" />
                </button>
            </div>
        );
    }
);
TabMoreRowItem.displayName = "TabMoreRowItem";

export function TabMoreMenu({
    tabIds,
    placement,
    variant,
    overflowTabIds,
    onActivateTab,
    onCloseTab,
    onNewTab,
    onCollapseInactive,
    onOpenChange,
}: TabMoreMenuProps) {
    const env = useWaveEnv<TabMoreMenuEnv>();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [reference, setReference] = useState<HTMLElement | null>(null);

    const activeTabId = useAtomValue(env.atoms.staticTabId) as string;
    const openedThisLaunch = useAtomValue(openedThisLaunchTabIdsAtom);
    const collapsedTabIds = useAtomValue(collapsedTabIdsAtom);
    const meta = useAtomValue(getTabMoreMetaAtom(tabIds, env));
    const unreadAtom = useMemo(() => getTabsWithUnreadDotsAtom([...tabIds]), [tabIds]);
    const unreadTabIds = useAtomValue(unreadAtom);

    const rows = useMemo(
        () =>
            buildTabMoreRows(tabIds, meta, {
                activeTabId,
                openedThisLaunch,
                unreadTabIds,
                collapsedTabIds,
            }),
        [tabIds, meta, activeTabId, openedThisLaunch, unreadTabIds, collapsedTabIds]
    );

    const hiddenCount = useMemo(() => {
        const base = countHiddenRows(rows);
        const overflowHidden = (overflowTabIds ?? []).filter(
            (tabId) => !rows.some((row) => row.tabId === tabId && row.isHidden)
        );
        return base + overflowHidden.length;
    }, [rows, overflowTabIds]);

    const showSearch = shouldShowTabMoreSearch(rows.length);
    const visibleRows = useMemo(() => (showSearch ? filterTabMoreRows(rows, query) : rows), [rows, showSearch, query]);

    const setOpenState = useCallback(
        (next: boolean) => {
            setOpen(next);
            if (!next) {
                setQuery("");
            }
            onOpenChange?.(next);
        },
        [onOpenChange]
    );

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpenState,
        placement,
        middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            size({
                padding: 8,
                apply({ availableHeight, elements }) {
                    elements.floating.style.maxHeight = `${Math.max(180, availableHeight)}px`;
                },
            }),
        ],
        whileElementsMounted: autoUpdate,
        elements: { reference },
    });

    const dismiss = useDismiss(context);
    const { getFloatingProps } = useInteractions([dismiss]);

    const handleActivate = useCallback(
        (tabId: string) => {
            onActivateTab(tabId);
            setOpenState(false);
        },
        [onActivateTab, setOpenState]
    );

    const handleNewTab = useCallback(() => {
        onNewTab();
        setOpenState(false);
    }, [onNewTab, setOpenState]);

    const handleCollapse = useCallback(() => {
        onCollapseInactive();
        setOpenState(false);
    }, [onCollapseInactive, setOpenState]);

    const collapseTargets = useMemo(() => collectCollapseTargets(rows), [rows]);

    const triggerClassName =
        variant === "vertical"
            ? "group/trigger relative flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm pr-2 pl-3 text-xs text-secondary/60 transition-colors select-none hover:text-primary"
            : "flex h-[22px] cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 text-[11px] text-secondary transition-colors select-none hover:bg-hoverbg hover:text-primary";

    return (
        <>
            <button
                ref={setReference}
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={hiddenCount > 0 ? `More tabs (${hiddenCount} hidden)` : "More tabs"}
                title={hiddenCount > 0 ? `${hiddenCount} 个 Tab 已折叠` : "所有 Tab 都已显示"}
                onClick={() => setOpenState(!open)}
                className={triggerClassName}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
                {variant === "vertical" && (
                    <div className="pointer-events-none absolute inset-x-1 inset-y-[4px] rounded-sm bg-transparent transition-colors group-hover/trigger:bg-hover" />
                )}
                <i className="fa fa-solid fa-layer-group relative" style={{ fontSize: "10px" }} />
                {variant === "vertical" && (
                    <>
                        <span className="relative">更多</span>
                        {hiddenCount > 0 && (
                            <span className="relative rounded-full bg-foreground/10 px-1.5 text-[10px] leading-[14px]">
                                {hiddenCount}
                            </span>
                        )}
                    </>
                )}
                {variant === "horizontal" && hiddenCount > 0 && (
                    <span className="rounded-full bg-foreground/10 px-1 text-[10px] leading-[14px]">{hiddenCount}</span>
                )}
            </button>
            {open && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={{ ...floatingStyles, width: variant === "vertical" ? 240 : 300 }}
                        {...getFloatingProps()}
                        className="z-50 flex max-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-modalbg shadow-xl backdrop-blur"
                        role="menu"
                    >
                        {showSearch && (
                            <div className="shrink-0 border-b border-border/60 p-1.5">
                                <input
                                    autoFocus
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="搜索 Tab…"
                                    className="w-full rounded bg-foreground/5 px-2 py-1 text-xs text-primary outline-none placeholder:text-muted"
                                />
                            </div>
                        )}
                        <div className="min-h-0 flex-1 overflow-y-auto p-1">
                            {visibleRows.length === 0 ? (
                                <div className="px-2 py-4 text-center text-xs text-muted">
                                    {rows.length === 0 ? "没有 Tab" : "没有匹配的 Tab"}
                                </div>
                            ) : (
                                visibleRows.map((row) => (
                                    <TabMoreRowItem
                                        key={row.tabId}
                                        row={row}
                                        onActivate={() => handleActivate(row.tabId)}
                                        onClose={() => onCloseTab(row.tabId)}
                                    />
                                ))
                            )}
                        </div>
                        <div className="shrink-0 border-t border-border/60 p-1">
                            <button
                                type="button"
                                onClick={handleNewTab}
                                className="flex h-[30px] w-full cursor-pointer items-center gap-2 rounded px-2 text-xs text-secondary transition-colors hover:bg-hover hover:text-primary"
                            >
                                <i className="fa fa-solid fa-plus" style={{ fontSize: "10px" }} />
                                <span>新建 Tab</span>
                            </button>
                            {collapseTargets.length > 0 && (
                                <button
                                    type="button"
                                    onClick={handleCollapse}
                                    className="flex h-[30px] w-full cursor-pointer items-center gap-2 rounded px-2 text-xs text-secondary transition-colors hover:bg-hover hover:text-primary"
                                >
                                    <i className="fa fa-solid fa-compress" style={{ fontSize: "10px" }} />
                                    <span>收起未使用的 Tab</span>
                                    <span className="ml-auto text-[10px] text-muted">{collapseTargets.length}</span>
                                </button>
                            )}
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}
