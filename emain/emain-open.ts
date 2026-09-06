// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Handles OS-level "open with Snorkeling" requests. The OS hands us file/dir
// paths via command line args (Windows/Linux) or the open-file event (macOS).
// We forward them to the focused wave window's active tab so the frontend can
// open them as preview blocks.

import * as electron from "electron";
import fs from "fs";
import path from "path";
import { log } from "./emain-log";
import { focusedWaveWindow, getAllWaveWindows } from "./emain-window";

// Electron/runtime noise that we should never treat as a user-provided path.
const IgnoredArgPatterns: RegExp[] = [
    /^--/,
    /^-[a-zA-Z0-9]$/,
    /^--remote-debugging-port=/,
    /^--inspect/,
    /^--enable-features/,
    /^--ozone-platform-hint/,
    /^--disable/,
];

// Strip quotes and normalize to an absolute path. Returns null if the arg is
// not a plausible filesystem path.
export function normalizeExternalOpenArg(rawArg: string): string | null {
    if (rawArg == null) {
        return null;
    }
    let arg = rawArg.trim();
    if (arg.length === 0) {
        return null;
    }
    for (const pattern of IgnoredArgPatterns) {
        if (pattern.test(arg)) {
            return null;
        }
    }
    // Strip surrounding quotes that some shells/file managers add.
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
        arg = arg.slice(1, -1);
    }
    if (arg.length === 0 || arg.startsWith("-")) {
        return null;
    }
    if (!path.isAbsolute(arg)) {
        arg = path.resolve(arg);
    }
    return arg;
}

// Filter the raw process argv to the set of paths the OS asked us to open.
export function extractOpenPathsFromArgv(argv: string[]): string[] {
    if (argv == null || argv.length === 0) {
        return [];
    }
    const paths: string[] = [];
    for (const arg of argv) {
        const normalized = normalizeExternalOpenArg(arg);
        if (normalized == null) {
            continue;
        }
        if (!fs.existsSync(normalized)) {
            continue;
        }
        paths.push(normalized);
    }
    return paths;
}

// Requests may arrive before the first window/active tab exists (e.g. macOS
// open-file events fire during early startup). Buffer them until we can send.
let pendingPaths: string[] = [];
let sendScheduled = false;

function scheduleSend() {
    if (sendScheduled) {
        return;
    }
    sendScheduled = true;
    setTimeout(() => {
        sendScheduled = false;
        if (pendingPaths.length === 0) {
            return;
        }
        const win = focusedWaveWindow ?? getAllWaveWindows()[0];
        if (win == null || win.isDestroyed()) {
            log("external-open: no window available, paths buffered", pendingPaths.length);
            return;
        }
        const activeTab = win.activeTabView;
        if (activeTab == null || activeTab.webContents == null || activeTab.webContents.isDestroyed()) {
            log("external-open: active tab not ready, paths buffered", pendingPaths.length);
            return;
        }
        const toSend = pendingPaths.splice(0, pendingPaths.length);
        activeTab.webContents.send("external-open-paths", toSend);
    }, 0);
}

// Forward paths to the focused window's active tab. If no focused window is
// available, falls back to the first wave window.
export function sendExternalOpenPathsToFocusedWindow(paths: string[]): void {
    if (paths == null || paths.length === 0) {
        return;
    }
    pendingPaths.push(...paths);
    scheduleSend();
}

// Entry point for app startup: called once windows are relaunched. We use the
// original argv captured at boot (electronApp emits no reliable "boot argv"
// after startup, so we pass it in).
export function openExternalPathsAtStartup(argv: string[]): void {
    const paths = extractOpenPathsFromArgv(argv);
    if (paths.length === 0) {
        return;
    }
    sendExternalOpenPathsToFocusedWindow(paths);
}

// Deliver any paths that arrived before a window was ready (e.g. macOS open-file
// during early startup). Call after the first window's active tab is wired up.
export function flushPendingExternalOpenPaths(): void {
    scheduleSend();
}
