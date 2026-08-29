// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Minimal typed bridge so the Blocks-group "+" menu (block layer) can ask the always-mounted
// WorkspaceWidgets (workspace layer) to open the SAME New Terminal / New Agent target-selector
// floating windows it uses for its own widget buttons — with a per-request "sink" that redirects
// the in-tab launch (footer "Current Tab" button) into the requesting inline-tab group instead.
//
// ponytail: module-level listener set on purpose (single Electron window, exactly one
// WorkspaceWidgets subscriber). If multi-window support ever lands, move this into a
// window-scoped store.

export type LaunchPopupMode = "terminal" | "agent";

// 二级浮窗锚点：可以是一个真实的 HTMLElement（右侧 WidgetsBar 按钮/Quick Launch 的 1px 固定 div），
// 也可以是一个“冻结快照”虚拟锚点（getBoundingClientRect 返回打开瞬间捕获的 rect）。
// Blocks 组「＋」菜单把活菜单项冻结成快照再传入——避免浮窗锚定到溢出容器里的活元素，
// 在鼠标移入弹窗时被 floating-ui autoUpdate（layoutShift/elementResize）重算而瞬移。
export type LaunchPopupAnchor = HTMLElement | { getBoundingClientRect: () => DOMRect; contextElement?: Element };

export type LaunchPopupRequest = {
    mode: LaunchPopupMode;
    /**
     * Layout nodeId of the inline-tab group that requested the popup. While set, the floating
     * window's in-tab creation funnels into this group via layoutModel.addBlockToInlineTab.
     * Omit (undefined) for a plain "New Block" placement into the current tab.
     */
    nodeId?: string;
    /**
     * Anchor for the second-level floating window. May be a live HTMLElement (right WidgetsBar
     * button / Quick Launch's 1px center div) or a frozen-rect snapshot (Blocks-group "+" menu,
     * built by makeFrozenAnchor). Floating windows clamp to the viewport via autoUpdate.
     */
    anchorEl: LaunchPopupAnchor;
    /**
     * Optional open-state callback so the requesting component (e.g. the Blocks-group "+" menu)
     * can coordinate its own first-level popup with this second-level target-selector: it stays
     * open while the second-level is hovered, and closes once the second-level reports it closed.
     * Invoked with `true` on open and `false` on close by the WorkspaceWidgets subscriber.
     */
    onOpenChange?: (open: boolean) => void;
    /**
     * Center the second-level popup on the viewport (the requesting entry point has no stable
     * anchor to hover, e.g. the Quick Launch modal). The anchor is expected to be a 1px div at
     * the viewport center; the floating window applies translate(-50%, -50%) to truly center.
     */
    centered?: boolean;
};


type Listener = (req: LaunchPopupRequest) => void;

const listeners = new Set<Listener>();

export function requestLaunchPopup(req: LaunchPopupRequest): void {
    listeners.forEach((listener) => listener(req));
}

export function subscribeLaunchPopup(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
