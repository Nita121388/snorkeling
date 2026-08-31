// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Updater classification helpers, kept Electron-free so they can load under
// `node --test` without the full main-process graph. `emain/updater.ts`
// re-exports these.

export type MaybeError = unknown;

/** True when `err` is almost certainly a connectivity failure, not a real updater bug. */
export function isOfflineError(err: MaybeError): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return (
        message.includes("net::ERR_INTERNET_DISCONNECTED") ||
        message.includes("net::ERR_NETWORK_CHANGED") ||
        message.includes("net::ERR_NAME_NOT_RESOLVED") ||
        message.includes("net::ERR_CONNECTION") ||
        message.includes("net::ERR_TIMED_OUT") ||
        message.includes("ENOTFOUND") ||
        message.includes("ETIMEDOUT") ||
        message.includes("ECONNRESET") ||
        message.includes("getaddrinfo") ||
        message.includes("ENETUNREACH")
    );
}
