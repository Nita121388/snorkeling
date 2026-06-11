// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const WindowsDrivesPath = "/__wave_windows_drives__";
export const WindowsDrivesDisplayName = "This PC";

export function isWindowsDrivesPath(path: string | null | undefined): boolean {
    return path === WindowsDrivesPath;
}

export function getPreviewDisplayPath(path: string | null | undefined): string {
    return isWindowsDrivesPath(path) ? WindowsDrivesDisplayName : (path ?? "");
}
