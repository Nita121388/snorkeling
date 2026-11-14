// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    getTabsWithUnreadDotsAtom,
    useAcquireWorkspaceBlockStatuses,
} from "@/app/agent-status/agent-status-tab-aggregate";
import { getMinimizedBlockIds } from "@/app/block/block-minimize";
import { Tooltip } from "@/app/element/tooltip";
import { SessionOverviewButton } from "@/app/session-overview/session-overview";
import {
    filterSessionOverviewTabIds,
    mergeVisibleTabIdsWithSessionOverview,
} from "@/app/session-overview/session-overview-model";
import { confirmCloseTabIfHasContent, confirmCurrentTabClose } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { deleteLayoutModelForTab } from "@/layout/index";
import { isMacOSTahoeOrLater } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { atom, useAtomValue } from "jotai";
import { OverlayScrollbars } from "overlayscrollbars";
import { createRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { debounce } from "throttle-debounce";
import { Tab as TabComponent } from "./tab";
import { collapseTabIds, collapsedTabIdsAtom } from "./tab-collapse-state";
import {
    computeDragDirection,
    computeNewTabIndex,
    type DragDirection,
    DragPersistThresholdPx,
    isBeyondEngageThreshold,
    shouldEngageDrag,
} from "./tab-drag-model";
import { TabMoreMenu } from "./tab-more-menu";
import { selectBarVisibleTabIds, TabMoreVisibilityContext } from "./tab-more-model";
import { markTabOpenedThisLaunch, openedThisLaunchTabIdsAtom, wasTabOpenedThisLaunch } from "./tab-open-state";
import {
    clearOptimisticActiveTab,
    optimisticActiveTabIdAtom,
    setOptimisticActiveTab,
    useHighlightTabId,
} from "./tab-optimistic-active";
import { tabRecencyBumpAtom } from "./tab-recency-store";
import "./tabbar.scss";
import { TabBarEnv } from "./tabbarenv";
import { UpdateStatusBanner } from "./updatebanner";
import { WorkspaceSwitcher } from "./workspaceswitcher";

const TAB_HEADER_HOVER_DELAY_MS = 2000;

// fallback atom used when there is no active tab (prevents a null atom for useAtomValue)
const emptyTabAtom = atom<Tab | null>(null);

const TabDefaultWidth = 130;
const TabMinWidth = 100;
// 拖拽阈值/方向/落点判定统一在 ./tab-drag-model（R8）：engage = 8px 且连续 2 帧，
// 持久化换位 = 50px。这里不再维护裸数字，避免两处阈值漂移。
const MacOSTrafficLightsWidth = 74;
const MacOSTahoeTrafficLightsWidth = 80;
const ScrollEdgeTolerance = 1;

const OSOptions = {
    overflow: {
        x: "scroll",
        y: "hidden",
    },
    scrollbars: {
        theme: "os-theme-dark",
        visibility: "auto",
        autoHide: "leave",
        autoHideDelay: 1300,
        autoHideSuspend: false,
        dragScroll: true,
        clickScroll: false,
        pointers: ["mouse", "touch", "pen"],
    },
};

interface TabBarProps {
    workspace: Workspace;
    noTabs?: boolean;
    headerHovered?: boolean;
    onHeaderHoverChange?: (hovered: boolean) => void;
}

const WaveAIButton = memo(({ divRef }: { divRef?: React.RefObject<HTMLDivElement> }) => {
    const env = useWaveEnv<TabBarEnv>();
    const aiPanelOpen = useAtomValue(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
    const hideAiButton = useAtomValue(env.getSettingsKeyAtom("app:hideaibutton"));

    const onClick = () => {
        const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
    };

    if (hideAiButton) {
        return null;
    }

    return (
        <Tooltip
            content="Toggle Wave AI Panel"
            placement="bottom"
            hideOnClick
            divClassName={`flex h-[22px] px-3.5 justify-end mb-1 items-center rounded-md mr-1 box-border cursor-pointer bg-hover hover:bg-hoverbg transition-colors text-[12px] ${aiPanelOpen ? "text-accent" : "text-secondary"}`}
            divStyle={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            divOnClick={onClick}
            divRef={divRef}
        >
            <i className="fa fa-sparkles" />
        </Tooltip>
    );
});
WaveAIButton.displayName = "WaveAIButton";

function strArrayIsEqual(a: string[], b: string[]) {
    // null check
    if (a == null && b == null) {
        return true;
    }
    if (a == null || b == null) {
        return false;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

const TabBar = memo(({ workspace, noTabs, onHeaderHoverChange }: TabBarProps) => {
    const env = useWaveEnv<TabBarEnv>();
    const [tabIds, setTabIds] = useState<string[]>([]);
    const [draggingTab, setDraggingTab] = useState<string>();
    const [tabsLoaded, setTabsLoaded] = useState({});
    const [newTabId, setNewTabId] = useState<string | null>(null);

    const tabbarWrapperRef = useRef<HTMLDivElement>(null);
    const tabBarRef = useRef<HTMLDivElement>(null);
    const tabsWrapperRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<React.RefObject<HTMLDivElement>[]>([]);
    const addBtnRef = useRef<HTMLButtonElement>(null);
    const moreMenuWrapRef = useRef<HTMLDivElement>(null);
    const draggingTabDataRef = useRef({
        tabId: "",
        ref: { current: null as HTMLDivElement | null },
        tabStartX: 0,
        tabIndex: 0,
        initialOffsetX: null as number | null,
        totalScrollOffset: null as number | null,
        // R8: 连续越过 engage 阈值的 mousemove 次数（位移 + 连续次数双条件）
        consecutiveBeyondCount: 0,
        engaged: false,
        dragged: false,
        // R8: 方向状态放 ref（旧实现是模块级变量，多窗口/多实例串扰）
        prevX: null as number | null,
        prevDirection: null as DragDirection | null,
        // R8: 拖拽中的工作顺序（tabIds 副本；绝不原地改 React state）
        workingOrder: null as string[] | null,
        // R8: 拖拽开始时的实时位置快照（tabId → 左缘，代替已删除的 dragStartPositions 缓存）
        startPositions: null as Map<string, number> | null,
    });
    const osInstanceRef = useRef<OverlayScrollbars>(null);
    const draggerLeftRef = useRef<HTMLDivElement>(null);
    const rightContainerRef = useRef<HTMLDivElement>(null);
    const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
    const waveAIButtonRef = useRef<HTMLDivElement>(null);
    const appMenuButtonRef = useRef<HTMLDivElement>(null);
    const tabWidthRef = useRef<number>(TabDefaultWidth);
    const scrollableRef = useRef<boolean>(false);
    const prevAllLoadedRef = useRef<boolean>(false);
    const activeTabId = useAtomValue(env.atoms.staticTabId);
    // R9.1: 乐观高亮（仅视觉 prop；非视觉逻辑继续用 activeTabId）
    const highlightTabId = useHighlightTabId(activeTabId);
    const optimisticActiveTabId = useAtomValue(optimisticActiveTabIdAtom);
    // 让本工作区所有 tab (含 inline-tab 子 block) 在 AgentStatusStore 都持有订阅,
    // 非激活 tab 的 agent 状态点才能在 Tab 栏渲染.
    useAcquireWorkspaceBlockStatuses(tabIds);
    // 有未阅状态点的 tab 集合: 这些 tab 必须强制 keep 到 visibleTabIds, 否则 TabInner 不挂载,
    // 用户不切过去就永远看不到状态 (本次修复的核心).
    const tabsWithUnreadDots = useAtomValue(getTabsWithUnreadDotsAtom(tabIds));
    const isFullScreen = useAtomValue(env.atoms.isFullScreen);
    const zoomFactor = useAtomValue(env.atoms.zoomFactorAtom);
    const showMenuBar = useAtomValue(env.getSettingsKeyAtom("window:showmenubar"));
    const confirmClose = useAtomValue(env.getSettingsKeyAtom("tab:confirmclose")) ?? false;
    const hideAiButton = useAtomValue(env.getSettingsKeyAtom("app:hideaibutton"));
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);
    const openedThisLaunchTabIds = useAtomValue(openedThisLaunchTabIdsAtom);
    const collapsedTabIds = useAtomValue(collapsedTabIdsAtom);
    // 订阅 recency bump: markTabOpened 后强制重算 setSizeAndPosition 的 pinned 段, 避免切 Tab 期间 stale.
    useAtomValue(tabRecencyBumpAtom);

    const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
    // ── block sidebar expand icon (left-most in tab bar) ──
    const [sidebarExpanded, setSidebarExpanded] = useState(() => {
        if (typeof window === "undefined") return true;
        try {
            return localStorage.getItem(`snorkeling:block-sidebar-${activeTabId}:pinned`) !== "false";
        } catch {
            return true;
        }
    });
    // ── per-tab minimized block count for the active tab (shown on the sidebar toggle) ──
    const activeTabAtom = useMemo(
        () => (activeTabId ? env.wos.getWaveObjectAtom<Tab>(makeORef("tab", activeTabId)) : null),
        [activeTabId]
    );
    const activeTabData = useAtomValue(activeTabAtom ?? emptyTabAtom);
    const activeMinimizedCount = useMemo(() => getMinimizedBlockIds(activeTabData).length, [activeTabData]);
    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ tabId?: string }>).detail;
            if (detail?.tabId !== activeTabId) return;
            setSidebarExpanded(false);
        };
        window.addEventListener("block-sidebar:collapse", handler);
        return () => window.removeEventListener("block-sidebar:collapse", handler);
    }, [activeTabId]);
    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            setSidebarExpanded(localStorage.getItem(`snorkeling:block-sidebar-${activeTabId}:pinned`) !== "false");
        } catch {
            setSidebarExpanded(true);
        }
    }, [activeTabId]);
    // ── widget bar expand icon (right-most in tab bar) ──
    const [widgetBarExpanded, setWidgetBarExpanded] = useState(false);
    useEffect(() => {
        const handler = () => setWidgetBarExpanded(false);
        window.addEventListener("widget-bar:collapse", handler);
        return () => window.removeEventListener("widget-bar:collapse", handler);
    }, []);
    const hideWrapperHoverTimerRef = useRef<number | null>(null);
    const cancelPendingHideWrapperHover = useCallback(() => {
        if (hideWrapperHoverTimerRef.current != null) {
            window.clearTimeout(hideWrapperHoverTimerRef.current);
            hideWrapperHoverTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => cancelPendingHideWrapperHover(), [cancelPendingHideWrapperHover]);

    // 默认隐藏的 Tab 只进「更多」下拉, 不进主栏 (hover / 菜单展开 / 拖拽都不再把它捞回来).
    const visibilityCtx = useMemo<TabMoreVisibilityContext>(
        () => ({
            activeTabId,
            openedThisLaunch: openedThisLaunchTabIds,
            unreadTabIds: tabsWithUnreadDots,
            collapsedTabIds,
        }),
        [activeTabId, collapsedTabIds, openedThisLaunchTabIds, tabsWithUnreadDots]
    );
    const visibleTabIds = useMemo(() => selectBarVisibleTabIds(tabIds, visibilityCtx), [tabIds, visibilityCtx]);

    // RenderedTabIds: tab-only ids, used for drag/reorder.
    const renderedTabIds = useMemo(() => visibleTabIds, [visibleTabIds]);

    // Update refs when tabIds change
    useEffect(() => {
        tabRefs.current = tabIds.map((_, index) => tabRefs.current[index] || createRef());
    }, [tabIds]);

    useEffect(() => {
        if (!workspace) {
            return;
        }
        const newTabIdsArr = filterSessionOverviewTabIds(workspace.tabids ?? [], (tabId) =>
            globalStore.get(env.wos.getWaveObjectAtom<Tab>(makeORef("tab", tabId)))
        );

        const areEqual = strArrayIsEqual(tabIds, newTabIdsArr);

        if (!areEqual) {
            setTabIds(newTabIdsArr);
        }
    }, [workspace, tabIds]);

    // R9.1: 后端确认（activetabid 广播到达）后清掉乐观高亮；安全超时在模块内兜底。
    useEffect(() => {
        if (optimisticActiveTabId != null && workspace?.activetabid === optimisticActiveTabId) {
            clearOptimisticActiveTab();
        }
    }, [optimisticActiveTabId, workspace?.activetabid]);

    const setSizeAndPosition = (animate?: boolean) => {
        const tabBar = tabBarRef.current;
        if (tabBar === null) return;

        const getOuterWidth = (el: HTMLElement): number => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return rect.width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
        };

        const tabbarWrapperWidth = tabbarWrapperRef.current.getBoundingClientRect().width;
        const windowDragLeftWidth = draggerLeftRef.current.getBoundingClientRect().width;
        const rightContainerWidth = rightContainerRef.current?.getBoundingClientRect().width ?? 0;
        const addBtnWidth = getOuterWidth(addBtnRef.current);
        const moreBtnWidth = moreMenuWrapRef.current != null ? getOuterWidth(moreMenuWrapRef.current) : 0;
        const appMenuButtonWidth = appMenuButtonRef.current?.getBoundingClientRect().width ?? 0;
        const workspaceSwitcherWidth = workspaceSwitcherRef.current?.getBoundingClientRect().width ?? 0;
        const waveAIButtonWidth =
            !hideAiButton && waveAIButtonRef.current != null ? getOuterWidth(waveAIButtonRef.current) : 0;

        const nonTabElementsWidth =
            windowDragLeftWidth +
            rightContainerWidth +
            addBtnWidth +
            moreBtnWidth +
            appMenuButtonWidth +
            workspaceSwitcherWidth +
            waveAIButtonWidth;
        const spaceForTabs = tabbarWrapperWidth - nonTabElementsWidth;

        const numberOfTabs = visibleTabIds.length;
        if (numberOfTabs === 0) {
            scrollableRef.current = false;
            osInstanceRef.current?.destroy();
            osInstanceRef.current = null;
            return;
        }

        const isDragging = draggingTab != null;
        // Layout order: when not dragging, anchor the persistently-shown tabs (active + opened-this-launch)
        // to the left so that hover expansion appends newly-revealed tabs to their right instead of
        // shifting the already-shown ones. While dragging, keep the natural tabIds order so drag math
        // (which uses visibleTabIds positions) stays unchanged.
        let layoutTabIds: string[];
        let idealTabWidth: number;
        if (isDragging) {
            layoutTabIds = visibleTabIds;
            idealTabWidth = spaceForTabs / numberOfTabs;
            idealTabWidth = Math.max(TabMinWidth, Math.min(idealTabWidth, TabDefaultWidth));
        } else {
            // 使用与 isHidden 一致的判定: active / openedThisLaunch / unreadDots
            // 排前面, 其余排后面. 两组内部保持物理顺序.
            // 不再使用 partitionAndOrderTabs (它基于 7 天 recency, 导致 hover 时排序变化).
            const visibleTabs: string[] = [];
            const hiddenTabs: string[] = [];
            for (const tabId of visibleTabIds) {
                const isActive = activeTabId === tabId;
                const wasOpened = wasTabOpenedThisLaunch(openedThisLaunchTabIds, tabId);
                const hasUnread = tabsWithUnreadDots.has(tabId);
                if (isActive || wasOpened || hasUnread) {
                    visibleTabs.push(tabId);
                } else {
                    hiddenTabs.push(tabId);
                }
            }
            layoutTabIds = [...visibleTabs, ...hiddenTabs];
            const widthBasisCount = Math.max(1, visibleTabs.length);
            idealTabWidth = spaceForTabs / widthBasisCount;
            idealTabWidth = Math.max(TabMinWidth, Math.min(idealTabWidth, TabDefaultWidth));
        }

        // Determine if the tab bar needs to be scrollable
        const newScrollable = idealTabWidth * numberOfTabs > spaceForTabs;

        // Apply the calculated width and position to all tabs in layout order
        layoutTabIds.forEach((tabId, index) => {
            const tabIndex = tabIds.indexOf(tabId);
            const ref = tabRefs.current[tabIndex];
            const el = ref?.current ?? null;
            if (el) {
                if (animate) {
                    el.classList.add("animate");
                } else {
                    el.classList.remove("animate");
                }
                el.style.width = `${idealTabWidth}px`;
                el.style.transform = `translate3d(${index * idealTabWidth}px,0,0)`;
                el.style.opacity = "1";
            }
        });

        // Update the state with the new tab width if it has changed
        if (idealTabWidth !== tabWidthRef.current) {
            tabWidthRef.current = idealTabWidth;
        }

        // Update the state with the new scrollable state if it has changed
        if (newScrollable !== scrollableRef.current) {
            scrollableRef.current = newScrollable;
        }

        // Initialize/destroy overlay scrollbars
        if (newScrollable) {
            osInstanceRef.current = OverlayScrollbars(tabBarRef.current, { ...(OSOptions as any) });
        } else {
            if (osInstanceRef.current) {
                osInstanceRef.current.destroy();
            }
        }
    };

    // 窗口 resize 需要 debounce；但 setSizeAndPosition 每次渲染都是新函数，
    // 用 ref 持有最新实现，避免 debounce 闭包锁死在首次渲染的旧 state 上。
    const setSizeAndPositionRef = useRef(setSizeAndPosition);
    setSizeAndPositionRef.current = setSizeAndPosition;
    const saveTabsPositionDebounced = useCallback(
        debounce(100, () => setSizeAndPositionRef.current()),
        []
    );

    const handleResizeTabs = useCallback(() => {
        setSizeAndPosition();
        saveTabsPositionDebounced();
    }, [visibleTabIds, tabIds, newTabId, isFullScreen]);

    // update layout on reinit version
    const reinitVersion = useAtomValue(env.atoms.reinitVersion);
    useEffect(() => {
        if (reinitVersion > 0) {
            setSizeAndPosition();
        }
    }, [reinitVersion]);

    useEffect(() => {
        const tabBar = tabBarRef.current;
        if (tabBar == null) {
            return;
        }

        const handleWheel = (event: WheelEvent) => {
            if (!scrollableRef.current || event.ctrlKey || event.metaKey) {
                return;
            }

            const absX = Math.abs(event.deltaX);
            const absY = Math.abs(event.deltaY);
            if (absY === 0 || absX >= absY) {
                return;
            }

            const osInstance = osInstanceRef.current;
            if (osInstance == null || osInstance.state().destroyed) {
                return;
            }

            const { viewport } = osInstance.elements();
            const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
            if (maxScrollLeft <= 0) {
                return;
            }

            const currentScrollLeft = viewport.scrollLeft;
            const targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, currentScrollLeft + event.deltaY));
            if (Math.abs(targetScrollLeft - currentScrollLeft) <= ScrollEdgeTolerance) {
                return;
            }

            event.preventDefault();
            viewport.scrollLeft = targetScrollLeft;
        };

        tabBar.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            tabBar.removeEventListener("wheel", handleWheel);
        };
    }, []);

    // update layout on resize
    useEffect(() => {
        window.addEventListener("resize", handleResizeTabs);
        return () => {
            window.removeEventListener("resize", handleResizeTabs);
        };
    }, [handleResizeTabs]);

    // update layout on changed tabIds, tabsLoaded, newTabId, hideAiButton, appUpdateStatus, or zoomFactor
    useEffect(() => {
        // Check if all tabs are loaded
        const allLoaded = visibleTabIds.length > 0 && visibleTabIds.every((id) => tabsLoaded[id]);
        if (allLoaded) {
            setSizeAndPosition(false);
            if (!prevAllLoadedRef.current) {
                prevAllLoadedRef.current = true;
            }
        }
    }, [visibleTabIds, tabsLoaded, newTabId, hideAiButton, appUpdateStatus, zoomFactor, showMenuBar]);

    const handleMouseMove = (event: MouseEvent) => {
        // 自愈: mouseup 可能丢失 (拖到窗口外松手 / 焦点落到原生菜单或其它窗口),
        // 监听会一直挂在 document 上 —— 于是「没按键、鼠标一动 Tab 就跟着跑」。
        // 这里用按键状态兜底, 一旦左键已释放就立即收尾复位。
        if (event.buttons !== 1) {
            handleMouseUp(event);
            return;
        }

        const { tabId, ref, tabStartX } = draggingTabDataRef.current;

        let initialOffsetX = draggingTabDataRef.current.initialOffsetX;
        let totalScrollOffset = draggingTabDataRef.current.totalScrollOffset;
        if (initialOffsetX === null) {
            initialOffsetX = event.clientX - tabStartX;
            draggingTabDataRef.current.initialOffsetX = initialOffsetX;
        }
        let currentX = event.clientX - initialOffsetX - totalScrollOffset;

        // R8: engage = 位移 ≥ 8px（按 zoomFactor 折算）+ 连续 2 次 mousemove。
        // 未 engage 前一律 early-return，不写任何状态/样式 —— 保护单击/双击重命名
        // 不被手抖触发的布局摆动破坏（旧实现 5px 单帧即可进入拖拽态）。
        const deltaFromStart = currentX - tabStartX;
        if (isBeyondEngageThreshold(deltaFromStart, zoomFactor)) {
            draggingTabDataRef.current.consecutiveBeyondCount += 1;
        } else {
            draggingTabDataRef.current.consecutiveBeyondCount = 0;
        }
        if (!draggingTabDataRef.current.engaged) {
            if (
                !shouldEngageDrag({
                    deltaPx: deltaFromStart,
                    consecutiveMoves: draggingTabDataRef.current.consecutiveBeyondCount,
                    zoomFactor,
                })
            ) {
                return;
            }
            draggingTabDataRef.current.engaged = true;
            // 工作顺序 = tabIds 副本（R8: 拖拽期间绝不原地改 React state）
            draggingTabDataRef.current.workingOrder = [...tabIds];
        }

        let tabBarRectWidth = tabBarRef.current.getBoundingClientRect().width;
        // for macos, it's offset to make space for the window buttons
        const tabBarRectLeftOffset = tabBarRef.current.getBoundingClientRect().left;
        const incrementDecrement = tabBarRectLeftOffset * 0.05;
        // R8: 方向状态放 ref（旧实现是组件内裸 let，每次渲染重置，多实例串扰）
        const dragDirection = computeDragDirection(
            currentX,
            draggingTabDataRef.current.prevX,
            draggingTabDataRef.current.prevDirection
        );
        draggingTabDataRef.current.prevX = currentX;
        draggingTabDataRef.current.prevDirection = dragDirection;
        const scrollable = scrollableRef.current;
        const tabWidth = tabWidthRef.current;

        // Scroll the tab bar if the dragged tab overflows the container bounds
        if (scrollable) {
            const { viewport } = osInstanceRef.current.elements();
            const currentScrollLeft = viewport.scrollLeft;

            if (event.clientX <= tabBarRectLeftOffset) {
                viewport.scrollLeft = Math.max(0, currentScrollLeft - incrementDecrement); // Scroll left
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset += currentScrollLeft - viewport.scrollLeft;
                }
            } else if (event.clientX >= tabBarRectWidth + tabBarRectLeftOffset) {
                viewport.scrollLeft = Math.min(viewport.scrollWidth, currentScrollLeft + incrementDecrement); // Scroll right
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset -= viewport.scrollLeft - currentScrollLeft;
                }
            }
        }

        // Re-calculate currentX after potential scroll adjustment
        initialOffsetX = draggingTabDataRef.current.initialOffsetX;
        totalScrollOffset = draggingTabDataRef.current.totalScrollOffset;
        currentX = event.clientX - initialOffsetX - totalScrollOffset;

        setDraggingTab((prev) => (prev !== tabId ? tabId : prev));

        // 持久化阈值沿用 50px：只有真正拖出这么远，mouseup 才提交顺序并落盘。
        if (Math.abs(currentX - tabStartX) >= DragPersistThresholdPx) {
            draggingTabDataRef.current.dragged = true;
        }

        // Constrain movement within the container bounds
        if (tabBarRef.current) {
            const numberOfTabs = visibleTabIds.length;
            const totalDefaultTabWidth = numberOfTabs * TabDefaultWidth;
            if (totalDefaultTabWidth < tabBarRectWidth) {
                // Set to the total default tab width if there's vacant space
                tabBarRectWidth = totalDefaultTabWidth;
            } else if (scrollable) {
                // Set to the scrollable width if the tab bar is scrollable
                tabBarRectWidth = tabsWrapperRef.current.scrollWidth;
            }

            const minLeft = 0;
            const maxRight = tabBarRectWidth - tabWidth;

            // Adjust currentX to stay within bounds
            currentX = Math.min(Math.max(currentX, minLeft), maxRight);
        }

        ref.current!.style.transform = `translate3d(${currentX}px,0,0)`;
        ref.current!.style.zIndex = "100";

        // R8: 落点比较用 mousedown 实时测量快照（tabId → 位置），与 tabIds 下标无关，
        // 消灭「splice 后下标错位」与「stale dragStartPositions」两类误换位。
        const workingOrder = draggingTabDataRef.current.workingOrder;
        const startPositions = draggingTabDataRef.current.startPositions;
        if (workingOrder == null || startPositions == null) {
            return;
        }
        const newTabIndex = computeNewTabIndex({
            currentX,
            tabWidth,
            dragDirection,
            order: workingOrder,
            draggedTabId: tabId,
            startPositions,
        });
        const curIndex = workingOrder.indexOf(tabId);
        if (newTabIndex >= 0 && newTabIndex !== curIndex) {
            // 只在副本上换位（不碰 React state）
            workingOrder.splice(curIndex, 1);
            workingOrder.splice(newTabIndex, 0, tabId);
            // 其余 Tab 按工作顺序落到新槽位
            workingOrder.forEach((localTabId, index) => {
                if (localTabId === tabId) {
                    return;
                }
                const otherRef = tabRefs.current.find((r) => r.current?.dataset.tabId === localTabId);
                if (otherRef?.current) {
                    otherRef.current.style.transform = `translate3d(${index * tabWidth}px,0,0)`;
                    otherRef.current.classList.add("animate");
                }
            });
            draggingTabDataRef.current.tabIndex = newTabIndex;
        }
    };

    const setUpdatedTabsDebounced = useCallback(
        debounce(300, (tabIds: string[]) => {
            const mergedTabIds = mergeVisibleTabIdsWithSessionOverview(workspace.tabids ?? [], tabIds, (tabId) =>
                globalStore.get(env.wos.getWaveObjectAtom<Tab>(makeORef("tab", tabId)))
            );
            // Reset styles
            tabRefs.current.forEach((ref) => {
                ref.current.style.zIndex = "0";
                ref.current.classList.remove("animate");
            });
            // Reset dragging state
            setDraggingTab(null);
            // Update workspace tab ids
            fireAndForget(() => env.rpc.UpdateWorkspaceTabIdsCommand(TabRpcClient, workspace.oid, mergedTabIds));
        }),
        [workspace?.oid, workspace?.tabids, env]
    );

    const handleMouseUp = (_event: MouseEvent) => {
        const { dragged, engaged, workingOrder, tabId } = draggingTabDataRef.current;
        const tabWidth = tabWidthRef.current;

        if (dragged && workingOrder != null) {
            // 真实拖拽结束: 用工作顺序计算落点 + 提交 state + 落盘。
            // R8: 只有这里才写回 tabIds（副本）；旧实现靠原地 splice 改 state，
            // 亚阈值拖拽会把顺序污染在内存里但不落盘 —— 表现为「顺序自己动了」。
            const finalLeftPosition = Math.max(0, workingOrder.indexOf(tabId)) * tabWidth;
            const ref = tabRefs.current.find((r) => r.current?.dataset.tabId === tabId);
            if (ref?.current) {
                ref.current.classList.add("animate");
                ref.current.style.transform = `translate3d(${finalLeftPosition}px,0,0)`;
            }
            setTabIds(workingOrder);
            setUpdatedTabsDebounced(workingOrder);
        } else {
            // 纯点击: 不改写 transform —— 位置由 setSizeAndPosition 维护.
            // Reset styles
            tabRefs.current.forEach((ref) => {
                if (ref.current) {
                    ref.current.style.zIndex = "0";
                    ref.current.classList.remove("animate");
                }
            });
            // 亚阈值拖拽 (engaged 但未越过持久化阈值) 期间 handleMouseMove 已经
            // 写过内联 transform, 这里不清就会把 Tab 永久卡在半路。
            // 重排一次, 让所有 Tab 回到布局计算出的位置。
            if (engaged) {
                setSizeAndPosition();
            }
            // Reset dragging state
            setDraggingTab(null);
        }

        // 拖拽结束标志必须复位: 否则会泄漏到「更多」下拉的点选路径 ——
        // handleSelectTab 见到 dragged===true 直接 return, 表现为下拉里的 Tab 点不动。
        draggingTabDataRef.current.dragged = false;
        draggingTabDataRef.current.engaged = false;
        draggingTabDataRef.current.consecutiveBeyondCount = 0;
        draggingTabDataRef.current.workingOrder = null;

        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("mousemove", handleMouseMove);
    };

    const handleDragStart = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>, tabId: string, ref: React.RefObject<HTMLDivElement>) => {
            if (event.button !== 0) return;
            const tabIndex = tabIds.indexOf(tabId);
            if (!ref.current || tabIndex < 0) return;

            // R8: 起点与落点比较一律用 mousedown 时的实时 rect 快照。
            // 旧实现依赖 saveTabsPosition 的缓存，而多个调用点（ResizeObserver /
            // reinitVersion）只刷新一半 → stale 位置下小位移被误判跨过邻居中点。
            const wrapperLeft =
                tabsWrapperRef.current?.getBoundingClientRect().left ??
                tabBarRef.current?.getBoundingClientRect().left ??
                0;
            const startPositions = new Map<string, number>();
            for (const visibleTabId of visibleTabIds) {
                const el = tabRefs.current[tabIds.indexOf(visibleTabId)]?.current;
                if (el != null) {
                    startPositions.set(visibleTabId, el.getBoundingClientRect().left - wrapperLeft);
                }
            }
            const tabStartX = startPositions.get(tabId) ?? 0;

            draggingTabDataRef.current = {
                tabId: ref.current.dataset.tabId,
                ref,
                tabStartX,
                tabIndex,
                // mousedown 时就记录光标起点, 拖拽阈值从按下位置起算
                // (而不是第一次 mousemove, 避免小位移被当成"零偏移")
                initialOffsetX: event.clientX - tabStartX,
                totalScrollOffset: 0,
                consecutiveBeyondCount: 0,
                engaged: false,
                dragged: false,
                prevX: null,
                prevDirection: null,
                workingOrder: null,
                startPositions,
            };

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        },
        [tabIds, visibleTabIds]
    );

    const handleSelectTab = (tabId: string) => {
        if (!draggingTabDataRef.current.dragged) {
            // R9.1: 乐观高亮 —— 不等后端广播往返，主栏 active 立即跟随点击。
            setOptimisticActiveTab(tabId);
            markTabOpened(tabId);
            env.electron.setActiveTab(tabId);
        }
    };

    const markTabOpened = useCallback((tabId: string) => {
        markTabOpenedThisLaunch(tabId);
    }, []);

    useEffect(() => {
        if (activeTabId != null) {
            markTabOpened(activeTabId);
        }
    }, [activeTabId, markTabOpened]);

    useEffect(() => {
        setSizeAndPosition();
    }, [visibleTabIds]);

    // 「更多」按钮宽度会随隐藏计数 (0 → 2 位数) 变化, 而 window resize 不会触发.
    // 单独监听它, 保证 spaceForTabs 始终按真实占用计算, Tab 不被遮挡.
    useEffect(() => {
        const el = moreMenuWrapRef.current;
        if (el == null || typeof ResizeObserver === "undefined") {
            return;
        }
        let prevWidth = el.getBoundingClientRect().width;
        const observer = new ResizeObserver(() => {
            const nextWidth = el.getBoundingClientRect().width;
            if (Math.abs(nextWidth - prevWidth) < 0.5) {
                return;
            }
            prevWidth = nextWidth;
            setSizeAndPosition();
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [visibleTabIds]);

    const updateScrollDebounced = useCallback(
        debounce(30, () => {
            if (scrollableRef.current) {
                const { viewport } = osInstanceRef.current.elements();
                viewport.scrollLeft = visibleTabIds.length * tabWidthRef.current;
            }
        }),
        [visibleTabIds]
    );

    const setNewTabIdDebounced = useCallback(
        debounce(100, (tabId: string) => {
            setNewTabId(tabId);
        }),
        []
    );

    const handleAddTab = () => {
        env.electron.createTab();
        tabsWrapperRef.current.style.setProperty("--tabs-wrapper-transition", "width 0.1s ease");

        updateScrollDebounced();

        setNewTabIdDebounced(null);
    };

    const handleCloseTab = (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null, tabId: string) => {
        event?.stopPropagation();
        fireAndForget(async () => {
            if (tabId === activeTabId && !(await confirmCurrentTabClose())) {
                return;
            }
            if (!(await confirmCloseTabIfHasContent(tabId))) {
                return;
            }
            const didClose = await env.electron.closeTab(workspace.oid, tabId, confirmClose);
            if (didClose) {
                tabsWrapperRef.current?.style.setProperty("--tabs-wrapper-transition", "width 0.3s ease");
                deleteLayoutModelForTab(tabId);
            }
        });
    };

    const handleTabLoaded = useCallback((tabId: string) => {
        setTabsLoaded((prev) => {
            if (!prev[tabId]) {
                // Only update if the tab isn't already marked as loaded
                return { ...prev, [tabId]: true };
            }
            return prev;
        });
    }, []);

    const activeTabIndex = visibleTabIds.indexOf(activeTabId);

    function onEllipsisClick() {
        env.electron.showWorkspaceAppMenu(workspace.oid);
    }

    const tabsWrapperWidth = visibleTabIds.length * tabWidthRef.current;
    const showAppMenuButton = env.isWindows() || (!env.isMacOS() && !showMenuBar);

    const handleWindowDragMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        env.electron.startWindowDrag();
        const onUp = () => {
            env.electron.endWindowDrag();
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mouseup", onUp);
    };

    const handleWrapperMouseEnter = useCallback(() => {
        cancelPendingHideWrapperHover();
        onHeaderHoverChange?.(true);
    }, [onHeaderHoverChange, cancelPendingHideWrapperHover]);

    const handleWrapperMouseLeave = useCallback(() => {
        cancelPendingHideWrapperHover();
        hideWrapperHoverTimerRef.current = window.setTimeout(() => {
            hideWrapperHoverTimerRef.current = null;
            onHeaderHoverChange?.(false);
        }, TAB_HEADER_HOVER_DELAY_MS);
    }, [onHeaderHoverChange, cancelPendingHideWrapperHover]);

    // Calculate window drag left width based on platform and state
    let windowDragLeftWidth = 10;
    if (env.isMacOS() && !isFullScreen) {
        const trafficLightsWidth = isMacOSTahoeOrLater() ? MacOSTahoeTrafficLightsWidth : MacOSTrafficLightsWidth;
        if (zoomFactor > 0) {
            windowDragLeftWidth = trafficLightsWidth / zoomFactor;
        } else {
            windowDragLeftWidth = trafficLightsWidth;
        }
    }

    // Calculate window drag right width
    let windowDragRightWidth = 12;
    if (env.isWindows()) {
        if (zoomFactor > 0) {
            windowDragRightWidth = 139 / zoomFactor;
        } else {
            windowDragRightWidth = 139;
        }
    }

    return (
        <div
            ref={tabbarWrapperRef}
            className="tab-bar-wrapper"
            onMouseEnter={handleWrapperMouseEnter}
            onMouseLeave={handleWrapperMouseLeave}
        >
            <div
                ref={draggerLeftRef}
                className="h-full shrink-0 z-window-drag"
                style={{ width: windowDragLeftWidth, WebkitAppRegion: "drag" } as any}
                onMouseDown={env.isMacOS() ? undefined : handleWindowDragMouseDown}
            />
            {showAppMenuButton && (
                <div
                    ref={appMenuButtonRef}
                    className="flex items-center justify-center pr-1.5 text-[26px] select-none cursor-pointer text-secondary hover:text-primary"
                    style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                    onClick={onEllipsisClick}
                >
                    <i className="fa fa-ellipsis" />
                </div>
            )}
            <button
                type="button"
                className={clsx("session-overview-tabbutton", activeMinimizedCount > 0 && "has-blocks-badge")}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={() => {
                    const next = !sidebarExpanded;
                    setSidebarExpanded(next);
                    window.dispatchEvent(
                        new CustomEvent(next ? "block-sidebar:expand" : "block-sidebar:collapse", {
                            detail: { tabId: activeTabId },
                        })
                    );
                }}
                title={
                    sidebarExpanded
                        ? "Collapse sidebar"
                        : `Expand sidebar${activeMinimizedCount > 0 ? ` (${activeMinimizedCount} minimized)` : ""}`
                }
                aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
            >
                <i className={clsx("fa fa-solid", sidebarExpanded ? "fa-chevron-left" : "fa-chevron-right")} />
                {activeMinimizedCount > 0 && <span className="block-sidebar-count-badge">{activeMinimizedCount}</span>}
            </button>
            <WaveAIButton divRef={waveAIButtonRef} />
            {!noTabs && <SessionOverviewButton />}
            <Tooltip
                content="Workspace Switcher"
                placement="bottom"
                hideOnClick
                divRef={workspaceSwitcherRef}
                divClassName="flex items-center"
            >
                <WorkspaceSwitcher />
            </Tooltip>
            <div className="tab-bar" ref={tabBarRef} data-overlayscrollbars-initialize>
                <div
                    className="tabs-wrapper"
                    ref={tabsWrapperRef}
                    style={{
                        width: noTabs ? 0 : tabsWrapperWidth,
                        ...(noTabs ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : {}),
                    }}
                >
                    {!noTabs &&
                        visibleTabIds.map((tabId, segIndex) => {
                            const tabIndex = tabIds.indexOf(tabId);
                            const isActive = highlightTabId === tabId;
                            const showDivider =
                                segIndex !== 0 && !isActive && segIndex !== visibleTabIds.indexOf(highlightTabId) - 1;
                            return (
                                <TabComponent
                                    key={tabId}
                                    ref={tabRefs.current[tabIndex]}
                                    id={tabId}
                                    hidden={false}
                                    showDivider={showDivider}
                                    workspaceId={workspace?.oid}
                                    onSelect={() => handleSelectTab(tabId)}
                                    active={isActive}
                                    onDragStart={(event) => handleDragStart(event, tabId, tabRefs.current[tabIndex])}
                                    onClose={(event) => handleCloseTab(event, tabId)}
                                    onLoaded={() => handleTabLoaded(tabId)}
                                    isDragging={draggingTab === tabId}
                                    tabWidth={tabWidthRef.current}
                                    isNew={tabId === newTabId}
                                />
                            );
                        })}
                </div>
            </div>
            <div ref={moreMenuWrapRef} className="flex items-end mb-1">
                <TabMoreMenu
                    tabIds={tabIds}
                    placement="bottom-end"
                    variant="horizontal"
                    onOpenChange={setIsMoreMenuOpen}
                    onActivateTab={(tabId) => handleSelectTab(tabId)}
                    onCloseTab={(tabId) => handleCloseTab(null, tabId)}
                    onNewTab={() => handleAddTab()}
                    onCollapseInactive={() => {
                        const targets = tabIds.filter(
                            (tabId) =>
                                tabId !== activeTabId &&
                                wasTabOpenedThisLaunch(openedThisLaunchTabIds, tabId) &&
                                !tabsWithUnreadDots.has(tabId)
                        );
                        collapseTabIds(targets);
                        setSizeAndPosition(true);
                    }}
                />
            </div>
            <button
                ref={addBtnRef}
                title="Add Tab"
                className={`flex h-[22px] px-2 mb-1 mx-1 items-center rounded-md box-border cursor-pointer hover:bg-hoverbg transition-colors text-[12px] text-secondary hover:text-primary${noTabs ? " invisible" : ""}`}
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={handleAddTab}
            >
                <i className="fa fa-solid fa-plus" />
            </button>
            <div
                className="flex-1 self-stretch"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onMouseEnter={handleWrapperMouseEnter}
                onMouseDown={handleWindowDragMouseDown}
            />
            <div ref={rightContainerRef} className="flex flex-row gap-1 items-end" style={{ pointerEvents: "none" }}>
                <UpdateStatusBanner />
                {/* widget bar expand/collapse icon (right side, before window controls) */}
                <button
                    type="button"
                    className="session-overview-tabbutton"
                    style={{ WebkitAppRegion: "no-drag", pointerEvents: "auto" } as React.CSSProperties}
                    onClick={() => {
                        const next = !widgetBarExpanded;
                        setWidgetBarExpanded(next);
                        window.dispatchEvent(new Event(next ? "widget-bar:expand" : "widget-bar:collapse"));
                    }}
                    title={widgetBarExpanded ? "Collapse widgets bar" : "Expand widgets bar"}
                    aria-label={widgetBarExpanded ? "Collapse widgets bar" : "Expand widgets bar"}
                >
                    <i className={clsx("fa fa-solid", widgetBarExpanded ? "fa-chevron-right" : "fa-chevron-left")} />
                </button>
                <div
                    className="h-full shrink-0 z-window-drag"
                    style={{ width: windowDragRightWidth, WebkitAppRegion: "drag", pointerEvents: "auto" } as any}
                    onMouseDown={handleWindowDragMouseDown}
                />
            </div>
        </div>
    );
});

export { TabBar, WaveAIButton };
