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

import "./widget-quick-launch.scss";

// ponytail: matches widgets.tsx DefaultCreateBlockRuntimeOpts — same default term size for
// a freshly-created block before it reflows to its container.
const DefaultRuntimeOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };

type Placement = "new" | "group";

// bloom-menu 风格网格列数：数量少时更稀疏，避免格子被挤扁。
function gridCols(count: number): number {
    if (count <= 4) return 2;
    if (count <= 9) return 3;
    return 4;
}

const WidgetQuickLaunchModal = memo(() => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const workspaceId = useAtomValue(atoms.workspaceId);
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

    const launch = useCallback(
        (w: GroupAddableWidget, place: Placement) => {
            const isTarget = w.id === DefaultTerminalWidgetId || w.id === DefaultAgentWidgetId;
            // Terminal / Agent: route to the existing target-selector popup (same as the right WidgetsBar),
            // carrying the placement as the group sink.
            if (isTarget) {
                const sinkNodeId = place === "group" ? getSinkNodeId() : undefined;
                // 冻结的视口正中锚点（取代之前的 1px 临时 div + 300ms 后移除）：
                // 旧方案在弹窗仍开着时移除锚点 DOM，floating-ui autoUpdate 重算 → 弹窗瞬移。冻结 rect 一劳永逸。
                const rect = new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 1, 1);
                close();
                requestLaunchPopup({
                    mode: w.id === DefaultTerminalWidgetId ? "terminal" : "agent",
                    anchorEl: { getBoundingClientRect: () => rect },
                    nodeId: sinkNodeId,
                    centered: true,
                });
                return;
            }
            const blockDef = w.config.blockdef;
            if (blockDef == null) {
                close();
                return;
            }
            const magnified = Boolean(w.config.magnified);
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
        [getSinkNodeId, close]
    );

    const cols = gridCols(widgets.length);
    const rows = Math.ceil(widgets.length / cols);

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (widgets.length === 0) {
                return;
            }

            let nextIdx = highlightIdx;

            if (e.key === "ArrowRight") {
                e.preventDefault();
                nextIdx = (highlightIdx + 1) % widgets.length;
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                nextIdx = (highlightIdx - 1 + widgets.length) % widgets.length;
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                nextIdx = Math.min(highlightIdx + cols, widgets.length - 1);
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                nextIdx = Math.max(highlightIdx - cols, 0);
            } else if (e.key === "Enter") {
                e.preventDefault();
                const w = widgets[highlightIdx];
                if (w != null) {
                    launch(w, "new");
                }
            } else if (e.key === "Tab") {
                e.preventDefault();
                const w = widgets[highlightIdx];
                if (w != null) {
                    launch(w, "group");
                }
            }

            setHighlightIdx(nextIdx);
        },
        [widgets, highlightIdx, cols, launch]
    );

    return (
        <Modal className="widget-quick-launch w-[min(92vw,460px)]" onClickBackdrop={close} onClose={close}>
            {/* header：仅左侧标题；关闭走 Modal 基类右上角的 X（Bloom 同款），不再自放 esc 键帽撞车 */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <i className="fa-sharp fa-regular fa-bolt text-accent text-sm" />
                <span className="text-sm font-medium text-muted">Quick Launch</span>
            </div>

            {/* bloom-menu 风格网格：发丝线边框、图标在上标签在下、cell 悬浮仅换色 */}
            <div
                ref={listRef}
                tabIndex={0}
                className="max-h-[min(52vh,440px)] overflow-y-auto outline-none"
                onKeyDown={onKeyDown}
            >
                {widgets.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-muted">No widgets available</div>
                ) : (
                    <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                        {widgets.map((w, i) => {
                            const isTarget = w.id === DefaultTerminalWidgetId || w.id === DefaultAgentWidgetId;
                            const isHighlight = i === highlightIdx;
                            return (
                                <div
                                    key={w.id}
                                    className={clsx(
                                        "group relative flex cursor-pointer flex-col items-center justify-center gap-2 px-3 pb-6 pt-4 text-secondary transition-colors hover:text-foreground",
                                        i % cols !== cols - 1 && "border-r border-border/60",
                                        Math.floor(i / cols) < rows - 1 && "border-b border-border/60",
                                        isHighlight && "bg-accent/10 text-foreground"
                                    )}
                                    onMouseEnter={() => setHighlightIdx(i)}
                                    onClick={() => launch(w, "new")}
                                >
                                    <i
                                        className={clsx(
                                            makeIconClass(w.config.icon, false, { defaultIcon: "browser" }),
                                            "text-lg"
                                        )}
                                        style={{ color: w.config.color }}
                                    />
                                    <span className="text-xs font-medium">{w.config.label}</span>
                                    {/* terminal/agent 走二级目标选择器的角标 */}
                                    {isTarget && (
                                        <i className="fa-sharp fa-regular fa-chevron-right absolute right-2 top-2 text-[9px] text-muted/70" />
                                    )}
                                    {/* 悬浮才露出的放置选项：block = 点击默认，group = 进组（底部留位，不挤压布局） */}
                                    <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                                        <button
                                            type="button"
                                            className="pointer-events-auto cursor-pointer rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-accent hover:text-accent"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                launch(w, "new");
                                            }}
                                        >
                                            block
                                        </button>
                                        <button
                                            type="button"
                                            className="pointer-events-auto cursor-pointer rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-accent hover:text-accent"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                launch(w, "group");
                                            }}
                                        >
                                            group
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* footer：键位提示统一收这里（esc 挪下来，与右上角 X 彻底解联） */}
            <div className="flex items-center justify-center gap-4 border-t border-border px-4 py-2 text-[10px] text-muted">
                <span>
                    <kbd className="rounded border border-border bg-surface-soft px-1">←↑→↓</kbd> select
                </span>
                <span>
                    <kbd className="rounded border border-border bg-surface-soft px-1">↵</kbd> new block
                </span>
                <span>
                    <kbd className="rounded border border-border bg-surface-soft px-1">⇥</kbd> into group
                </span>
                <span>
                    <kbd className="rounded border border-border bg-surface-soft px-1">esc</kbd> close
                </span>
            </div>
        </Modal>
    );
});

WidgetQuickLaunchModal.displayName = "WidgetQuickLaunchModal";

export { WidgetQuickLaunchModal };

export function openWidgetQuickLaunch(): void {
    modalsModel.pushModal(WidgetQuickLaunchModal.displayName);
}
