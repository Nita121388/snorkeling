// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabBadgeAtom } from "@/app/store/badge";
import { getTabAgentStatusDotsAtom } from "@/app/agent-status/agent-status-tab-aggregate";
import type { TabAgentStatusDot } from "@/app/agent-status/agent-status-tab-aggregate";
import { refocusNode } from "@/app/store/global";
import { getTabModelByTabId } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveEnv, WaveEnvSubset, useWaveEnv } from "@/app/waveenv/waveenv";
import { Button } from "@/element/button";
import { validateCssColor } from "@/util/color-validator";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { makeORef } from "../store/wos";
import { openedThisLaunchTabIdsAtom, wasTabOpenedThisLaunch } from "./tab-open-state";
import "./tab.scss";
import { TabBadges } from "./tabbadges";
import { buildTabContextMenu } from "./tabcontextmenu";
import { TabGroupMenu } from "./tabgroup-menu";
import { getGroupOfTab } from "./tabgroup";
import { useTabGroups } from "./tabgroup-store";

export type TabEnv = WaveEnvSubset<{
    electron: {
        moveTabToNewWindow: WaveEnv["electron"]["moveTabToNewWindow"];
        moveTabBack: WaveEnv["electron"]["moveTabBack"];
    };
    rpc: {
        ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        UpdateTabNameCommand: WaveEnv["rpc"]["UpdateTabNameCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        workspaceId: WaveEnv["atoms"]["workspaceId"];
    };
    wos: WaveEnv["wos"];
    getSettingsKeyAtom: WaveEnv["getSettingsKeyAtom"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

interface TabVProps {
    tabId: string;
    tabName: string;
    active: boolean;
    showDivider: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    unopenedThisLaunch: boolean;
    hidden?: boolean;
    badges?: Badge[] | null;
    agentDots?: TabAgentStatusDot[] | null;
    flagColor?: string | null;
    onClick: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
    onRename: (newName: string) => void;
    /** Optional ref that TabV populates with a startRename() function for external callers */
    renameRef?: React.RefObject<(() => void) | null>;
    /** Group color accent (left bar) when this tab belongs to a group. */
    groupColor?: string | null;
    /** Hover trigger affordance for the "Tab to Group" menu. */
    groupTrigger?: React.ReactNode;
}

const TabV = forwardRef<HTMLDivElement, TabVProps>((props, ref) => {
    const {
        tabId,
        tabName,
        active,
        showDivider,
        isDragging,
        tabWidth,
        isNew,
        unopenedThisLaunch,
        hidden: isHidden = false,
        badges,
        agentDots,
        flagColor,
        onClick,
        onClose,
        onDragStart,
        onContextMenu,
        onRename,
        renameRef,
        groupColor = null,
        groupTrigger = null,
    } = props;
    const MaxTabNameLength = 14;
    const truncateTabName = (name: string) => [...(name ?? "")].slice(0, MaxTabNameLength).join("");
    const displayName = truncateTabName(tabName);
    const [originalName, setOriginalName] = useState(displayName);
    const [isEditable, setIsEditable] = useState(false);

    const editableRef = useRef<HTMLDivElement>(null);
    const editableTimeoutRef = useRef<NodeJS.Timeout>(null);
    const tabRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => tabRef.current as HTMLDivElement);

    useEffect(() => {
        setOriginalName(truncateTabName(tabName));
    }, [tabName]);

    useEffect(() => {
        return () => {
            if (editableTimeoutRef.current) {
                clearTimeout(editableTimeoutRef.current);
            }
        };
    }, []);

    const selectEditableText = useCallback(() => {
        if (!editableRef.current) {
            return;
        }
        editableRef.current.focus();
        const range = document.createRange();
        const selection = window.getSelection();
        if (!selection) {
            return;
        }
        range.selectNodeContents(editableRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
    }, []);

    const startRename = useCallback(() => {
        setIsEditable(true);
        editableTimeoutRef.current = setTimeout(() => {
            selectEditableText();
        }, 50);
    }, [selectEditableText]);

    const handleRenameTab: React.MouseEventHandler<HTMLDivElement> = useCallback(
        (event) => {
            event?.stopPropagation();
            startRename();
        },
        [startRename]
    );

    // Expose startRename to external callers (e.g. context menu in TabInner)
    if (renameRef != null) {
        renameRef.current = startRename;
    }

    const handleBlur = () => {
        if (!editableRef.current) return;
        let newText = editableRef.current.innerText.trim();
        newText = newText || originalName;
        editableRef.current.innerText = newText;
        setIsEditable(false);
        onRename(newText);
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "a") {
            event.preventDefault();
            selectEditableText();
            return;
        }
        if (!editableRef.current) return;
        const curLen = Array.from(editableRef.current.innerText).length;
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (editableRef.current.innerText.trim() === "") {
                editableRef.current.innerText = originalName;
            }
            editableRef.current.blur();
        } else if (event.key === "Escape") {
            editableRef.current.innerText = originalName;
            editableRef.current.blur();
            event.preventDefault();
            event.stopPropagation();
        } else if (curLen >= 14 && !["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) {
                event.preventDefault();
                event.stopPropagation();
            }
        }
    };

    useEffect(() => {
        if (tabRef.current && isNew) {
            const initialWidth = `${(tabWidth / 3) * 2}px`;
            tabRef.current.style.setProperty("--initial-tab-width", initialWidth);
            tabRef.current.style.setProperty("--final-tab-width", `${tabWidth}px`);
        }
    }, [isNew, tabWidth]);

    const handleMouseDownOnClose = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        event.stopPropagation();
    };

    return (
        <div
            ref={tabRef}
            className={clsx("tab", {
                active,
                dragging: isDragging,
                "new-tab": isNew,
                "unopened-this-launch": unopenedThisLaunch,
                hidden: isHidden,
                "in-group": groupColor != null,
            })}
            style={groupColor != null ? ({ ["--group-color" as string]: groupColor } as React.CSSProperties) : undefined}
            onMouseDown={onDragStart}
            onClick={onClick}
            onContextMenu={onContextMenu}
            data-tab-id={tabId}
        >
            {showDivider && <div className="tab-divider" />}
            <div className="tab-inner">
                {groupTrigger}
                <div
                    ref={editableRef}
                    className={clsx("name", { focused: isEditable })}
                    contentEditable={isEditable}
                    onDoubleClick={handleRenameTab}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    suppressContentEditableWarning={true}
                >
                    {displayName}
                </div>
                <TabBadges badges={badges} agentDots={agentDots} flagColor={flagColor} />
                <Button
                    className="ghost grey close"
                    onClick={onClose}
                    onMouseDown={handleMouseDownOnClose}
                    title="Close Tab"
                >
                    <i className="fa fa-solid fa-xmark" />
                </Button>
            </div>
        </div>
    );
});

TabV.displayName = "TabV";

interface TabProps {
    id: string;
    active: boolean;
    showDivider: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    hidden?: boolean;
    onSelect: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onLoaded: () => void;
}

const TabInner = forwardRef<HTMLDivElement, TabProps>((props, ref) => {
    const { id, active, showDivider, isDragging, tabWidth, isNew, hidden: isHidden, onLoaded, onSelect, onClose, onDragStart } = props;
    const env = useWaveEnv<TabEnv>();
    const [tabData, _] = env.wos.useWaveObjectValue<Tab>(makeORef("tab", id));
    const badges = useAtomValue(getTabBadgeAtom(id, env));
    // C 层 agent-status 聚合点 (22 号方案决策 6B): D 走自有通道, 仅借 TabBadges 槽位渲染.
    const agentDots = useAtomValue(getTabAgentStatusDotsAtom(id));
    const openedThisLaunchTabIds = useAtomValue(openedThisLaunchTabIdsAtom);

    const workspaceId = useAtomValue(env.atoms.workspaceId);
    const groups = useTabGroups(workspaceId);
    const groupColor = getGroupOfTab(groups, id)?.color ?? null;
    const groupTrigger = (
        <TabGroupMenu env={env} workspaceId={workspaceId} tabId={id}>
            <button
                type="button"
                className="tab-group-trigger"
                title="Tab to Group"
                aria-label="Tab to Group"
                aria-haspopup="menu"
                onClick={(e) => e.stopPropagation()}
            >
                <i className="fa fa-solid fa-layer-group" />
            </button>
        </TabGroupMenu>
    );

    const rawFlagColor = tabData?.meta?.["tab:flagcolor"];
    const unopenedThisLaunch = !wasTabOpenedThisLaunch(openedThisLaunchTabIds, id);
    let flagColor: string | null = null;
    if (rawFlagColor) {
        try {
            validateCssColor(rawFlagColor);
            flagColor = rawFlagColor;
        } catch {
            flagColor = null;
        }
    }

    const loadedRef = useRef(false);
    const renameRef = useRef<(() => void) | null>(null);
    const tabModel = getTabModelByTabId(id, env);

    useEffect(() => {
        if (!loadedRef.current) {
            onLoaded();
            loadedRef.current = true;
        }
    }, [onLoaded]);

    useEffect(() => {
        const cb = () => renameRef.current?.();
        tabModel.startRenameCallback = cb;
        return () => {
            if (tabModel.startRenameCallback === cb) {
                tabModel.startRenameCallback = null;
            }
        };
    }, [tabModel]);

    const handleTabClick = () => {
        onSelect();
    };

    const handleContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            e.preventDefault();
            const menu = buildTabContextMenu(id, renameRef, onClose, env);
            env.showContextMenu(menu, e);
        },
        [id, onClose, env]
    );

    const handleRename = useCallback(
        (newName: string) => {
            fireAndForget(() => env.rpc.UpdateTabNameCommand(TabRpcClient, id, newName));
            setTimeout(() => refocusNode(null), 10);
        },
        [id, env]
    );

    return (
        <TabV
            ref={ref}
            tabId={id}
            tabName={tabData?.name ?? ""}
            active={active}
            showDivider={showDivider}
            isDragging={isDragging}
            tabWidth={tabWidth}
            isNew={isNew}
            unopenedThisLaunch={unopenedThisLaunch}
            hidden={isHidden}
            badges={badges}
            agentDots={agentDots}
            flagColor={flagColor}
            groupColor={groupColor}
            groupTrigger={groupTrigger}
            onClick={handleTabClick}
            onClose={onClose}
            onDragStart={onDragStart}
            onContextMenu={handleContextMenu}
            onRename={handleRename}
            renameRef={renameRef}
        />
    );
});
const Tab = memo(TabInner);
Tab.displayName = "Tab";

export { Tab, TabV };
