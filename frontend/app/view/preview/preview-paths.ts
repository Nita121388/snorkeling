// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

function normalizePathForRelativeCopy(input: string): string {
    const normalized = input.replace(/[\\/]+/g, "/");
    if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
        return normalized;
    }
    return normalized.replace(/\/+$/, "");
}

function splitPathSegments(path: string): string[] {
    if (path === "/") {
        return ["/"];
    }
    const driveMatch = path.match(/^[A-Za-z]:/);
    if (driveMatch) {
        const rest = path.slice(driveMatch[0].length).replace(/^\/+/, "");
        return [driveMatch[0], ...rest.split("/").filter(Boolean)];
    }
    if (path.startsWith("/")) {
        return ["/", ...path.slice(1).split("/").filter(Boolean)];
    }
    return path.split("/").filter(Boolean);
}

export function makeRelativePathForCopy(targetPath: string, basePath: string): string | null {
    if (isBlank(targetPath) || isBlank(basePath)) {
        return null;
    }

    const separator = targetPath.includes("\\") && !targetPath.includes("/") ? "\\" : "/";
    const normalizedTargetPath = normalizePathForRelativeCopy(targetPath);
    const normalizedBasePath = normalizePathForRelativeCopy(basePath);

    if (normalizedTargetPath === normalizedBasePath) {
        return ".";
    }

    const targetSegments = splitPathSegments(normalizedTargetPath);
    const baseSegments = splitPathSegments(normalizedBasePath);
    const caseInsensitive = /^[A-Za-z]:/.test(normalizedTargetPath) || /^[A-Za-z]:/.test(normalizedBasePath);

    const rootMatches =
        targetSegments.length > 0 &&
        baseSegments.length > 0 &&
        (caseInsensitive
            ? targetSegments[0].toLowerCase() === baseSegments[0].toLowerCase()
            : targetSegments[0] === baseSegments[0]);
    if (!rootMatches) {
        return null;
    }

    let commonLength = 0;
    while (commonLength < targetSegments.length && commonLength < baseSegments.length) {
        const targetSegment = targetSegments[commonLength];
        const baseSegment = baseSegments[commonLength];
        const matches = caseInsensitive
            ? targetSegment.toLowerCase() === baseSegment.toLowerCase()
            : targetSegment === baseSegment;
        if (!matches) {
            break;
        }
        commonLength++;
    }

    const relativeSegments = [
        ...Array.from({ length: baseSegments.length - commonLength }, () => ".."),
        ...targetSegments.slice(commonLength),
    ];
    return relativeSegments.length === 0 ? "." : relativeSegments.join(separator);
}
