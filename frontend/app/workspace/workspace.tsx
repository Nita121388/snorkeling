// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { VTabBar } from "@/app/tab/vtabbar";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms, getApi, getSettingsKeyAtom } from "@/store/global";
import { isMacOS } from "@/util/platformutil";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const MacOSTabBarSpacer = memo(() => {
    return (
        <div
            className="w-full shrink-0"
            style={
                {
                    height: "calc(8px * var(--zoomfactor-inv))",
                    WebkitAppRegion: "drag",
                    backdropFilter: "blur(20px)",
                    background: "var(--tabbar-bg-color)",
                } as React.CSSProperties
            }
        />
    );
});
MacOSTabBarSpacer.displayName = "MacOSTabBarSpacer";

const WorkspaceElem = memo(() => {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const tabBarPosition = useAtomValue(getSettingsKeyAtom("app:tabbar")) ?? "top";
    const showLeftTabBar = tabBarPosition === "left";
    const aiPanelVisible = useAtomValue(workspaceLayoutModel.panelVisibleAtom);

    const windowWidth = window.innerWidth;
    const leftGroupInitialPct = workspaceLayoutModel.getLeftGroupInitialPercentage(windowWidth, showLeftTabBar);
    const innerVTabInitialPct = workspaceLayoutModel.getInnerVTabInitialPercentage(windowWidth, showLeftTabBar);
    const innerAIPanelInitialPct = workspaceLayoutModel.getInnerAIPanelInitialPercentage(windowWidth, showLeftTabBar);
    const outerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const innerPanelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const vtabPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);
    const vtabPanelWrapperRef = useRef<HTMLDivElement>(null);
    // Tracks whether the mouse is hovering over the entire App Header region
    // (top TabBar row on Windows/Linux, left VTabBar sidebar on macOS).
    // Used to expand hidden (not-opened-today) Types on header hover instead of
    // requiring a hover over each specific Type.
    const [isHeaderHovered, setIsHeaderHovered] = useState(false);

    // 内容区保活/预挂载: 提前挂载"当前激活 + 悬浮(即将点击) + 最近用过的"几个 tab 的
    // 内容 (非激活用 visibility:hidden 隐藏但保持真实尺寸, 便于 tile 布局正确测量),
    // 这样切到这些 tab 时直接显示已挂载内容, 消除"切到隐藏 tab 先黑屏再加载"的闪黑.
    const PreloadTabCap = 3;
    const [preloadTabIds, setPreloadTabIds] = useState<string[]>([]);
    useEffect(() => {
        setPreloadTabIds((prev) => {
            const next = prev.filter((id) => id !== tabId);
            next.unshift(tabId);
            return next.slice(0, PreloadTabCap);
        });
    }, [tabId]);
    const handleHoveredTabChange = useCallback((hoveredTabId: string | null) => {
        if (!hoveredTabId) {
            return;
        }
        setPreloadTabIds((prev) => {
            const next = prev.filter((id) => id !== hoveredTabId);
            next.unshift(hoveredTabId);
            return next.slice(0, PreloadTabCap);
        });
    }, []);
    const renderPreloadTabIds =
        tabId === "" ? [] : [tabId, ...preloadTabIds.filter((id) => id !== tabId)].slice(0, PreloadTabCap);

    // showLeftTabBar is passed as a seed value only; subsequent changes are handled by setShowLeftTabBar below.
    // Do NOT add showLeftTabBar as a dep here — re-registering refs on config changes would redundantly re-run commitLayouts.
    useEffect(() => {
        if (
            aiPanelRef.current &&
            outerPanelGroupRef.current &&
            innerPanelGroupRef.current &&
            panelContainerRef.current &&
            aiPanelWrapperRef.current
        ) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                outerPanelGroupRef.current,
                innerPanelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current,
                vtabPanelRef.current ?? undefined,
                vtabPanelWrapperRef.current ?? undefined,
                showLeftTabBar
            );
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setWaveAIOpen(isVisible);
    }, []);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    useEffect(() => {
        workspaceLayoutModel.setShowLeftTabBar(showLeftTabBar);
    }, [showLeftTabBar]);

    useEffect(() => {
        const handleFocus = () => workspaceLayoutModel.syncVTabWidthFromMeta();
        window.addEventListener("focus", handleFocus);
        return () => window.removeEventListener("focus", handleFocus);
    }, []);

    const innerHandleVisible = showLeftTabBar && aiPanelVisible;
    const innerHandleClass = `bg-transparent hover:bg-hover transition-colors ${innerHandleVisible ? "w-0.5" : "w-0 pointer-events-none"}`;
    const outerHandleVisible = showLeftTabBar || aiPanelVisible;
    const outerHandleClass = `bg-transparent hover:bg-hover transition-colors ${outerHandleVisible ? "w-0.5" : "w-0 pointer-events-none"}`;

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            {!(showLeftTabBar && isMacOS()) && (
                <TabBar
                    key={ws.oid}
                    workspace={ws}
                    noTabs={showLeftTabBar}
                    headerHovered={isHeaderHovered}
                    onHeaderHoverChange={setIsHeaderHovered}
                />
            )}
            {showLeftTabBar && isMacOS() && <MacOSTabBarSpacer />}
            <div ref={panelContainerRef} className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup
                        direction="horizontal"
                        onLayout={workspaceLayoutModel.handleOuterPanelLayout}
                        ref={outerPanelGroupRef}
                    >
                        <Panel order={0} defaultSize={leftGroupInitialPct} className="overflow-hidden">
                            <PanelGroup
                                direction="horizontal"
                                onLayout={workspaceLayoutModel.handleInnerPanelLayout}
                                ref={innerPanelGroupRef}
                            >
                                <Panel
                                    ref={vtabPanelRef}
                                    collapsible
                                    defaultSize={innerVTabInitialPct}
                                    order={0}
                                    className="overflow-hidden"
                                >
                                    <div
                                        ref={vtabPanelWrapperRef}
                                        className="w-full h-full"
                                        onMouseEnter={() => setIsHeaderHovered(true)}
                                        onMouseLeave={() => setIsHeaderHovered(false)}
                                    >
                                        {showLeftTabBar && (
                                            <VTabBar
                                                workspace={ws}
                                                headerHovered={isHeaderHovered}
                                                onHoveredTabChange={handleHoveredTabChange}
                                            />
                                        )}
                                    </div>
                                </Panel>
                                <PanelResizeHandle className={innerHandleClass} />
                                <Panel
                                    ref={aiPanelRef}
                                    collapsible
                                    defaultSize={innerAIPanelInitialPct}
                                    order={1}
                                    className="overflow-hidden"
                                >
                                    <div
                                        ref={aiPanelWrapperRef}
                                        className={`w-full h-full pr-0.5 ${aiPanelVisible ? "" : "opacity-0"}`}
                                    >
                                        {tabId !== "" && <AIPanel roundTopLeft={showLeftTabBar} />}
                                    </div>
                                </Panel>
                            </PanelGroup>
                        </Panel>
                        <PanelResizeHandle className={outerHandleClass} />
                        <Panel order={1} defaultSize={100 - leftGroupInitialPct}>
                            {tabId === "" ? (
                                <CenteredDiv>No Active Tab</CenteredDiv>
                            ) : (
                                <div className="flex flex-row h-full min-w-0 w-full overflow-hidden">
                                    <div className="relative flex-1 min-w-0 h-full min-h-0">
                                        {renderPreloadTabIds.map((preTabId) => {
                                            const isActive = preTabId === tabId;
                                            return (
                                                <div
                                                    key={preTabId}
                                                    className="absolute inset-0"
                                                    style={{ visibility: isActive ? "visible" : "hidden" }}
                                                >
                                                    <TabContent
                                                        tabId={preTabId}
                                                        noTopPadding={showLeftTabBar && isMacOS()}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <Widgets />
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };
