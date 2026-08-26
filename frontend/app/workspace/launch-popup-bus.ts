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

export type LaunchPopupRequest = {
    mode: LaunchPopupMode;
    /**
     * Live anchor element (the "+" button of the group). Passed as a real HTMLElement so the
     * floating windows' autoUpdate keeps the popup clamped to the viewport when tab content
     * scrolls or the window resizes — a static rect snapshot would go stale.
     */
    anchorEl: HTMLElement;
    /**
     * Layout nodeId of the inline-tab group that requested the popup. While set, the floating
     * window's in-tab creation funnels into this group via layoutModel.addBlockToInlineTab.
     */
    nodeId: string;
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
