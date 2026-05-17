// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getAllBlockComponentModels } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { PreviewModel } from "@/app/view/preview/preview-model";
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

type OpenPathCapablePreviewModel = PreviewModel & {
    openPathWithTarget: (
        newPath: string,
        options?: { lineNumber?: number; forceNewBlock?: boolean; forceCurrentBlock?: boolean; editMode?: boolean }
    ) => Promise<void>;
};

const SearchInFilesMaxTargets = 8;

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

    const openTarget = findOpenFileTarget(result.target.filePath, result.target.connection, targets);
    const target = openTarget ?? result.target;
    await (target.model as OpenPathCapablePreviewModel).openPathWithTarget(result.target.filePath, {
        lineNumber: reference.lineNumber,
        forceCurrentBlock: openTarget != null,
        forceNewBlock: openTarget == null,
        editMode: isMarkdownPath(result.target.filePath),
    });
}

export function isMarkdownPath(filePath: string): boolean {
    return /\.(?:md|markdown|mdx)$/i.test(filePath);
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

function findOpenFileTarget(
    filePath: string,
    connection: string | null,
    targets: PreviewOpenTarget[]
): PreviewOpenTarget | null {
    return (
        targets.find(
            (target) =>
                target.connection === connection &&
                target.isDirectory !== true &&
                isSamePath(target.currentPath, filePath)
        ) ?? null
    );
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

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function joinPath(rootPath: string, relativePath: string): string {
    const root = normalizePath(rootPath).replace(/\/$/, "");
    const rel = normalizePath(relativePath).replace(/^\.\//, "").replace(/^\//, "");
    return root === "/" ? `/${rel}` : `${root}/${rel}`;
}

function isAbsolutePath(filePath: string): boolean {
    return filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);
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
