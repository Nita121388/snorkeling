// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultAgentWidgetId, DefaultTerminalWidgetId, extractTerminalContextMeta } from "@/app/workspace/agent-launch";
import { requestLaunchPopup } from "@/app/workspace/launch-popup-bus";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { Tooltip } from "@/app/element/tooltip";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { getLayoutModelForTabById, LayoutTreeActionType, newLayoutNode } from "@/layout/index";
import type { LayoutTreeInsertNodeAction } from "@/layout/index";
import { makeORef } from "@/store/wos";
import { fireAndForget, makeIconClass } from "@/util/util";
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating } from "@floating-ui/react";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlockEnv } from "./blockenv";

const WidgetHoverOpenDelayMs = 500; // mirror right-side WidgetsBar hover dwell
const DefaultCreateBlockRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

export type GroupAddableWidget = {
    id: string;
    config: WidgetConfigType;
};

/**
 * Widgets offered by the group "+" menu: same registry as the right WidgetsBar
 * (fullConfig.widgets), workspace-filtered, sorted by display:order.
 * Skipped: display:hidden widgets and action-only widgets (no blockdef → nothing to create).
 */
export function pickGroupAddableWidgets(wmap: { [key: string]: WidgetConfigType }, workspaceId?: string): GroupAddableWidget[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.entries(wmap)
        .filter(([_id, config]) => !config["display:hidden"])
        .filter(([_id, config]) => config.blockdef != null)
        .filter(([_id, config]) => shouldIncludeWidgetForWorkspace(config, workspaceId))
        .map(([id, config]) => ({ id, config }));
    wlist.sort((a, b) => (a.config["display:order"] ?? 0) - (b.config["display:order"] ?? 0));
    return wlist;
}

/**
 * Files widget blockdef for the "+" menu: inherit connection + cwd from the active terminal
 * block of the group so the new preview opens where the user already is; fall back to the
 * widget's default (~). Non-terminal active blocks give no context (extractTerminalContextMeta).
 */
export function buildFilesBlockDef(widgetBlockDef: BlockDef, activeBlock: Block | null | undefined): BlockDef {
    const ctx = extractTerminalContextMeta(activeBlock);
    const meta: Record<string, unknown> = { ...(widgetBlockDef?.meta ?? {}) };
    if (ctx?.["cmd:cwd"] != null) {
        meta["file"] = ctx["cmd:cwd"];
    }
    if (ctx?.connection != null) {
        meta["connection"] = ctx.connection;
    }
    return { ...widgetBlockDef, meta };
}

type InlineTabGroupAddButtonProps = {
    nodeId: string;
    tabId: string;
    activeBlockId?: string;
};

/**
 * The "+" button pinned at the top-right of an inline-tab group's tab row (rendered when
 * blockIds.length > 1). Opens a widget-driven menu (fullConfig.widgets); creating inserts the
 * new block into THIS group as a new tab via layoutModel.addBlockToInlineTab.
 *
 * Terminal / Agent entries don't create directly: hover 500ms (or click) closes the menu and
 * asks WorkspaceWidgets (via launch-popup-bus) to open the SAME target-selector floating
 * windows as the right WidgetsBar, with creation funneled back into this group.
 */
export const InlineTabGroupAddButton = memo(({ nodeId, tabId, activeBlockId }: InlineTabGroupAddButtonProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const fullConfig = useAtomValue(waveEnv.atoms.fullConfigAtom);
    const workspaceId = useAtomValue(waveEnv.atoms.workspaceId);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const hoverTimerRef = useRef<number | null>(null);

    // Active block context (for Files cwd/connection inheritance)
    const activeBlockAtom = useMemo(
        () => (activeBlockId != null ? waveEnv.wos.getWaveObjectAtom<Block>(makeORef("block", activeBlockId)) : null),
        [activeBlockId, waveEnv]
    );
    const activeBlock = useAtomValue(activeBlockAtom);

    const addableWidgets = useMemo(() => pickGroupAddableWidgets(fullConfig?.widgets ?? {}, workspaceId), [fullConfig, workspaceId]);

    const closeMenu = useCallback(() => setMenuOpen(false), []);

    const { refs, floatingStyles } = useFloating({
        open: menuOpen,
        onOpenChange: setMenuOpen,
        placement: "bottom-end",
        middleware: [offset(4), flip(), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
        elements: {
            reference: buttonRef.current,
        },
    });

    // Outside click / Esc closes the menu
    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as HTMLElement;
            if (buttonRef.current?.contains(target) || refs.floating.current?.contains(target)) {
                return;
            }
            setMenuOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                setMenuOpen(false);
            }
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [menuOpen, refs]);

    useEffect(
        () => () => {
            if (hoverTimerRef.current != null) {
                window.clearTimeout(hoverTimerRef.current);
            }
        },
        []
    );

    // Terminal / Agent: close menu and ask WorkspaceWidgets to open its target-selector popup
    // anchored at this "+" button; creation funnels back into this group (group sink nodeId).
    const requestTargetPopup = useCallback(
        (mode: "terminal" | "agent") => {
            closeMenu();
            const anchorEl = buttonRef.current;
            if (anchorEl == null) {
                return;
            }
            requestLaunchPopup({ mode, anchorEl, nodeId });
        },
        [closeMenu, nodeId]
    );

    const clearHoverTimer = useCallback(() => {
        if (hoverTimerRef.current != null) {
            window.clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    }, []);

    const handleTargetItemPointerEnter = useCallback(
        (mode: "terminal" | "agent") => {
            clearHoverTimer();
            hoverTimerRef.current = window.setTimeout(() => {
                hoverTimerRef.current = null;
                requestTargetPopup(mode);
            }, WidgetHoverOpenDelayMs);
        },
        [clearHoverTimer, requestTargetPopup]
    );

    const handleDirectCreate = useCallback(
        (widgetId: string, widget: WidgetConfigType) => {
            closeMenu();
            let blockDef = widget.blockdef;
            if (blockDef == null) {
                console.warn(`Widget ${widgetId} has no blockdef`);
                return;
            }
            if (widgetId === "defwidget@files") {
                blockDef = buildFilesBlockDef(blockDef, activeBlock);
            }
            const layoutModel = getLayoutModelForTabById(tabId);
            if (layoutModel == null) {
                return;
            }
            fireAndForget(async () => {
                const newBlockId = await waveEnv.services.object.CreateBlock(blockDef, DefaultCreateBlockRuntimeOpts);
                if (!layoutModel.addBlockToInlineTab(nodeId, newBlockId)) {
                    // ponytail: group closed while creating — insert as a plain tab so the
                    // freshly-created block isn't orphaned. Upgrade path: delete orphan instead.
                    const insertNodeAction: LayoutTreeInsertNodeAction = {
                        type: LayoutTreeActionType.InsertNode,
                        node: newLayoutNode(undefined, undefined, undefined, { blockId: newBlockId }),
                        magnified: false,
                        focused: true,
                    };
                    layoutModel.treeReducer(insertNodeAction);
                }
            });
        },
        [activeBlock, closeMenu, nodeId, tabId, waveEnv.services.object]
    );

    return (
        <>
            <Tooltip content="Add Tab to Group" placement="bottom">
                <button
                    ref={buttonRef}
                    type="button"
                    className="inline-tab-block-addbtn"
                    title="Add Tab to Group"
                    aria-label="Add Tab to Group"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen((open) => !open);
                    }}
                >
                    <i className={makeIconClass("plus", true)} />
                </button>
            </Tooltip>
            {menuOpen && (
                <FloatingPortal>
                    <div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 1000 }} className="inline-tab-block-addmenu" role="menu">
                        {addableWidgets.map(({ id, config }) => {
                            const isTargetWidget = id === DefaultTerminalWidgetId || id === DefaultAgentWidgetId;
                            const mode: "terminal" | "agent" | null =
                                id === DefaultTerminalWidgetId ? "terminal" : id === DefaultAgentWidgetId ? "agent" : null;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    role="menuitem"
                                    className="inline-tab-block-addmenu-item"
                                    title={config.description || config.label}
                                    onPointerEnter={
                                        mode != null ? () => handleTargetItemPointerEnter(mode) : clearHoverTimer
                                    }
                                    onPointerLeave={mode != null ? clearHoverTimer : undefined}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (mode != null) {
                                            requestTargetPopup(mode);
                                            return;
                                        }
                                        handleDirectCreate(id, config);
                                    }}
                                >
                                    <span className="inline-tab-block-addmenu-icon" style={{ color: config.color }}>
                                        <i className={makeIconClass(config.icon, false, { defaultIcon: "browser" })} />
                                    </span>
                                    <span className="inline-tab-block-addmenu-label">{config.label}</span>
                                    {isTargetWidget && (
                                        <span className="inline-tab-block-addmenu-hint" title="Choose launch target">
                                            <i className={makeIconClass("chevron-right", true)} />
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
});
InlineTabGroupAddButton.displayName = "InlineTabGroupAddButton";
