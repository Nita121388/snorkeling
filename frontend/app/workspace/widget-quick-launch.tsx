// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultAgentWidgetId, DefaultTerminalWidgetId } from "@/app/workspace/agent-launch";
import { pickGroupAddableWidgets, type GroupAddableWidget } from "@/app/block/inlinetab-addmenu";
import { requestLaunchPopup } from "@/app/workspace/launch-popup-bus";
import { LayoutTreeActionType, getLayoutModelForStaticTab, newLayoutNode } from "@/layout/index";
import { ObjectService } from "@/app/store/services";
import { atoms, createBlock } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget, makeIconClass } from "@/util/util";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

// ponytail: matches widgets.tsx DefaultCreateBlockRuntimeOpts — same default term size for
// a freshly-created block before it reflows to its container.
const DefaultRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

type Placement = "new" | "group";

const WidgetQuickLaunchModal = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const workspaceId = useAtomValue(atoms.workspaceId);
    const [selected, setSelected] = useState<GroupAddableWidget | null>(null);
    const [highlightIdx, setHighlightIdx] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const widgets = useMemo(
        () => pickGroupAddableWidgets(fullConfig?.widgets ?? {}, workspaceId),
        [fullConfig, workspaceId]
    );

    const close = useCallback(() => modalsModel.popModal(), []);

    useEffect(() => {
        listRef.current?.focus();
    }, []);

    const getSinkNodeId = useCallback((): string | null => {
        const layoutModel = getLayoutModelForStaticTab();
        if (layoutModel == null) {
            return null;
        }
        const focused = globalStore.get(layoutModel.focusedNode);
        return focused?.id ?? null;
    }, []);

    const handleSelect = useCallback((w: GroupAddableWidget) => {
        setSelected(w);
    }, []);

    const handlePlacement = useCallback(
        (place: Placement) => {
            if (selected == null) {
                return;
            }
            const isTarget = selected.id === DefaultTerminalWidgetId || selected.id === DefaultAgentWidgetId;
            // Terminal / Agent: route to the existing target-selector popup (same as the right WidgetsBar),
            // carrying the placement as the group sink.
            if (isTarget) {
                const sinkNodeId = place === "group" ? getSinkNodeId() : undefined;
                // 创建一个临时锚点 div（1px，视口中部），避免 body 满幅导致 floating-ui 全 placement 越界。
                // 浮窗渲染后由 autoUpdate 锚定；清理不影响 positioning。
                const anchor = document.createElement("div");
                anchor.style.cssText = "position:fixed;top:50%;left:50%;width:1px;height:1px;z-index:-1;pointer-events:none;";
                document.body.appendChild(anchor);
                close();
                requestLaunchPopup({
                    mode: selected.id === DefaultTerminalWidgetId ? "terminal" : "agent",
                    anchorEl: anchor,
                    nodeId: sinkNodeId,
                });
                setTimeout(() => anchor.remove(), 300);
                return;
            }
            const blockDef = selected.config.blockdef;
            if (blockDef == null) {
                close();
                return;
            }
            const magnified = Boolean(selected.config.magnified);
            if (place === "group") {
                const sinkNodeId = getSinkNodeId();
                fireAndForget(async () => {
                    const newBlockId = await ObjectService.CreateBlock(blockDef, DefaultRuntimeOpts);
                    const layoutModel = getLayoutModelForStaticTab();
                    // 创建漏斗改道进组（addBlockToInlineTab 对单 Block 节点会自动升级为组）；
                    // sink 缺失或节点不存在则退回普通入 tab 插入，不丢 block。
                    if (sinkNodeId == null || layoutModel == null || !layoutModel.addBlockToInlineTab(sinkNodeId, newBlockId)) {
                        const insertNodeAction = {
                            type: LayoutTreeActionType.InsertNode,
                            node: newLayoutNode(undefined, undefined, undefined, { blockId: newBlockId }),
                            magnified,
                            focused: true,
                        };
                        layoutModel?.treeReducer(insertNodeAction);
                    }
                });
            } else {
                fireAndForget(async () => createBlock(blockDef, magnified));
            }
            close();
        },
        [selected, getSinkNodeId, close]
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (widgets.length === 0) {
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlightIdx((i) => (i + 1) % widgets.length);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlightIdx((i) => (i - 1 + widgets.length) % widgets.length);
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (selected == null) {
                    const w = widgets[highlightIdx];
                    if (w != null) {
                        setSelected(w);
                    }
                }
            }
        },
        [widgets, highlightIdx, selected]
    );

    return (
        <Modal className="widget-quick-launch w-[420px] max-w-[92vw]" onClickBackdrop={close} onClose={close}>
            <div className="wql-header px-4 pt-3 pb-1">
                <div className="text-sm font-medium text-foreground flex items-center gap-2">
                    <i className="fa-sharp fa-regular fa-bolt text-accent" />
                    Quick Launch Widgets
                </div>
                <div className="text-xxs text-muted mt-0.5">支持的 widget · 无过滤</div>
            </div>
            <div
                ref={listRef}
                tabIndex={0}
                className="wql-list px-2 py-1 max-h-80 overflow-y-auto outline-none"
                onKeyDown={onKeyDown}
            >
                {widgets.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-muted text-center">No widgets available</div>
                ) : (
                    widgets.map((w, idx) => {
                        const isTarget = w.id === DefaultTerminalWidgetId || w.id === DefaultAgentWidgetId;
                        const isSelected = selected?.id === w.id;
                        const isHighlight = selected == null && idx === highlightIdx;
                        return (
                            <div
                                key={w.id}
                                className={clsx(
                                    "flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors",
                                    isSelected ? "bg-accent/12 text-foreground" : "hover:bg-hoverbg text-secondary",
                                    isHighlight && !isSelected && "bg-surface-soft"
                                )}
                                onMouseEnter={() => setHighlightIdx(idx)}
                                onClick={() => handleSelect(w)}
                            >
                                <i
                                    className={makeIconClass(w.config.icon, false, { defaultIcon: "browser" })}
                                    style={{ color: w.config.color }}
                                />
                                <span className="text-xs whitespace-nowrap">{w.config.label}</span>
                                {isTarget && <span className="ml-auto pl-3 text-xxs text-muted whitespace-nowrap">→ 目标选择</span>}
                            </div>
                        );
                    })
                )}
            </div>
            {selected != null && (
                <div className="wql-footer border-t border-border px-3 py-2 flex items-center gap-3">
                    <span className="text-xxs text-muted mr-1">放置「{selected.config.label}」到</span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-medium h-[24px] px-2 rounded-md bg-transparent text-secondary hover:bg-surface-soft hover:text-foreground active:scale-[0.97] transition-all cursor-pointer border-none p-0"
                            onClick={() => handlePlacement("new")}
                        >
                            <i className="fa-sharp fa-solid fa-square-plus text-[9px]" />
                            New Block
                        </button>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-medium h-[24px] px-2 rounded-md bg-transparent text-accent hover:bg-accent/12 hover:text-accenthover active:scale-[0.97] transition-all cursor-pointer border-none p-0"
                            onClick={() => handlePlacement("group")}
                        >
                            <i className="fa-sharp fa-solid fa-table-columns text-[9px]" />
                            Current Group
                        </button>
                    </div>
                    <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1 text-xs font-medium h-[24px] px-2 rounded-md bg-transparent text-muted hover:bg-surface-soft hover:text-foreground active:scale-[0.97] transition-all cursor-pointer border-none p-0"
                        onClick={() => setSelected(null)}
                    >
                        <i className="fa-sharp fa-solid fa-arrow-rotate-left text-[10px]" />
                        重选
                    </button>
                </div>
            )}
        </Modal>
    );
});

WidgetQuickLaunchModal.displayName = "WidgetQuickLaunchModal";

export { WidgetQuickLaunchModal };

export function openWidgetQuickLaunch(): void {
    modalsModel.pushModal(WidgetQuickLaunchModal.displayName);
}
