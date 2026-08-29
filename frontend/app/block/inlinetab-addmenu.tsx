// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultAgentWidgetId, DefaultTerminalWidgetId, extractTerminalContextMeta } from "@/app/workspace/agent-launch";
import { requestLaunchPopup } from "@/app/workspace/launch-popup-bus";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { getNoteDirectory, makeNoteBlockDef, NoteWidgetAction } from "@/app/workspace/note-block";
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

// 悬浮 Terminal/Agent 菜单项多久后开二级浮窗（与右侧 WidgetsBar 一致）。
const ItemHoverOpenDelayMs = 500;

// 把菜单项锚点冻结为一次性快照。二级浮窗若锚定活的菜单项（它在overflow:auto的一级菜单里），
// 鼠标移入弹窗的瞬间 floating-ui autoUpdate（layoutShift/elementResize）会重算导致瞬移；
// 冻结快照后位置恒定。代价：后续若一级菜单移动，弹窗不跟随（本场景菜单不移动）。
type FrozenAnchor = { getBoundingClientRect: () => DOMRect; contextElement: HTMLElement };
function makeFrozenAnchor(el: HTMLElement): FrozenAnchor {
    const rect = el.getBoundingClientRect();
    return { getBoundingClientRect: () => rect, contextElement: el };
}

const DefaultCreateBlockRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

export type GroupAddableWidget = {
    id: string;
    config: WidgetConfigType;
};

/**
 * Widgets offered by the group "+" menu: same registry as the right WidgetsBar
 * (fullConfig.widgets), workspace-filtered, sorted by display:order.
 * Skipped: display:hidden widgets, and action-only widgets that open a modal instead of
 * creating a block (e.g. commontext:search). Note is an action-only widget but is kept because
 * it resolves to a blockdef (a note preview for the notes directory).
 */
export function pickGroupAddableWidgets(wmap: { [key: string]: WidgetConfigType }, workspaceId?: string): GroupAddableWidget[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.entries(wmap)
        .filter(([_id, config]) => !config["display:hidden"])
        // A widget is group-addable if activating it creates a block: either it carries a
        // blockdef, or its action resolves to a block (today only Note does — it builds a note
        // block via makeNoteBlockDef). Action-only widgets that open a modal instead of creating a
        // block (e.g. commontext:search) are intentionally excluded.
        .filter(([_id, config]) => config.blockdef != null || config.action === NoteWidgetAction)
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
 * Terminal / Agent entries don't create directly: hover 500ms (or click) opens the SAME
 * target-selector floating windows as the right WidgetsBar (via launch-popup-bus, anchored to
 * the hovered menu item) while keeping this menu open; creation funnels back into this group.
 */
export const InlineTabGroupAddButton = memo(({ nodeId, tabId, activeBlockId }: InlineTabGroupAddButtonProps) => {
    const waveEnv = useWaveEnv<BlockEnv>();
    const fullConfig = useAtomValue(waveEnv.atoms.fullConfigAtom);
    const workspaceId = useAtomValue(waveEnv.atoms.workspaceId);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    // Active block context (for Files cwd/connection inheritance)
    const activeBlockAtom = useMemo(
        () => (activeBlockId != null ? waveEnv.wos.getWaveObjectAtom<Block>(makeORef("block", activeBlockId)) : null),
        [activeBlockId, waveEnv]
    );
    const activeBlock = useAtomValue(activeBlockAtom);

    const addableWidgets = useMemo(() => pickGroupAddableWidgets(fullConfig?.widgets ?? {}, workspaceId), [fullConfig, workspaceId]);

    const closeMenu = useCallback(() => setMenuOpen(false), []);

    // 一级/二级浮窗协调：二级（target-selector）由右侧 WidgetsBar 渲染，跨 React 树；
    // 通过 requestLaunchPopup 的 onOpenChange 把二级 open 状态回传到这里，决定一级是否收起。
    const [secondLevelOpen, setSecondLevelOpen] = useState(false);
    const iconHoveredRef = useRef(false);
    const menuHoveredRef = useRef(false);
    const secondLevelOpenRef = useRef(false);
    const iconOpenTimerRef = useRef<number | null>(null);
    const menuCloseTimerRef = useRef<number | null>(null);
    const itemHoverTimerRef = useRef<number | null>(null);

    // 悬浮「+」图标：清除待收起计时，短暂延迟后开一级。
    const openMenuSoon = useCallback(() => {
        if (menuCloseTimerRef.current != null) {
            window.clearTimeout(menuCloseTimerRef.current);
            menuCloseTimerRef.current = null;
        }
        if (iconOpenTimerRef.current != null) {
            return;
        }
        iconOpenTimerRef.current = window.setTimeout(() => {
            iconOpenTimerRef.current = null;
            setMenuOpen(true);
        }, 120);
    }, []);

    // 收起一级：二级仍开 / 指针仍在图标或菜单上则取消；否则延时关闭。
    const scheduleMenuClose = useCallback(() => {
        if (iconOpenTimerRef.current != null) {
            window.clearTimeout(iconOpenTimerRef.current);
            iconOpenTimerRef.current = null;
        }
        if (menuCloseTimerRef.current != null) {
            window.clearTimeout(menuCloseTimerRef.current);
        }
        menuCloseTimerRef.current = window.setTimeout(() => {
            menuCloseTimerRef.current = null;
            if (!iconHoveredRef.current && !menuHoveredRef.current && !secondLevelOpenRef.current) {
                setMenuOpen(false);
            }
        }, 220);
    }, []);

    // 二级 open 状态回传：关闭时若指针已不在一级上则收起一级。
    const handleSecondLevelOpenChange = useCallback(
        (open: boolean) => {
            secondLevelOpenRef.current = open;
            setSecondLevelOpen(open);
            if (!open) {
                scheduleMenuClose();
            }
        },
        [scheduleMenuClose]
    );

    // 悬浮 Terminal/Agent 菜单项 ItemHoverOpenDelayMs → 开二级（锚定该菜单项）。
    const startItemHover = useCallback(
        (mode: "terminal" | "agent", anchorEl: HTMLElement) => {
            if (itemHoverTimerRef.current != null) {
                return;
            }
            itemHoverTimerRef.current = window.setTimeout(() => {
                itemHoverTimerRef.current = null;
                secondLevelOpenRef.current = true;
                setSecondLevelOpen(true);
                requestLaunchPopup({ mode, anchorEl: makeFrozenAnchor(anchorEl), nodeId, onOpenChange: handleSecondLevelOpenChange, centered: false });
            }, ItemHoverOpenDelayMs);
        },
        [handleSecondLevelOpenChange, nodeId]
    );

    const clearItemHover = useCallback(() => {
        if (itemHoverTimerRef.current != null) {
            window.clearTimeout(itemHoverTimerRef.current);
            itemHoverTimerRef.current = null;
        }
    }, []);

    // 卸载清理所有待触发计时器。
    useEffect(() => {
        return () => {
            if (iconOpenTimerRef.current != null) window.clearTimeout(iconOpenTimerRef.current);
            if (menuCloseTimerRef.current != null) window.clearTimeout(menuCloseTimerRef.current);
            if (itemHoverTimerRef.current != null) window.clearTimeout(itemHoverTimerRef.current);
        };
    }, []);

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
            // 二级开启时一级保持：用户在二级内/外点击由二级自己处理，不要在此收起一级。
            if (secondLevelOpenRef.current) {
                return;
            }
            const target = e.target as HTMLElement;
            if (buttonRef.current?.contains(target) || refs.floating.current?.contains(target)) {
                return;
            }
            setMenuOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                // 二级开启时让二级自己处理 Esc（关闭二级会回传并收起一级）。
                if (!secondLevelOpenRef.current) {
                    setMenuOpen(false);
                }
            }
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [menuOpen, refs]);

    // Terminal / Agent: close menu and ask WorkspaceWidgets to open its target-selector popup
    // anchored at this "+" button; creation funnels back into this group (group sink nodeId).
    const requestTargetPopup = useCallback(
        (mode: "terminal" | "agent", anchorEl: HTMLElement) => {
            // 点击 Terminal/Agent：立即开二级（锚定该菜单项），并保持一级菜单不关。
            clearItemHover();
            secondLevelOpenRef.current = true;
            setSecondLevelOpen(true);
            requestLaunchPopup({ mode, anchorEl: makeFrozenAnchor(anchorEl), nodeId, onOpenChange: handleSecondLevelOpenChange, centered: false });
        },
        [clearItemHover, handleSecondLevelOpenChange, nodeId]
    );

    // 普通 widget 点击直接创建并关菜单；Terminal/Agent 走二级（保持菜单开），见上方。

    const handleDirectCreate = useCallback(
        (widgetId: string, widget: WidgetConfigType) => {
            closeMenu();
            // Resolve the blockdef to insert into the group. Note is an action-only widget that
            // builds its blockdef lazily from the notes directory; everything else needs a blockdef.
            let blockDef: BlockDef | null = null;
            if (widget.action === NoteWidgetAction) {
                blockDef = makeNoteBlockDef(getNoteDirectory());
            } else if (widget.blockdef != null) {
                blockDef = widget.blockdef;
            } else {
                console.warn(`Widget ${widgetId} cannot be added to a group`);
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
            <Tooltip content="Add Widget to Group" placement="bottom" disable={menuOpen}>
                <button
                    ref={buttonRef}
                    type="button"
                    className="inline-tab-block-addbtn"
                    title="Add Widget to Group"
                    aria-label="Add Widget to Group"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onPointerEnter={() => {
                        iconHoveredRef.current = true;
                        openMenuSoon();
                    }}
                    onPointerLeave={() => {
                        iconHoveredRef.current = false;
                        scheduleMenuClose();
                    }}
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
                    <div
                        ref={refs.setFloating}
                        style={{ ...floatingStyles, zIndex: 1000 }}
                        className="inline-tab-block-addmenu"
                        role="menu"
                        onPointerEnter={() => {
                            menuHoveredRef.current = true;
                            if (menuCloseTimerRef.current != null) {
                                window.clearTimeout(menuCloseTimerRef.current);
                                menuCloseTimerRef.current = null;
                            }
                        }}
                        onPointerLeave={() => {
                            menuHoveredRef.current = false;
                            scheduleMenuClose();
                        }}
                    >
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
                                    // Terminal/Agent：悬浮 500ms 开二级（锚定本项），点击立即开二级；普通 widget 点击直接创建。
                                    onPointerEnter={(e) => {
                                        if (mode != null) {
                                            startItemHover(mode, e.currentTarget);
                                        }
                                    }}
                                    onPointerLeave={() => {
                                        if (mode != null) {
                                            clearItemHover();
                                        }
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (mode != null) {
                                            clearItemHover();
                                            requestTargetPopup(mode, e.currentTarget);
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
