// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Frontend loader for the agent catalog (agent profiles + their models), sourced from the
// wshserver RPC `agentprofilelist`. The backend catalog merges the built-in agent profiles
// with the user's `agent:profiles` settings, so the scheduled-task editor and any future
// agent-block creation share one source of truth.
//
// Module-level cache (same pattern as ccswitch-vendors.ts): dedupes concurrent in-flight
// loads and refreshes at most once per CACHE_TTL_MS. RPC failures resolve to an empty list
// so the editor can fall back to free-text input instead of becoming unusable.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export interface AgentModelInfo {
    id: string;
    label: string;
    provider?: string;
    default?: boolean;
    source?: string;
}

export interface AgentProfileInfo {
    name: string;
    label: string;
    cmd: string;
    args?: string[];
    modelflag?: string;
    defaultModel?: string;
    models: AgentModelInfo[];
    source?: string;
}

const CACHE_TTL_MS = 60 * 1000;

let cached: { promise: Promise<AgentProfileInfo[]>; fetchedAt: number } | undefined;

/** Load the agent catalog. Cached within CACHE_TTL_MS unless force=true. */
export function loadAgentCatalog(force: boolean = false): Promise<AgentProfileInfo[]> {
    const now = Date.now();
    if (cached != null && !force && now - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.promise;
    }
    const promise = (async (): Promise<AgentProfileInfo[]> => {
        try {
            const rtn = await RpcApi.AgentProfileListCommand(TabRpcClient);
            const profiles = Array.isArray(rtn) ? rtn : [];
            return profiles.map((p) => ({
                ...p,
                models: Array.isArray(p.models) ? p.models : [],
            }));
        } catch (err) {
            console.warn("[agentcatalog] loadAgentCatalog failed:", err);
            return [];
        }
    })();
    cached = { promise, fetchedAt: now };
    return promise;
}

/** Drop the cache so the next load re-reads the config. */
export function invalidateAgentCatalog(): void {
    cached = undefined;
}

export function findAgentProfile(profiles: AgentProfileInfo[], name: string | undefined): AgentProfileInfo | null {
    if (profiles == null || name == null || name === "") {
        return null;
    }
    return profiles.find((p) => p.name === name) ?? null;
}

/** The model a new task should start with for this profile. */
export function pickDefaultModel(profile: AgentProfileInfo | null): string {
    if (profile == null) {
        return "";
    }
    if (profile.defaultModel != null && profile.defaultModel !== "") {
        return profile.defaultModel;
    }
    if (profile.models.length > 0) {
        return profile.models[0].id;
    }
    return "";
}

/**
 * Model options for a profile, guaranteeing the current value stays selectable so an
 * existing task with a hand-typed (or removed) model is never silently dropped.
 */
export function modelOptionsFor(
    profile: AgentProfileInfo | null,
    currentModel: string | undefined
): AgentModelInfo[] {
    if (profile == null) {
        return [];
    }
    const options = [...profile.models];
    const current = currentModel?.trim();
    if (current != null && current !== "" && !options.some((m) => m.id === current)) {
        options.push({ id: current, label: current, source: "task" });
    }
    return options;
}
