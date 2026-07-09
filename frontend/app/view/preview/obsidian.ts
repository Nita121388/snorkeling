// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";

/**
 * Obsidian integration helpers.
 *
 * Flow:
 *   1. loadObsidianVaults() asks the main process to read Obsidian's local obsidian.json and
 *      return its registered vault roots (string[]). The frontend never touches fs directly.
 *   2. findVault(absPath, vaults) does prefix matching (case-insensitive on win32/darwin, where
 *      the OS treats path roots as case-insensitive) and returns the longest matching vault root
 *      + the file's relative path inside it.
 *   3. buildObsidianUri() turns that into `obsidian://open?vault=...&file=...`.
 *   4. openInObsidian() either opens the URI right away (returns "obsidian") or, if the file
 *      isn't in any known vault (returns "fallback_to_picker"), the caller prompts the user to
 *      pick the vault directory — see openInObsidianWithPicker / addUserVaultAndOpen().
 *
 * Why not a settings.json config: per the project decision, vault paths come from Obsidian's
 * own bookkeeping automatically; the only fallback is an inline pick at click time, persisted
 * to localStorage only (not to settings.json, not to schema). See
 *   ~ memory: obsidian-integration-via-uri-scheme
 */

const CacheKey = "snorkeling.obsidian.userVaults";

type VaultMatch = {
    vaultRoot: string;
    vaultName: string;
    fileRelPath: string;
};

let cachedAutoVaults: string[] | null = null;

function toPosixPath(p: string): string {
    if (p == null) return "";
    return p.replace(/\\/g, "/");
}

function normalizeDir(p: string): string {
    let s = toPosixPath(p).trim();
    if (s === "") return "";
    s = s.replace(/\/+$/g, "");
    return s;
}

function platformIsCaseInsensitive(): boolean {
    const platform = getApi().getPlatform();
    return platform === "win32" || platform === "darwin";
}

function comparePath(a: string, b: string): boolean {
    if (a === b) return true;
    if (platformIsCaseInsensitive()) return a.toLowerCase() === b.toLowerCase();
    return false;
}

/**
 * Returns the length of `ancestor` if `descendant` starts with `ancestor/`, else -1.
 * The trailing slash is required so /foo/bar doesn't match /foo/ba.
 */
function isAncestorPosix(ancestor: string, descendant: string): number {
    if (ancestor === "") return -1;
    if (comparePath(ancestor, descendant)) return -1; // file IS the vault root, not inside it
    if (descendant.length <= ancestor.length) return -1;
    const sep = descendant.charAt(ancestor.length);
    if (sep !== "/") return -1;
    if (comparePath(descendant.slice(0, ancestor.length), ancestor)) {
        return ancestor.length;
    }
    return -1;
}

function basenameOfPosix(p: string): string {
    if (p == null || p === "") return "";
    const parts = p.split("/").filter((s) => s.length > 0);
    return parts[parts.length - 1] ?? "";
}

/**
 * Get the user-added vault list from localStorage (vaults the user manually pointed us to).
 */
export function getUserVaults(): string[] {
    try {
        const raw = window.localStorage?.getItem(CacheKey);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter((s) => typeof s === "string" && s.trim() !== "");
    } catch {
        return [];
    }
}

function saveUserVaults(vaults: string[]): void {
    try {
        window.localStorage?.setItem(CacheKey, JSON.stringify(vaults));
    } catch {
        // ignore — best-effort persistence
    }
}

function dedupeVaults(vaults: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of vaults) {
        const norm = normalizeDir(v);
        if (norm === "") continue;
        const key = norm.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(norm);
    }
    return out;
}

/**
 * Refresh the in-memory cache: re-query the main process for vaults, merge with user-added vaults.
 * Safe to call repeatedly; fails silently (returns empty list).
 */
export async function loadObsidianVaults(): Promise<string[]> {
    let autoVaults: string[] = [];
    try {
        autoVaults = await getApi().obsidianReadVaults();
        if (!Array.isArray(autoVaults)) autoVaults = [];
    } catch (e) {
        console.error("obsidianReadVaults failed", e);
        autoVaults = [];
    }
    cachedAutoVaults = autoVaults;
    return dedupeVaults([...autoVaults, ...getUserVaults()]);
}

/**
 * Synchronously return the known vault list (from the in-memory cache merged with user vaults).
 *
 * Frontend callers should trigger loadObsidianVaults() from a top-level effect, then read
 * getKnownVaults() in render — falling back to userVaults (from localStorage) when the async
 * load hasn't completed yet on cold render.
 */
export function getKnownVaults(): string[] {
    const userVaults = getUserVaults();
    if (cachedAutoVaults != null) {
        return dedupeVaults([...cachedAutoVaults, ...userVaults]);
    }
    return dedupeVaults(userVaults);
}

/**
 * Find which vault contains the given file, returning the vault root and the file's
 * relative path inside it. Picks the longest-prefix match (most specific vault wins).
 *
 * Case-insensitive on Windows/macOS. The returned vaultName preserves original casing
 * (Obsidian accepts it as-is).
 */
export function findVault(absPath: string, vaults: string[]): VaultMatch | null {
    if (absPath == null || absPath === "") return null;
    const fullPosix = toPosixPath(absPath);
    let best: VaultMatch | null = null;
    let bestLen = -1;
    for (const vault of vaults) {
        const v = normalizeDir(vault);
        if (v === "") continue;
        const vPosix = toPosixPath(v);
        const matchLen = isAncestorPosix(vPosix, fullPosix);
        if (matchLen < 0) continue;
        if (matchLen > bestLen) {
            bestLen = matchLen;
            best = {
                vaultRoot: v,
                vaultName: basenameOfPosix(vPosix),
                fileRelPath: fullPosix.slice(matchLen + 1), // skip the "/" separator
            };
        }
    }
    return best;
}

/**
 * Build an obsidian://open?vault=...&file=... URI from an absolute path.
 * Returns null when the file is not inside any known vault.
 */
export function buildObsidianUri(
    absPath: string,
    vaults: string[],
    opts?: { line?: number; column?: number }
): string | null {
    const match = findVault(absPath, vaults);
    if (match == null) return null;
    const vault = encodeURIComponent(match.vaultName);
    const fileRel = match.fileRelPath.split("\\").join("/"); // already posix but defensive
    const file = encodeURIComponent(fileRel);
    let uri = `obsidian://open?vault=${vault}&file=${file}`;
    if (opts?.line != null && Number.isFinite(opts.line)) {
        uri += `&line=${Math.floor(opts.line)}`;
        if (opts?.column != null && Number.isFinite(opts.column)) {
            uri += `&column=${Math.floor(opts.column)}`;
        }
    }
    return uri;
}

export type OpenInObsidianResult = "obsidian" | "fallback_to_picker" | "no_button";

/**
 * Try to open the file in Obsidian.
 *
 * - "obsidian": opened via obsidian:// URI
 * - "fallback_to_picker": file is markdown-like, but the file isn't in any known vault — caller should
 *   prompt the user to pick the vault directory (openInObsidianWithPicker / addUserVaultAndOpen).
 * - "no_button": known vaults list is empty (Obsidian not installed / no vaults registered) — caller
 *   shouldn't have shown the button/menu in the first place; treat as a no-op.
 */
export function openInObsidian(args: {
    absPath: string;
    vaults?: string[];
    line?: number;
    column?: number;
}): OpenInObsidianResult {
    const vaults = args.vaults != null ? args.vaults : getKnownVaults();
    if (vaults.length === 0) return "no_button";
    const uri = buildObsidianUri(args.absPath, vaults, { line: args.line, column: args.column });
    if (uri == null) return "fallback_to_picker";
    getApi().openExternal(uri);
    return "obsidian";
}

/**
 * Add a user-picked directory to the vault list (persisted in localStorage), then open
 * the file in Obsidian. Returns true if opening was triggered, false if cancelled or still no match.
 */
export async function addUserVaultAndOpen(args: {
    absPath: string;
    userVaultDir: string;
    line?: number;
    column?: number;
}): Promise<boolean> {
    const dir = args.userVaultDir;
    if (dir == null || dir.trim() === "") return false;
    const userVaults = getUserVaults();
    const alreadyExists = userVaults.some((v) => comparePath(normalizeDir(v), normalizeDir(dir)));
    if (!alreadyExists) {
        userVaults.push(dir);
        saveUserVaults(userVaults);
    }
    const result = openInObsidian({
        absPath: args.absPath,
        vaults: getKnownVaults(),
        line: args.line,
        column: args.column,
    });
    return result === "obsidian";
}

/**
 * Convenience flow: try openInObsidian; if it returns "fallback_to_picker", pop the native
 * directory picker; once user picks, addUserVaultAndOpen + retry.
 *
 * Intended for the right-click menu path where there's no button-anchored UI to display a bubble.
 * Returns the final OpenInObsidianResult.
 */
export async function openInObsidianWithPicker(args: {
    absPath: string;
    vaults?: string[];
    line?: number;
    column?: number;
}): Promise<OpenInObsidianResult> {
    let initial = openInObsidian(args);
    // "no_button" means no known vaults: still worth prompting — the user explicitly clicked Open in
    // Obsidian, so let them point us at a vault. Same recovery path as "fallback_to_picker".
    if (initial === "obsidian") return "obsidian";
    let userDir: string | null = null;
    try {
        userDir = await getApi().pickDirectory();
    } catch (e) {
        console.error("pickDirectory failed", e);
        return "no_button";
    }
    if (userDir == null) return "fallback_to_picker"; // user cancelled
    const opened = await addUserVaultAndOpen({
        absPath: args.absPath,
        userVaultDir: userDir,
        line: args.line,
        column: args.column,
    });
    return opened ? "obsidian" : "fallback_to_picker";
}

/**
 * Whether the Open-in-Obsidian button/menu should be visible for this file.
 * Visible iff: file is .md/.mdx or has a markdown-like MIME type.
 */
export function isOpenableForObsidian(absPath: string, mimeType: string | null | undefined): boolean {
    if (absPath == null || absPath === "") return false;
    const isMdByMime = mimeType != null && (mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx"));
    const isMdByName = /\.(?:md|mdx)$/i.test(absPath);
    return isMdByMime || isMdByName;
}
