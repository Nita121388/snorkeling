// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatAgentProvider } from "@/app/agent-status/agent-status-derive";
import { normalizeAgentProvider } from "@/app/view/term/agent-meta";

export type AgentProviderKey = string;

const VENDOR_NAME_KEYS: Record<string, string> = {
    claude: "agent:claudevendorname",
    codex: "agent:codexvendorname",
    opencode: "agent:opencodevendorname",
    pi: "agent:pivendorname",
};

const ALL_VENDOR_NAME_KEYS = Object.values(VENDOR_NAME_KEYS);

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string {
    const val = meta?.[key];
    return typeof val === "string" ? val.trim() : "";
}

export function resolveAgentVendorName(meta: Record<string, unknown> | null | undefined, providerKey: string): string {
    const key = VENDOR_NAME_KEYS[providerKey];
    if (!key) {
        return "";
    }
    return readMetaString(meta, key);
}

/**
 * Provider-agnostic vendor name fallback. The provider meta (agent:provider)
 * is cleared when an agent process exits, but the per-provider
 * agent:*vendorname meta is NOT cleared, so the cc-switch vendor can still be
 * shown for a finished session where provider is no longer known.
 */
export function resolveAnyAgentVendorName(meta: Record<string, unknown> | null | undefined): string {
    for (const key of ALL_VENDOR_NAME_KEYS) {
        const name = readMetaString(meta, key);
        if (name !== "") {
            return name;
        }
    }
    return "";
}

export function resolveAgentProviderLabel(
    meta: Record<string, unknown> | null | undefined,
    agentStatus: { provider?: string | null } | null | undefined
): string {
    const statusProvider = typeof agentStatus?.provider === "string" ? agentStatus.provider.trim() : "";
    if (statusProvider !== "") {
        return formatAgentProvider(statusProvider);
    }
    const metaProvider = normalizeAgentProvider(meta?.["agent:provider"]);
    if (metaProvider !== "") {
        return formatAgentProvider(metaProvider);
    }
    return "Agent";
}

export function resolveAgentModel(args: {
    liveModel?: string | null;
    requestedModel?: string | null;
    sessionModel?: string | null;
}): string {
    const liveModel = typeof args.liveModel === "string" ? args.liveModel.trim() : "";
    if (liveModel !== "") {
        return liveModel;
    }
    const requestedModel = typeof args.requestedModel === "string" ? args.requestedModel.trim() : "";
    if (requestedModel !== "") {
        return requestedModel;
    }
    const sessionModel = typeof args.sessionModel === "string" ? args.sessionModel.trim() : "";
    if (sessionModel !== "") {
        return sessionModel;
    }
    return "";
}

export function getAgentProviderKey(rawProvider: string): string {
    const p = normalizeAgentProvider(rawProvider);
    return p === "" ? "agent" : p;
}

const AGENT_TYPE_PROVIDERS = new Set(["agent", "pi", "codex", "opencode", "claude", "anthropic", "gemini"]);

export type AgentModelIdentity = {
    provider: string;
    model: string;
    /** Canonical input string, preserved verbatim for tooltip / copy. */
    raw: string;
};

/**
 * The single provider/model splitter. Splits on the FIRST slash only
 * (`mydeepseek/deepseek-v4.1-flash` -> provider `mydeepseek`, model
 * `deepseek-v4.1-flash`); a bare model id keeps the model and only adopts the
 * session provider when that provider is not an agent-type word.
 */
export function resolveAgentModelIdentity(
    rawModel: string | null | undefined,
    sessionProvider?: string | null
): AgentModelIdentity {
    const raw = typeof rawModel === "string" ? rawModel.trim() : "";
    if (raw === "") {
        return { provider: "", model: "", raw: "" };
    }
    const slash = raw.indexOf("/");
    if (slash > 0) {
        const provider = raw.slice(0, slash).trim();
        const model = raw.slice(slash + 1).trim();
        if (provider !== "" && model !== "") {
            return { provider, model, raw };
        }
    }
    const candidate = typeof sessionProvider === "string" ? sessionProvider.trim() : "";
    const provider = candidate !== "" && !AGENT_TYPE_PROVIDERS.has(candidate.toLowerCase()) ? candidate : "";
    return { provider, model: raw, raw };
}

/**
 * Renders the model text, dropping the provider prefix when it is already the
 * displayed provider (case-insensitive), otherwise keeping `provider · model`.
 */
export function formatAgentModel(identity: AgentModelIdentity, displayProvider?: string | null): string {
    if (identity.model === "") {
        return "";
    }
    const provider = identity.provider.trim();
    if (provider === "") {
        return identity.model;
    }
    const display = typeof displayProvider === "string" ? displayProvider.trim().toLowerCase() : "";
    if (display !== "" && display === provider.toLowerCase()) {
        return identity.model;
    }
    return `${provider} · ${identity.model}`;
}
