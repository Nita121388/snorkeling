// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { resolveAgentSessionId } from "./agent-session";

function normalizeAgentProvider(provider: unknown): string {
    return typeof provider === "string" && provider.trim() !== "" ? provider.trim() : "agent";
}

function isAgentTerminalMeta(meta: MetaType | null | undefined): boolean {
    if (meta == null) return false;
    return resolveAgentSessionId(meta).isAgent;
}

export { isAgentTerminalMeta, normalizeAgentProvider };
