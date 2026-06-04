// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getAllBlockComponentModels } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openPathInPreview } from "@/app/view/preview/file-link-navigation";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { base64ToString } from "@/util/util";
import type { ParsedFileReference } from "./selection-reference-parser";

type PreviewOpenTarget = {
    blockId: string;
    model: PreviewModel;
    connection: string | null;
    currentPath: string;
    isDirectory: boolean | null;
    rootPath: string;
    score: number;
};

type ResolvedPreviewTarget = PreviewOpenTarget & {
    filePath: string;
};

type ResolvePreviewTargetResult =
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

const SearchInFilesMaxTargets = 8;
const ExactHintLineRadius = 8;
const FuzzyHintMinScore = 0.42;

export async function searchSelectionInFiles(reference: ParsedFileReference): Promise<void> {
    const targets = await collectPreviewTargets();
    if (targets.length === 0) {
        window.alert("No Files block is open in this tab.");
        return;
    }

    const result = await resolvePreviewTarget(reference, targets);
    if (result.status === "notfound") {
        window.alert(`No matching file found for "${reference.filePath}".`);
        return;
    }
    if (result.status === "ambiguous") {
        window.alert(
            `Multiple Files blocks match "${reference.filePath}". Please select a more specific path.\n\n${result.matches
                .slice(0, 5)
                .map((match) => match.filePath)
                .join("\n")}`
        );
        return;
    }

    const lineNumber = await resolveSearchTargetLine(reference, result.target);
    await openPathInPreview(result.target.filePath, {
        connection: result.target.connection,
        lineNumber,
        editMode: isMarkdownPath(result.target.filePath),
    });
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

async function collectPreviewTargets(): Promise<PreviewOpenTarget[]> {
    const targets: PreviewOpenTarget[] = [];
    for (const bcm of getAllBlockComponentModels()) {
        const viewModel = bcm.viewModel;
        if (viewModel?.viewType !== "preview") {
            continue;
        }
        const model = viewModel as PreviewModel;
        const fileInfo = await readPreviewFileInfo(model);
        const currentPath = fileInfo?.path ?? globalStore.get(model.metaFilePath);
        if (!currentPath) {
            continue;
        }
        const rootPath = resolvePreviewRootPathForSearch(fileInfo, currentPath);
        if (!rootPath) {
            continue;
        }
        targets.push({
            blockId: model.blockId,
            model,
            connection: (await globalStore.get(model.connection)) ?? null,
            currentPath: normalizePath(currentPath),
            isDirectory: fileInfo == null ? null : Boolean(fileInfo.isdir),
            rootPath: normalizePath(rootPath),
            score: 0,
        });
    }
    return targets.slice(0, SearchInFilesMaxTargets);
}

async function resolvePreviewTarget(
    reference: ParsedFileReference,
    targets: PreviewOpenTarget[]
): Promise<ResolvePreviewTargetResult> {
    const normalizedReferencePath = normalizePath(reference.filePath);
    const candidatePaths = makeCandidatePaths(normalizedReferencePath, targets);
    const matches: ResolvedPreviewTarget[] = [];

    for (const target of targets) {
        for (const candidatePath of candidatePathsForTarget(candidatePaths, target)) {
            const fileInfo = await statFile(target.model, candidatePath);
            if (fileInfo == null || fileInfo.notfound || fileInfo.isdir) {
                continue;
            }
            matches.push({
                ...target,
                filePath: normalizePath(fileInfo.path || candidatePath),
                score: scoreTarget(target, normalizedReferencePath, fileInfo.path || candidatePath),
            });
            break;
        }
    }

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

function dedupeResolvedMatches(matches: ResolvedPreviewTarget[]): ResolvedPreviewTarget[] {
    const deduped = new Map<string, ResolvedPreviewTarget>();
    for (const match of matches) {
        const key = `${match.connection ?? ""}|${normalizePath(match.filePath).toLowerCase()}`;
        if (!deduped.has(key)) {
            deduped.set(key, match);
        }
    }
    return Array.from(deduped.values());
}

function makeCandidatePaths(referencePath: string, targets: PreviewOpenTarget[]): string[] {
    if (isAbsolutePath(referencePath)) {
        return [referencePath];
    }
    const candidates = new Set<string>();
    for (const target of targets) {
        candidates.add(joinPath(target.rootPath, referencePath));
    }
    return Array.from(candidates);
}

function candidatePathsForTarget(candidatePaths: string[], target: PreviewOpenTarget): string[] {
    return candidatePaths
        .filter((candidatePath) => isAbsolutePath(candidatePath))
        .sort(
            (a, b) => Number(pathStartsWithRoot(b, target.rootPath)) - Number(pathStartsWithRoot(a, target.rootPath))
        );
}

function scoreTarget(target: PreviewOpenTarget, referencePath: string, resolvedPath: string): number {
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
    if (target.blockId === focusedBlockIdFromDom()) {
        score += 10;
    }
    return score;
}

async function readPreviewFileInfo(model: PreviewModel): Promise<FileInfo | null> {
    try {
        return await globalStore.get(model.statFile);
    } catch {
        return null;
    }
}

async function statFile(model: PreviewModel, filePath: string): Promise<FileInfo | null> {
    try {
        const remotePath = await model.formatRemoteUri(filePath, globalStore.get);
        return await model.env.rpc.FileInfoCommand(TabRpcClient, { info: { path: remotePath } });
    } catch {
        return null;
    }
}

async function resolveSearchTargetLine(
    reference: ParsedFileReference,
    target: ResolvedPreviewTarget
): Promise<number | undefined> {
    if (!reference.textHint) {
        return reference.lineNumber;
    }
    try {
        const remotePath = await target.model.formatRemoteUri(target.filePath, globalStore.get);
        const fileData = await target.model.env.rpc.FileReadCommand(TabRpcClient, { info: { path: remotePath } });
        return resolveTextHintLine(base64ToString(fileData.data64 ?? ""), reference.textHint, reference.lineNumber);
    } catch {
        return reference.lineNumber;
    }
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
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
        return null;
    }
    return activeElement.closest<HTMLElement>("[data-blockid]")?.dataset.blockid ?? null;
}
