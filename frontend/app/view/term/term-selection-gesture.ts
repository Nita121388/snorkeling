// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const TermSelectionDragThreshold = 4;

export function shouldRoutePlainTermGesture(
    platform: NodeJS.Platform,
    mouseTrackingMode: string,
    button: number,
    altKey: boolean,
    ctrlKey: boolean,
    metaKey: boolean,
    shiftKey: boolean
): boolean {
    return (
        platform === "darwin" &&
        mouseTrackingMode !== "none" &&
        button === 0 &&
        !altKey &&
        !ctrlKey &&
        !metaKey &&
        !shiftKey
    );
}

export function isTermSelectionDrag(startX: number, startY: number, currentX: number, currentY: number): boolean {
    return Math.hypot(currentX - startX, currentY - startY) >= TermSelectionDragThreshold;
}

export function shouldSuppressTermMouseMove(hasSelection: boolean, buttons: number): boolean {
    return hasSelection && buttons === 0;
}
