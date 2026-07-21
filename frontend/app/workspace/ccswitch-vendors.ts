// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Frontend cache + loader for cc-switch's Claude Code / Codex vendors (read-only via the wshserver RPC).
//
// We use a module-level cache rather than a jotai atom because the only consumer today is
// the New-Agent floating window in widgets.tsx, and widgets.tsx already works with useState +
// useEffect for its other state (agentCommandPaths, agentProfileOptions, ...). The cache:
//   - dedupes concurrent in-flight loads (single shared Promise per app type)
//   - refreshes at most once per minute (TTL)
//   - returns a soft "not detected" payload (empty vendors + detected=false) when cc-switch
//     is not installed, so the UI hides the vendor selector gracefully

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export type CcSwitchAppType = "claude" | "codex";

export interface CcSwitchVendor {
    id: string;
    name: string;
    env: Record<string, string>;
    is_current: boolean;
    provider_type: string;
    category: string;
    /**
     * Absolute path to the per-vendor CLAUDE_CONFIG_DIR we materialize on the wshserver side (reader.go).
     * When set, agent-launch.ts adds `CLAUDE_CONFIG_DIR=<this>` to the block's cmd:env so the spawned
     * claude reads *this* vendor's settings.json instead of the user's global ~/.claude/settings.json —
     * which is required for the per-block vendor pick to actually win (see ccswitch.Vendor doc comment).
     */
    claude_config_dir: string;
    /**
     * Absolute path to a per-vendor CODEX_HOME we materialize on the wshserver side (reader.go).
     * When set, agent-launch.ts adds `CODEX_HOME=<this>` to the block's cmd:env so the spawned codex
     * reads *this* vendor's auth.json + config.toml instead of the user's global ~/.codex/. Absent
     * when the vendor is codex-official / has no auth+config content — in that case the block inherits
     * ~/.codex/ (official OAuth login path).
     */
    codex_config_dir?: string;
}

export interface CcSwitchVendorList {
    vendors: CcSwitchVendor[];
    dbpath: string;
    detected: boolean;
}

const CACHE_TTL_MS = 60 * 1000;
// Cache key per app type — kept inline here (no module-level const) so adding a third app_type later
// is a one-liner. Existing callers see "ccswitch:claude-vendors" (preserved verbatim from the original
// module-level CACHE_KEY constant, so any external references to that key still match).
function cacheKeyFor(appType: CcSwitchAppType): string {
    return `ccswitch:${appType}-vendors`;
}

interface CachedEntry {
    promise: Promise<CcSwitchVendorList>;
    /** ms timestamp when this cache entry was populated (cachedDate.getTime() on the resolved value). */
    fetchedAt: number;
}

// Module-level cache. Survives across New-Agent window open/close within a session; keyed by app type.
// (Both app_types share the same single cc-switch DB per machine — the keying here is just so the two
// loaders don't clobber each others' Promise.)
const cache: Record<string, CachedEntry | undefined> = {};

function isFresh(entry: CachedEntry, now: number): boolean {
    return now - entry.fetchedAt < CACHE_TTL_MS;
}

/**
 * Load a cc-switch vendor list from the wshserver (which reads ~/.cc-switch/cc-switch.db per appType).
 * Cached: subsequent calls within CACHE_TTL_MS share the same Promise. Pass force=true to bypass the
 * cache (used by the refresh button).
 */
export function loadCcSwitchVendors(appType: CcSwitchAppType, force: boolean = false): Promise<CcSwitchVendorList> {
    const cacheKey = cacheKeyFor(appType);
    const now = Date.now();
    const existing = cache[cacheKey];
    if (existing != null && !force && isFresh(existing, now)) {
        return existing.promise;
    }
    const promise = (async (): Promise<CcSwitchVendorList> => {
        try {
            const rtn =
                appType === "codex"
                    ? await RpcApi.CcSwitchListCodexVendorsCommand(TabRpcClient)
                    : await RpcApi.CcSwitchListClaudeVendorsCommand(TabRpcClient);
            // Normalize: cc-switch absent → empty vendors + detected=false; ensure arrays exist.
            if (rtn == null) {
                return { vendors: [], dbpath: "", detected: false };
            }
            const vendors = Array.isArray(rtn.vendors) ? rtn.vendors : [];
            return {
                vendors,
                dbpath: typeof rtn.dbpath === "string" ? rtn.dbpath : "",
                detected: Boolean(rtn.detected),
            };
        } catch (err) {
            // RPC failure should never break agent launch — return soft-empty
            console.warn(`[ccswitch] loadCcSwitchVendors(${appType}) failed:`, err);
            return { vendors: [], dbpath: "", detected: false };
        }
    })();
    cache[cacheKey] = { promise, fetchedAt: now };
    return promise;
}

/**
 * Look up a single vendor by id from a snapshot of the cache *if it's already loaded*.
 * Returns undefined if not loaded yet or no match. Callers that need a guaranteed-fresh value
 * should call loadCcSwitchVendors() first and search the resolved array themselves.
 */
export function findVendorById(vendors: CcSwitchVendor[] | undefined, vendorId: string | undefined): CcSwitchVendor | undefined {
    if (vendors == null || isBlank(vendorId)) {
        return undefined;
    }
    return vendors.find((v) => v.id === vendorId);
}

function isBlank(s: string | undefined | null): boolean {
    return s == null || s.trim() === "";
}
