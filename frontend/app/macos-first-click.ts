// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type MacOSFirstMouseTargetKind = "default" | "quick-action" | "selection-surface";

export function shouldPassThroughMacOSFirstMouse(
    targetKind: MacOSFirstMouseTargetKind,
    button: number,
    metaKey: boolean,
    ctrlKey: boolean
): boolean {
    return targetKind !== "default" && button === 0 && !metaKey && !ctrlKey;
}

export function classifyMacOSFirstMouseTarget(
    target: EventTarget | null,
    _macOptionPressed = false
): MacOSFirstMouseTargetKind {
    const element = target as HTMLElement;
    if (typeof element?.closest !== "function") {
        return "default";
    }
    if (element.closest("[data-selection-quick-action]") != null) {
        return "quick-action";
    }
    if (element.closest(".term-connectelem") != null) {
        return "selection-surface";
    }
    return "default";
}
