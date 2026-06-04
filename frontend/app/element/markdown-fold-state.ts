// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type MarkdownFence = {
    marker: "`" | "~";
    length: number;
};

type MarkdownHeadingIdentity = {
    lineNumber: number;
    endLineNumber: number;
    level: number;
    text: string;
    pathKey: string;
    contentKey: string;
};

export type MonacoCollapsedRegion = {
    startLineNumber?: number;
    endLineNumber?: number;
    isCollapsed?: boolean;
};

export type MarkdownFoldSnapshot = {
    identities: MarkdownFoldIdentity[];
};

type MarkdownFoldIdentity = {
    pathKey: string;
    contentKey: string;
};

const HeadingPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;

export function captureMarkdownFoldSnapshot(
    text: string,
    collapsedRegions: MonacoCollapsedRegion[]
): MarkdownFoldSnapshot {
    const identities = collectMarkdownHeadingIdentities(text);
    const identityByLine = new Map(identities.map((identity) => [identity.lineNumber, identity]));
    return {
        identities: collapsedRegions
            .filter((region) => region.isCollapsed !== false)
            .map((region) => identityByLine.get(region.startLineNumber ?? 0))
            .filter((identity): identity is MarkdownHeadingIdentity => identity != null)
            .map((identity) => ({
                pathKey: identity.pathKey,
                contentKey: identity.contentKey,
            })),
    };
}

export function resolveMarkdownFoldLines(text: string, snapshot: MarkdownFoldSnapshot | null): number[] {
    if (snapshot == null || snapshot.identities.length === 0) {
        return [];
    }
    const identities = collectMarkdownHeadingIdentities(text);
    const identitiesByPath = new Map(identities.map((identity) => [identity.pathKey, identity]));
    const identitiesByContent = new Map<string, MarkdownHeadingIdentity[]>();
    for (const identity of identities) {
        const matches = identitiesByContent.get(identity.contentKey) ?? [];
        matches.push(identity);
        identitiesByContent.set(identity.contentKey, matches);
    }

    const lineNumbers: number[] = [];
    for (const snapshotIdentity of snapshot.identities) {
        const contentMatches = identitiesByContent.get(snapshotIdentity.contentKey) ?? [];
        const identity =
            contentMatches.length === 1 ? contentMatches[0] : identitiesByPath.get(snapshotIdentity.pathKey);
        if (identity == null || lineNumbers.includes(identity.lineNumber)) {
            continue;
        }
        lineNumbers.push(identity.lineNumber);
    }
    return lineNumbers.sort((left, right) => left - right);
}

function collectMarkdownHeadingIdentities(text: string): MarkdownHeadingIdentity[] {
    const lines = text.split(/\r\n|\r|\n/);
    const headings = collectMarkdownHeadings(lines);
    const stack: MarkdownHeadingIdentity[] = [];
    const duplicateCounts = new Map<string, number>();
    const identities: MarkdownHeadingIdentity[] = [];

    headings.forEach((heading, index) => {
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }
        const pathParts = [...stack.map((item) => `${item.level}:${item.text}`), `${heading.level}:${heading.text}`];
        const basePathKey = pathParts.join(">");
        const duplicateIndex = duplicateCounts.get(basePathKey) ?? 0;
        duplicateCounts.set(basePathKey, duplicateIndex + 1);
        const nextBoundary = headings
            .slice(index + 1)
            .find((candidate) => candidate.level <= heading.level)?.lineNumber;
        const endLineNumber = (nextBoundary ?? lines.length + 1) - 1;
        const sectionText = lines.slice(heading.lineNumber - 1, endLineNumber).join("\n");
        const identity: MarkdownHeadingIdentity = {
            lineNumber: heading.lineNumber,
            endLineNumber,
            level: heading.level,
            text: heading.text,
            pathKey: `${basePathKey}#${duplicateIndex}`,
            contentKey: `${heading.level}:${heading.text}:${hashString(sectionText)}`,
        };
        identities.push(identity);
        stack.push(identity);
    });

    return identities;
}

function collectMarkdownHeadings(lines: string[]): Array<{ lineNumber: number; level: number; text: string }> {
    const headings: Array<{ lineNumber: number; level: number; text: string }> = [];
    let fence: MarkdownFence | null = null;

    lines.forEach((line, index) => {
        if (fence) {
            if (isFenceEnd(line, fence)) {
                fence = null;
            }
            return;
        }

        const fenceStart = getFenceStart(line);
        if (fenceStart) {
            fence = fenceStart;
            return;
        }

        const heading = parseHeading(line);
        if (heading == null) {
            return;
        }
        headings.push({
            ...heading,
            lineNumber: index + 1,
        });
    });

    return headings;
}

function parseHeading(line: string): { level: number; text: string } | null {
    const match = line.match(HeadingPattern);
    if (!match) {
        return null;
    }
    const text = stripClosingHashes(match[2] ?? "").trim();
    return {
        level: match[1].length,
        text,
    };
}

function stripClosingHashes(text: string): string {
    return text.replace(/[ \t]+#+[ \t]*$/, "");
}

function hashString(value: string): string {
    let hash = 0;
    for (let idx = 0; idx < value.length; idx++) {
        hash = (hash * 31 + value.charCodeAt(idx)) >>> 0;
    }
    return hash.toString(36);
}

function getFenceStart(line: string): MarkdownFence | null {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) {
        return null;
    }
    const fence = match[1];
    return {
        marker: fence[0] as "`" | "~",
        length: fence.length,
    };
}

function isFenceEnd(line: string, fence: MarkdownFence): boolean {
    const escapedMarker = fence.marker === "`" ? "`" : "~";
    const pattern = new RegExp(`^ {0,3}${escapedMarker}{${fence.length},}[ \\t]*$`);
    return pattern.test(line);
}
