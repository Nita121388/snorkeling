// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, getAllBlockComponentModels, getFocusedBlockId, globalStore, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    isPathWithinRoot,
    isTreeDisplayPreviewBlock,
    normalizeConnection,
    openPathInPreview,
} from "@/app/view/preview/file-link-navigation";
import { PreviewExplorerRootMetaKey } from "@/app/view/preview/preview-navigation";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { base64ToString, fireAndForget, isBlank } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import type React from "react";
import type { ParsedFileReference } from "./selection-reference-parser";

// A candidate "Files tree" that the selected path may be resolved against.
// `stat`/`readText` are injected so mounted-tab models (current tab) and plain object
// metadata (other tabs) share the whole scoring/line-resolution pipeline (design §2.3).
export type PreviewTarget = {
    tabId: string;
    tabName: string;
    blockId: string | null;
    connection: string | null;
    currentPath: string;
    isDirectory: boolean | null;
    rootPath: string;
    isCurrentTab: boolean;
    stat: (path: string) => Promise<FileInfo | null>;
    readText: (path: string) => Promise<string | null>;
};

type ResolvedPreviewTarget = PreviewTarget & {
    filePath: string;
    score: number;
};

export type ResolvePreviewTargetResult =
    | {
          status: "resolved";
          target: ResolvedPreviewTarget;
      }
    | {
          status: "ambiguous";
          matches: ResolvedPreviewTarget[];
      }
    | {
          status: "notfound";
      };

export type SearchSelectionInFilesOptions = {
    // selection overlay feedback bubble channel; omitted callers fall back to window.alert
    onFeedback?: (msg: string, kind: string) => void;
};

const CurrentTabScoreBonus = 20;
const MaxTargetsPerTab = 4;
const MaxTotalTargets = 32;
const StatTimeoutMs = 1500;
const StatConcurrency = 4;
const AmbiguousMenuMaxItems = 8;
const ExactHintLineRadius = 8;
const FuzzyHintMinScore = 0.42;

export async function searchSelectionInFiles(
    reference: ParsedFileReference,
    options?: SearchSelectionInFilesOptions
): Promise<void> {
    // PRD R1.4: only search tabs/blocks on the same connection as the block that started
    // the search. Otherwise a relative path present in both a local and a remote tree turns
    // into a cross-connection ambiguity candidate.
    const initiatorConnection = resolveInitiatorConnection();
    const targets = await collectPreviewTargets(initiatorConnection);
    if (targets.length === 0) {
        feedback(options, "No Files tree is open in this workspace.", "warn");
        return;
    }

    const result = await resolvePreviewTarget(reference, targets);
    if (result.status === "notfound") {
        const tabCount = countTargetTabs(targets);
        feedback(
            options,
            `Searched ${tabCount} tab${tabCount === 1 ? "" : "s"} but no matching file was found for "${reference.filePath}".`,
            "warn"
        );
        return;
    }
    if (result.status === "ambiguous") {
        showAmbiguousMatchMenu(result.matches, reference, options);
        return;
    }

    await openResolvedTarget(reference, result.target, options);
}

function feedback(options: SearchSelectionInFilesOptions | undefined, msg: string, kind: string): void {
    if (options?.onFeedback != null) {
        options.onFeedback(msg, kind);
        return;
    }
    window.alert(msg);
}

async function openResolvedTarget(
    reference: ParsedFileReference,
    target: ResolvedPreviewTarget,
    options?: SearchSelectionInFilesOptions
): Promise<void> {
    // Directory references have no line to resolve (no textHint/lineNumber pass).
    const lineNumber = reference.isDirectory === true ? undefined : await resolveSearchTargetLine(reference, target);
    const currentTabId = globalStore.get(atoms.staticTabId);
    // PRD R2.5: only drag the user to another tab when that tab's tree actually covers the
    // resolved file. Absolute references may match a file outside of any tree root — then
    // the preview block is created in the current tab instead.
    const coveredByTargetTree = isPathWithinRoot(target.filePath, target.rootPath);
    const openTabId = coveredByTargetTree && !isBlank(target.tabId) ? target.tabId : currentTabId;
    await openPathInPreview(target.filePath, {
        connection: target.connection,
        lineNumber,
        editMode: isMarkdownPath(target.filePath),
        tabId: openTabId,
    });
    if (!isBlank(openTabId) && openTabId !== currentTabId) {
        options?.onFeedback?.(`Opened in Tab "${target.tabName}"`, "success");
    }
}

function showAmbiguousMatchMenu(
    matches: ResolvedPreviewTarget[],
    reference: ParsedFileReference,
    options?: SearchSelectionInFilesOptions
): void {
    const menu: ContextMenuItem[] = matches.slice(0, AmbiguousMenuMaxItems).map((match) => ({
        label: `${match.tabName} — ${relativePathForTarget(match)}`,
        click: () => {
            fireAndForget(async () => {
                await openResolvedTarget(reference, match, options);
            });
        },
    }));
    if (matches.length > AmbiguousMenuMaxItems) {
        menu.push({ type: "separator" }, {
            label: `… and ${matches.length - AmbiguousMenuMaxItems} more`,
            enabled: false,
        });
    }
    // Native context menu pops up at the pointer; only stopPropagation() is used from the event.
    const ev = { stopPropagation: () => {} } as unknown as React.MouseEvent;
    ContextMenuModel.getInstance().showContextMenu(menu, ev);
}

export function isMarkdownPath(filePath: string): boolean {
    return /\.(?:md|markdown|mdx)$/i.test(filePath);
}

export function resolveTextHintLine(
    fileContent: string,
    textHint: string | undefined,
    originalLineNumber?: number
): number | undefined {
    const normalizedHint = normalizeSearchTextHint(textHint ?? "");
    if (!normalizedHint) {
        return originalLineNumber;
    }
    const lines = fileContent.split(/\r?\n/);
    const originalLineIndex =
        originalLineNumber != null ? Math.max(0, Math.min(lines.length - 1, originalLineNumber - 1)) : null;
    if (originalLineIndex != null) {
        const exactNearbyLine = findExactHintLineNear(lines, normalizedHint, originalLineIndex);
        if (exactNearbyLine != null) {
            return exactNearbyLine;
        }
    }
    const fuzzyLine = findNearestFuzzyHintLine(lines, normalizedHint, originalLineIndex);
    return fuzzyLine ?? originalLineNumber;
}

export function resolvePreviewRootPathForSearch(fileInfo: FileInfo | null, currentPath: string): string | null {
    if (fileInfo?.isdir && fileInfo.path) {
        return normalizePath(fileInfo.path);
    }
    if (fileInfo?.dir) {
        return normalizePath(fileInfo.dir);
    }
    if (currentPath) {
        return normalizePath(currentPath);
    }
    return null;
}

// ── target collection ────────────────────────────────────────────────────────────────
// Two sources, both normalised into PreviewTarget so downstream code never branches:
//  1. mounted block component models   → current tab only (they are the only mounted ones)
//  2. workspace tab/block object store → every tab (never-mounted tabs read through WOS)

// The connection the search was initiated from. Read from the focused block's meta
// (`getFocusedBlockId()` first, then the closest [data-blockid] DOM ancestor); falls back
// to "local" when no block can be resolved.
export function resolveInitiatorConnection(): string {
    const blockId = initiatorBlockId();
    if (!isBlank(blockId)) {
        const block = readWaveObjectSync<Block>("block", blockId);
        const connection = normalizeConnection(block?.meta?.connection);
        if (!isBlank(connection)) {
            return connection;
        }
    }
    return "local";
}

function initiatorBlockId(): string | null {
    try {
        const focusedId = getFocusedBlockId?.();
        if (!isBlank(focusedId)) {
            return focusedId;
        }
    } catch {
        // layout model not ready; fall through to the DOM probe
    }
    return focusedBlockIdFromDom();
}
export async function collectPreviewTargets(
    initiatorConnection: string = resolveInitiatorConnection()
): Promise<PreviewTarget[]> {
    const currentTabId = globalStore.get(atoms.staticTabId);
    const targets: PreviewTarget[] = [];
    const seenBlocks = new Set<string>();

    await collectMountedTargets(currentTabId, initiatorConnection, targets, seenBlocks);
    await collectObjectStoreTargets(currentTabId, initiatorConnection, targets, seenBlocks);

    targets.sort((a, b) => Number(b.isCurrentTab) - Number(a.isCurrentTab));
    return limitTargetsPerTab(targets);
}

async function collectMountedTargets(
    currentTabId: string,
    initiatorConnection: string,
    targets: PreviewTarget[],
    seenBlocks: Set<string>
): Promise<void> {
    if (isBlank(currentTabId)) {
        return;
    }
    for (const bcm of getAllBlockComponentModels()) {
        const viewModel = bcm.viewModel;
        if (viewModel?.viewType !== "preview") {
            continue;
        }
        const model = viewModel as PreviewModel;
        const blockId = model.blockId;
        if (blockId == null) {
            continue;
        }
        const blockKey = `${currentTabId}|${blockId}`;
        if (seenBlocks.has(blockKey)) {
            continue;
        }
        const block = readWaveObjectSync<Block>("block", blockId);
        if (!isTreeDisplayPreviewBlock(block)) {
            continue;
        }
        const fileInfo = await readPreviewFileInfo(model);
        const currentPath = fileInfo?.path ?? globalStore.get(model.metaFilePath);
        if (!currentPath) {
            continue;
        }
        const rootPath = resolveTargetRootPath(block, fileInfo, currentPath);
        if (!rootPath) {
            continue;
        }
        // Prefer the model's resolved connection name (it survives local:/alias rewrites).
        const connection = normalizeConnection(await globalStore.get(model.connection)) || null;
        if (normalizeConnection(connection) !== initiatorConnection) {
            continue;
        }
        seenBlocks.add(blockKey);
        targets.push({
            tabId: currentTabId,
            tabName: readTabName(currentTabId) ?? "this tab",
            blockId,
            connection,
            currentPath: normalizePath(currentPath),
            isDirectory: fileInfo == null ? null : Boolean(fileInfo.isdir),
            rootPath: normalizePath(rootPath),
            isCurrentTab: true,
            stat: (path) => statFileWithModel(model, path),
            readText: (path) => readTextWithModel(model, path),
        });
    }
}

async function collectObjectStoreTargets(
    currentTabId: string,
    initiatorConnection: string,
    targets: PreviewTarget[],
    seenBlocks: Set<string>
): Promise<void> {
    const workspace = globalStore.get(atoms.workspace);
    const tabIds = orderTabIds(workspace?.tabids ?? [], currentTabId);
    for (const tabId of tabIds) {
        const tab = await loadWaveObject<Tab>("tab", tabId);
        if (tab == null) {
            continue;
        }
        const isCurrentTab = tabId === currentTabId;
        const tabName = tab.name || (isCurrentTab ? "this tab" : tabId);
        for (const blockId of tab.blockids ?? []) {
            const blockKey = `${tabId}|${blockId}`;
            if (seenBlocks.has(blockKey)) {
                continue;
            }
            const block = await loadWaveObject<Block>("block", blockId);
            if (!isTreeDisplayPreviewBlock(block)) {
                continue;
            }
            const connection = normalizeConnection(block.meta?.connection) || null;
            if (normalizeConnection(connection) !== initiatorConnection) {
                continue;
            }
            const stat = makeRpcStat(connection);
            const rootPath = await resolveObjectStoreRootPath(block, stat);
            if (rootPath == null) {
                continue;
            }
            seenBlocks.add(blockKey);
            targets.push({
                tabId,
                tabName,
                blockId,
                connection,
                currentPath: normalizePath(rootPath),
                isDirectory: true,
                rootPath: normalizePath(rootPath),
                isCurrentTab,
                stat,
                readText: makeRpcReadText(connection),
            });
        }
    }
}

// PRD R1.6: `preview:explorer-root` wins; otherwise `meta.file` only counts when it is a directory.
async function resolveObjectStoreRootPath(
    block: Block,
    stat: (path: string) => Promise<FileInfo | null>
): Promise<string | null> {
    const storedRoot = block.meta?.[PreviewExplorerRootMetaKey];
    if (!isBlank(storedRoot)) {
        return storedRoot;
    }
    const blockPath = block.meta?.file;
    if (isBlank(blockPath)) {
        return null;
    }
    const fileInfo = await withStatTimeout(stat, blockPath);
    if (fileInfo == null || fileInfo.notfound) {
        return null;
    }
    if (!fileInfo.isdir && fileInfo.mimetype !== "directory") {
        return null;
    }
    return fileInfo.path || blockPath;
}

function resolveTargetRootPath(block: Block | null, fileInfo: FileInfo | null, currentPath: string): string | null {
    const storedRoot = block?.meta?.[PreviewExplorerRootMetaKey];
    if (!isBlank(storedRoot)) {
        return storedRoot;
    }
    return resolvePreviewRootPathForSearch(fileInfo, currentPath);
}

function limitTargetsPerTab(targets: PreviewTarget[]): PreviewTarget[] {
    const perTabCount = new Map<string, number>();
    const limited: PreviewTarget[] = [];
    for (const target of targets) {
        const count = perTabCount.get(target.tabId) ?? 0;
        if (count >= MaxTargetsPerTab) {
            continue;
        }
        if (limited.length >= MaxTotalTargets) {
            break;
        }
        perTabCount.set(target.tabId, count + 1);
        limited.push(target);
    }
    return limited;
}

function orderTabIds(tabIds: string[], currentTabId: string): string[] {
    if (isBlank(currentTabId)) {
        return tabIds;
    }
    return [...tabIds].sort((a, b) => Number(b === currentTabId) - Number(a === currentTabId));
}

function countTargetTabs(targets: PreviewTarget[]): number {
    return new Set(targets.map((target) => target.tabId)).size;
}

// ── resolution ───────────────────────────────────────────────────────────────────────
export async function resolvePreviewTarget(
    reference: ParsedFileReference,
    targets: PreviewTarget[]
): Promise<ResolvePreviewTargetResult> {
    const normalizedReferencePath = normalizePath(reference.filePath);
    const statCached = makeCachedStat();
    const matches: ResolvedPreviewTarget[] = [];
    // Directory references (absolute dir selected) accept a directory hit; everything else
    // keeps the "skip directories" behaviour unchanged.
    const allowDirectory = reference.isDirectory === true;

    await runWithConcurrency(targets, StatConcurrency, async (target) => {
        for (const candidatePath of candidatePathsForTarget(normalizedReferencePath, target)) {
            const fileInfo = await statCached(target, candidatePath);
            if (fileInfo == null || fileInfo.notfound) {
                continue;
            }
            if (fileInfo.isdir && !allowDirectory) {
                continue;
            }
            const resolvedPath = normalizePath(fileInfo.path || candidatePath);
            matches.push({
                ...target,
                filePath: resolvedPath,
                score: scoreTarget(target, normalizedReferencePath, resolvedPath),
            });
            break;
        }
    });

    matches.sort((a, b) => b.score - a.score);
    const bestMatch = matches[0];
    if (bestMatch == null) {
        return { status: "notfound" };
    }
    const tiedMatches = dedupeResolvedMatches(matches.filter((match) => match.score === bestMatch.score));
    if (tiedMatches.length > 1) {
        return { status: "ambiguous", matches: tiedMatches };
    }
    return { status: "resolved", target: tiedMatches[0] ?? bestMatch };
}

// One entry per (tab, connection, path): duplicate blocks inside a single tab never bother
// the user, but the same hit in two different tabs is a real ambiguity (design §4.1).
function dedupeResolvedMatches(matches: ResolvedPreviewTarget[]): ResolvedPreviewTarget[] {
    const deduped = new Map<string, ResolvedPreviewTarget>();
    for (const match of matches) {
        const key = `${match.tabId}|${match.connection ?? ""}|${normalizePath(match.filePath).toLowerCase()}`;
        if (!deduped.has(key)) {
            deduped.set(key, match);
        }
    }
    return Array.from(deduped.values());
}

function candidatePathsForTarget(referencePath: string, target: PreviewTarget): string[] {
    if (isAbsolutePath(referencePath)) {
        return [referencePath];
    }
    const joined = joinPath(target.rootPath, referencePath);
    return isAbsolutePath(joined) ? [joined] : [];
}

function scoreTarget(target: PreviewTarget, referencePath: string, resolvedPath: string): number {
    let score = 0;
    if (pathStartsWithRoot(resolvedPath, target.rootPath)) {
        score += 60;
    }
    if (normalizePath(resolvedPath).endsWith(`/${referencePath.replace(/^\.\//, "")}`)) {
        score += 30;
    }
    if (isAbsolutePath(referencePath) && normalizePath(resolvedPath) === referencePath) {
        score += 80;
    }
    if (target.isCurrentTab) {
        score += CurrentTabScoreBonus;
    }
    if (target.blockId != null && target.blockId === focusedBlockIdFromDom()) {
        score += 10;
    }
    return score;
}

function relativePathForTarget(target: ResolvedPreviewTarget): string {
    const root = normalizePath(target.rootPath).replace(/\/$/, "");
    const filePath = normalizePath(target.filePath);
    if (root === "") {
        return filePath;
    }
    const rootWithSlash = `${root}/`;
    if (filePath.toLowerCase().startsWith(rootWithSlash.toLowerCase())) {
        return filePath.slice(rootWithSlash.length);
    }
    return filePath;
}

async function resolveSearchTargetLine(
    reference: ParsedFileReference,
    target: ResolvedPreviewTarget
): Promise<number | undefined> {
    if (!reference.textHint) {
        return reference.lineNumber;
    }
    const content = await target.readText(target.filePath);
    if (content == null) {
        return reference.lineNumber;
    }
    return resolveTextHintLine(content, reference.textHint, reference.lineNumber);
}

// ── stat/read plumbing (injected per target) ────────────────────────────────────────
const statCacheKey = (target: PreviewTarget, path: string) =>
    `${normalizeConnection(target.connection)}|${normalizePath(path).toLowerCase()}`;

function makeCachedStat(): (target: PreviewTarget, path: string) => Promise<FileInfo | null> {
    const cache = new Map<string, Promise<FileInfo | null>>();
    return (target, path) => {
        const key = statCacheKey(target, path);
        let pending = cache.get(key);
        if (pending == null) {
            pending = withStatTimeout(target.stat, path);
            cache.set(key, pending);
        }
        return pending;
    };
}

async function withStatTimeout(
    stat: (path: string) => Promise<FileInfo | null>,
    path: string
): Promise<FileInfo | null> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<FileInfo | null>((resolve) => {
        timer = setTimeout(() => resolve(null), StatTimeoutMs);
    });
    try {
        return await Promise.race([stat(path), timeout]);
    } catch {
        return null;
    } finally {
        if (timer != null) {
            clearTimeout(timer);
        }
    }
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    if (items.length === 0) {
        return;
    }
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);
    const runners = Array.from({ length: workerCount }, async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) {
                return;
            }
            try {
                await worker(items[index]);
            } catch {
                // RPC errors degrade to "no match" instead of bubbling into the UI (R5.4).
            }
        }
    });
    await Promise.all(runners);
}

// The generated FileInfo type requires `mimetype`, but a stat request only carries a path
// (same known mismatch as file-link-navigation's statPath). This cast keeps tsc clean.
function statRequestInfo(path: string): { info: FileInfo } {
    return { info: { path } as FileInfo };
}

async function readPreviewFileInfo(model: PreviewModel): Promise<FileInfo | null> {
    try {
        return (await globalStore.get(model.statFile)) ?? null;
    } catch {
        return null;
    }
}

async function statFileWithModel(model: PreviewModel, filePath: string): Promise<FileInfo | null> {
    try {
        const remotePath = await model.formatRemoteUri(filePath, globalStore.get);
        return await model.env.rpc.FileInfoCommand(TabRpcClient, statRequestInfo(remotePath));
    } catch {
        return null;
    }
}

async function readTextWithModel(model: PreviewModel, filePath: string): Promise<string | null> {
    try {
        const remotePath = await model.formatRemoteUri(filePath, globalStore.get);
        const fileData = await model.env.rpc.FileReadCommand(TabRpcClient, statRequestInfo(remotePath));
        return base64ToString(fileData?.data64 ?? "");
    } catch {
        return null;
    }
}

function makeRpcStat(connection: string | null): (path: string) => Promise<FileInfo | null> {
    return async (path: string) => {
        try {
            return await RpcApi.FileInfoCommand(
                TabRpcClient,
                statRequestInfo(formatRemoteUri(path, connection ?? "local"))
            );
        } catch {
            return null;
        }
    };
}

function makeRpcReadText(connection: string | null): (path: string) => Promise<string | null> {
    return async (path: string) => {
        try {
            const fileData = await RpcApi.FileReadCommand(
                TabRpcClient,
                statRequestInfo(formatRemoteUri(path, connection ?? "local"))
            );
            return base64ToString(fileData?.data64 ?? "");
        } catch {
            return null;
        }
    };
}

// Never-mounted tabs may not have their objects in the WOS cache yet, where a plain
// globalStore.get() would return null on the first synchronous read (design §7.3).
async function loadWaveObject<T extends WaveObj>(otype: string, oid: string): Promise<T | null> {
    try {
        return (await WOS.loadAndPinWaveObject<T>(WOS.makeORef(otype, oid))) ?? null;
    } catch {
        return null;
    }
}

function readWaveObjectSync<T extends WaveObj>(otype: string, oid: string): T | null {
    try {
        return globalStore.get(WOS.getWaveObjectAtom<T>(WOS.makeORef(otype, oid))) ?? null;
    } catch {
        return null;
    }
}

function readTabName(tabId: string): string | null {
    const tab = readWaveObjectSync<Tab>("tab", tabId);
    return isBlank(tab?.name) ? null : tab.name;
}

function findExactHintLineNear(lines: string[], normalizedHint: string, originalLineIndex: number): number | undefined {
    const start = Math.max(0, originalLineIndex - ExactHintLineRadius);
    const end = Math.min(lines.length - 1, originalLineIndex + ExactHintLineRadius);
    let bestLineIndex: number | null = null;
    for (let idx = start; idx <= end; idx++) {
        const normalizedLine = normalizeSearchTextHint(lines[idx]);
        if (!normalizedLine.includes(normalizedHint)) {
            continue;
        }
        if (bestLineIndex == null || Math.abs(idx - originalLineIndex) < Math.abs(bestLineIndex - originalLineIndex)) {
            bestLineIndex = idx;
        }
    }
    return bestLineIndex == null ? undefined : bestLineIndex + 1;
}

function findNearestFuzzyHintLine(
    lines: string[],
    normalizedHint: string,
    originalLineIndex: number | null
): number | undefined {
    let bestLineIndex: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestSimilarity = 0;
    for (let idx = 0; idx < lines.length; idx++) {
        const normalizedLine = normalizeSearchTextHint(lines[idx]);
        if (!normalizedLine) {
            continue;
        }
        const similarity = textSimilarity(normalizedLine, normalizedHint);
        if (similarity < FuzzyHintMinScore) {
            continue;
        }
        const distance = originalLineIndex == null ? idx : Math.abs(idx - originalLineIndex);
        if (distance < bestDistance || (distance === bestDistance && similarity > bestSimilarity)) {
            bestDistance = distance;
            bestSimilarity = similarity;
            bestLineIndex = idx;
        }
    }
    if (bestLineIndex == null) {
        return undefined;
    }
    return bestLineIndex + 1;
}

function textSimilarity(line: string, hint: string): number {
    if (!line || !hint) {
        return 0;
    }
    if (line.includes(hint)) {
        return hint.length / line.length;
    }
    if (hint.includes(line) && line.length >= Math.max(8, hint.length * 0.6)) {
        return line.length / hint.length;
    }
    const lineTokens = tokenizeSearchText(line);
    const hintTokens = tokenizeSearchText(hint);
    if (lineTokens.length === 0 || hintTokens.length === 0) {
        return 0;
    }
    const lineTokenSet = new Set(lineTokens);
    const hintTokenSet = new Set(hintTokens);
    let overlap = 0;
    for (const token of hintTokenSet) {
        if (lineTokenSet.has(token)) {
            overlap++;
        }
    }
    return overlap / hintTokenSet.size;
}

function tokenizeSearchText(text: string): string[] {
    return text.match(/[a-z0-9_]+/g) ?? [];
}

function normalizeSearchTextHint(text: string): string {
    return text.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function joinPath(rootPath: string, relativePath: string): string {
    const root = normalizePath(rootPath).replace(/\/$/, "");
    const rel = normalizePath(relativePath).replace(/^\.\//, "").replace(/^\//, "");
    return root === "/" ? `/${rel}` : `${root}/${rel}`;
}

export function isAbsolutePath(filePath: string): boolean {
    return filePath.startsWith("/") || filePath.startsWith("~/") || /^[A-Za-z]:\//.test(filePath);
}

function pathStartsWithRoot(filePath: string, rootPath: string): boolean {
    const normalizedFilePath = normalizePath(filePath).toLowerCase();
    const normalizedRootPath = normalizePath(rootPath).replace(/\/$/, "").toLowerCase();
    return normalizedFilePath === normalizedRootPath || normalizedFilePath.startsWith(`${normalizedRootPath}/`);
}

export function isSamePath(leftPath: string, rightPath: string): boolean {
    return normalizePath(leftPath).toLowerCase() === normalizePath(rightPath).toLowerCase();
}

function focusedBlockIdFromDom(): string | null {
    if (typeof document === "undefined") {
        return null;
    }
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
        return null;
    }
    return activeElement.closest<HTMLElement>("[data-blockid]")?.dataset.blockid ?? null;
}
