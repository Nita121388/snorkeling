// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type ParsedFileReference = {
    rawText: string;
    filePath: string;
    lineNumber?: number;
    columnNumber?: number;
    endLineNumber?: number;
    textHint?: string;
};

type ScoredParsedFileReference = ParsedFileReference & {
    score: number;
};

type CandidateText = {
    text: string;
    scoreBoost: number;
};

const FilePathPattern =
    "((?:[A-Za-z]:)?(?:[\\\\/])?(?:\\.{1,2}[\\\\/])?(?:[^\\\\/:*?\"<>|\\r\\n\\'`\\[\\]()]+[\\\\/])*[^\\\\/:*?\"<>|\\r\\n\\'`\\[\\]()]+\\.[A-Za-z0-9._-]+)";
const HashLineReferencePattern = new RegExp(String.raw`^${FilePathPattern}#L(\d+)(?:C(\d+))?(?:-L?(\d+))?$`);
const ColonLineReferencePattern = new RegExp(String.raw`^${FilePathPattern}:(\d+)(?::(\d+)|-(\d+))?$`);
const ColonLineTextHintReferencePattern = new RegExp(
    String.raw`${FilePathPattern}:(\d+)(?::(\d+))?(?:\s*[:\-–—]\s*|\s+)(\S[\s\S]*)$`
);
const ParenLineReferencePattern = new RegExp(String.raw`^${FilePathPattern}\((\d+)(?:,(\d+))?\)$`);
const ParenLineKeywordReferencePattern = new RegExp(
    String.raw`^${FilePathPattern}\s*\(\s*line\s*[:#]?\s*(\d+)(?:\s*,\s*(?:(?:column|col)\s*[:#]?\s*)?(\d+))?\s*\)$`,
    "i"
);
const PythonTracePattern = /File\s+["']([^"']+)["'],\s+line\s+(\d+)/;
const GithubBlobPattern = /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/([^#\s]+)#L(\d+)(?:C(\d+))?(?:-L?(\d+))?$/i;
const LineNumberPatterns = [
    /\b(?:line|ln)\s*[:#=]?\s*(\d{1,7})\b/i,
    /行号\s*[:#=]?\s*(\d{1,7})/i,
    /第\s*(\d{1,7})\s*行/i,
    /行\s*[:#=]?\s*(\d{1,7})/i,
];
const ColumnNumberPatterns = [/\b(?:column|col)\s*[:#=]?\s*(\d{1,7})\b/i, /列\s*[:#=]?\s*(\d{1,7})/i];
const WrappingPrefix = "`'\"([{<";
const WrappingSuffix = "`'\"`)]}>,;.!?";
const TextHintMaxLength = 500;

export function parseFileReference(text: string): ParsedFileReference | null {
    const normalizedText = normalizeInput(text);
    let bestMatch: ScoredParsedFileReference | null = null;

    bestMatch = pickBetterReference(bestMatch, parseIndentedMultilinePathReference(normalizedText));

    for (const rawLine of normalizedText.split("\n")) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        bestMatch = pickBetterReference(bestMatch, parsePythonTraceReference(line));
        bestMatch = pickBetterReference(bestMatch, parseColonTextHintReference(line));

        for (const candidate of expandCandidateSegments(line)) {
            bestMatch = pickBetterReference(bestMatch, parseCandidate(candidate));
        }

        bestMatch = pickBetterReference(bestMatch, parseFallbackInlineReference(line));
    }

    bestMatch = pickBetterReference(bestMatch, parseCrossLineFallbackReference(normalizedText));

    if (bestMatch == null) {
        return null;
    }

    const { score: _score, ...reference } = bestMatch;
    return reference;
}

function parseIndentedMultilinePathReference(text: string): ScoredParsedFileReference | null {
    const rawLines = text.split("\n");
    for (let idx = 0; idx < rawLines.length; idx++) {
        const baseLine = stripWrappingPunctuation(rawLines[idx].trim());
        if (!isDirectoryLikeAbsolutePath(baseLine)) {
            continue;
        }
        const parts = [baseLine.replace(/\/$/, "")];
        for (let partIdx = idx + 1; partIdx < rawLines.length; partIdx++) {
            const rawLine = rawLines[partIdx];
            if (!/^\s+/.test(rawLine)) {
                break;
            }
            const part = stripWrappingPunctuation(rawLine.trim());
            if (!part) {
                continue;
            }
            parts.push(part);
            const candidate = joinPathParts(parts);
            const parsed = parseCandidate({ text: candidate, scoreBoost: 34 });
            if (parsed != null) {
                return parsed;
            }
        }
    }
    return null;
}

function joinPathParts(parts: string[]): string {
    if (parts.length === 0) {
        return "";
    }
    const [firstPart, ...restParts] = parts;
    let joinedPath = firstPart.replace(/\/+$/, "");
    for (const part of restParts) {
        const normalizedPart = part.replace(/^\/+/, "").replace(/\/+$/, "");
        if (!normalizedPart) {
            continue;
        }
        if (shouldJoinAsSoftWrappedSegment(joinedPath, part)) {
            joinedPath += normalizedPart;
        } else {
            joinedPath = `${joinedPath}/${normalizedPart}`;
        }
    }
    return joinedPath;
}

function shouldJoinAsSoftWrappedSegment(previousPath: string, nextPart: string): boolean {
    return previousPath.endsWith("-") && !nextPart.startsWith("/") && !nextPart.startsWith("\\");
}

function expandCandidateSegments(line: string): CandidateText[] {
    const segments = new Map<string, number>();
    const addSegment = (value: string, scoreBoost: number): void => {
        const sanitized = value.trim();
        if (!sanitized) {
            return;
        }
        const previousScore = segments.get(sanitized);
        if (previousScore === undefined || scoreBoost > previousScore) {
            segments.set(sanitized, scoreBoost);
        }
    };

    addSegment(line, 2);

    for (const token of line.split(/\s+/)) {
        addSegment(token, 0);
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) {
        addSegment(match[1], 20);
    }
    for (const match of line.matchAll(/"([^"]+)"/g)) {
        addSegment(match[1], 18);
    }
    for (const match of line.matchAll(/'([^']+)'/g)) {
        addSegment(match[1], 18);
    }
    for (const match of line.matchAll(/\(([^()]+)\)/g)) {
        addSegment(match[1], 14);
    }
    for (const match of line.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        addSegment(match[1], 12);
        addSegment(match[2], 20);
    }
    for (const match of line.matchAll(/\[([^\]]+)\]/g)) {
        addSegment(match[1], 8);
    }

    return Array.from(segments.entries()).map(([candidateText, scoreBoost]) => ({ text: candidateText, scoreBoost }));
}

function parseCandidate(candidate: CandidateText): ScoredParsedFileReference | null {
    const parsers = [
        parseGithubBlobReference,
        parseHashReference,
        parseColonReference,
        parseParenLineKeywordReference,
        parseParenReference,
        parsePathOnlyReference,
    ];
    let bestMatch: ScoredParsedFileReference | null = null;
    for (const parser of parsers) {
        bestMatch = pickBetterReference(bestMatch, parser(candidate.text, candidate.scoreBoost));
    }
    return bestMatch;
}

function parseHashReference(candidateText: string, scoreBoost: number): ScoredParsedFileReference | null {
    const sanitizedCandidate = stripWrappingPunctuation(candidateText);
    const match = sanitizedCandidate.match(HashLineReferencePattern);
    if (!match) return null;
    const [, filePath, lineNumberText, columnNumberText, endLineNumberText] = match;
    return createReference({
        rawText: sanitizedCandidate,
        filePath,
        lineNumber: parseInt(lineNumberText, 10),
        columnNumber: columnNumberText ? parseInt(columnNumberText, 10) : undefined,
        endLineNumber: endLineNumberText ? parseInt(endLineNumberText, 10) : undefined,
        score: 78 + scoreBoost,
    });
}

function parseColonReference(candidateText: string, scoreBoost: number): ScoredParsedFileReference | null {
    const sanitizedCandidate = stripWrappingPunctuation(candidateText);
    const match = sanitizedCandidate.match(ColonLineReferencePattern);
    if (!match) return null;
    const [, filePath, lineNumberText, columnNumberText, endLineNumberText] = match;
    return createReference({
        rawText: sanitizedCandidate,
        filePath,
        lineNumber: parseInt(lineNumberText, 10),
        columnNumber: columnNumberText ? parseInt(columnNumberText, 10) : undefined,
        endLineNumber: endLineNumberText ? parseInt(endLineNumberText, 10) : undefined,
        score: 72 + scoreBoost,
    });
}

function parseColonTextHintReference(line: string): ScoredParsedFileReference | null {
    if (stripWrappingPunctuation(line).match(ColonLineReferencePattern)) return null;
    const match = line.match(ColonLineTextHintReferencePattern);
    if (!match) return null;
    const [, filePath, lineNumberText, columnNumberText, textHintText] = match;
    const textHint = sanitizeTextHint(textHintText);
    if (!textHint) return null;
    return createReference({
        rawText: match[0].trim(),
        filePath,
        lineNumber: parseInt(lineNumberText, 10),
        columnNumber: columnNumberText ? parseInt(columnNumberText, 10) : undefined,
        textHint,
        score: 84,
    });
}

function parseParenReference(candidateText: string, scoreBoost: number): ScoredParsedFileReference | null {
    const sanitizedCandidate = candidateText
        .trim()
        .replace(/^['"`]+/, "")
        .replace(/[;,.!?]+$/, "");
    const match = sanitizedCandidate.match(ParenLineReferencePattern);
    if (!match) return null;
    const [, filePath, lineNumberText, columnNumberText] = match;
    return createReference({
        rawText: sanitizedCandidate,
        filePath,
        lineNumber: parseInt(lineNumberText, 10),
        columnNumber: columnNumberText ? parseInt(columnNumberText, 10) : undefined,
        score: 70 + scoreBoost,
    });
}

function parseParenLineKeywordReference(candidateText: string, scoreBoost: number): ScoredParsedFileReference | null {
    const sanitizedCandidate = candidateText
        .trim()
        .replace(/^['"`]+/, "")
        .replace(/[;,.!?]+$/, "");
    const match = sanitizedCandidate.match(ParenLineKeywordReferencePattern);
    if (!match) return null;
    const [, filePath, lineNumberText, columnNumberText] = match;
    return createReference({
        rawText: sanitizedCandidate,
        filePath,
        lineNumber: parseInt(lineNumberText, 10),
        columnNumber: columnNumberText ? parseInt(columnNumberText, 10) : undefined,
        score: 71 + scoreBoost,
    });
}

function parsePathOnlyReference(candidateText: string, scoreBoost: number): ScoredParsedFileReference | null {
    const sanitizedCandidate = stripWrappingPunctuation(candidateText);
    const match = sanitizedCandidate.match(new RegExp(String.raw`^${FilePathPattern}$`));
    if (!match) return null;
    return createReference({
        rawText: sanitizedCandidate,
        filePath: match[1],
        score: 32 + scoreBoost,
    });
}

function parsePythonTraceReference(line: string): ScoredParsedFileReference | null {
    const match = line.match(PythonTracePattern);
    if (!match) return null;
    const [, filePath, lineNumberText] = match;
    return createReference({
        rawText: match[0],
        filePath,
        lineNumber: parseInt(lineNumberText, 10),
        score: 90,
    });
}

function parseFallbackInlineReference(line: string): ScoredParsedFileReference | null {
    const sanitizedLine = line.trim();
    if (!sanitizedLine) return null;
    const filePath = extractBestFilePath(sanitizedLine);
    const lineNumber = extractNumberByPatterns(sanitizedLine, LineNumberPatterns);
    if (!filePath || !lineNumber) return null;
    const columnNumber = extractNumberByPatterns(sanitizedLine, ColumnNumberPatterns);
    return createReference({
        rawText: sanitizedLine,
        filePath,
        lineNumber,
        columnNumber,
        score: 52,
    });
}

function parseCrossLineFallbackReference(text: string): ScoredParsedFileReference | null {
    if (!text.includes("\n")) return null;
    const filePath = extractBestFilePath(text);
    const lineNumber = extractNumberByPatterns(text, LineNumberPatterns);
    if (!filePath || !lineNumber) return null;
    const columnNumber = extractNumberByPatterns(text, ColumnNumberPatterns);
    return createReference({
        rawText: columnNumber
            ? `${filePath} line ${lineNumber}, col ${columnNumber}`
            : `${filePath} line ${lineNumber}`,
        filePath,
        lineNumber,
        columnNumber,
        score: 46,
    });
}

function parseGithubBlobReference(candidateText: string, scoreBoost: number): ScoredParsedFileReference | null {
    const sanitizedCandidate = stripWrappingPunctuation(candidateText);
    const match = sanitizedCandidate.match(GithubBlobPattern);
    if (!match) return null;
    const [, blobPath, lineNumberText, columnNumberText, endLineNumberText] = match;
    return createReference({
        rawText: sanitizedCandidate,
        filePath: extractWorkspacePathFromGithubBlob(blobPath),
        lineNumber: parseInt(lineNumberText, 10),
        columnNumber: columnNumberText ? parseInt(columnNumberText, 10) : undefined,
        endLineNumber: endLineNumberText ? parseInt(endLineNumberText, 10) : undefined,
        score: 86 + scoreBoost,
    });
}

function createReference(reference: ScoredParsedFileReference): ScoredParsedFileReference | null {
    const filePath = normalizeParsedPath(reference.filePath);
    if (!filePath) return null;
    if (reference.lineNumber !== undefined && (!Number.isInteger(reference.lineNumber) || reference.lineNumber <= 0)) {
        return null;
    }
    if (
        reference.columnNumber !== undefined &&
        (!Number.isInteger(reference.columnNumber) || reference.columnNumber <= 0)
    ) {
        return null;
    }
    if (
        reference.endLineNumber !== undefined &&
        (!Number.isInteger(reference.endLineNumber) ||
            reference.lineNumber === undefined ||
            reference.endLineNumber < reference.lineNumber)
    ) {
        return null;
    }
    const pathBonus = /[\\/]/.test(filePath) ? 8 : 0;
    const absoluteBonus = isAbsolutePath(filePath) ? 4 : 0;
    const rangeBonus = reference.endLineNumber ? 4 : 0;
    const columnBonus = reference.columnNumber ? 3 : 0;
    return {
        ...reference,
        filePath,
        score: reference.score + pathBonus + absoluteBonus + rangeBonus + columnBonus,
    };
}

function pickBetterReference(
    current: ScoredParsedFileReference | null,
    candidate: ScoredParsedFileReference | null
): ScoredParsedFileReference | null {
    if (candidate == null) return current;
    if (current == null || candidate.score > current.score) return candidate;
    return current;
}

function extractWorkspacePathFromGithubBlob(blobPath: string): string {
    const segments = blobPath.split("/").filter(Boolean);
    if (segments.length <= 1) return blobPath;
    return segments.slice(1).join("/") || blobPath;
}

function normalizeInput(text: string): string {
    return text
        .replace(/\r\n/g, "\n")
        .replace(/\uFF1A/g, ":")
        .replace(/\uFF08/g, "(")
        .replace(/\uFF09/g, ")")
        .replace(/\uFF0C/g, ",");
}

function normalizeParsedPath(filePath: string): string {
    let normalizedPath = stripWrappingPunctuation(filePath).trim();
    if (!normalizedPath) return normalizedPath;
    if (normalizedPath.startsWith("file:///")) {
        normalizedPath = decodeURIComponent(normalizedPath.replace(/^file:\/\/\//i, ""));
    }
    return normalizedPath.replace(/\\/g, "/");
}

function stripWrappingPunctuation(value: string): string {
    let sanitized = value.trim();
    while (sanitized && WrappingPrefix.includes(sanitized[0])) {
        sanitized = sanitized.slice(1);
    }
    while (sanitized && WrappingSuffix.includes(sanitized[sanitized.length - 1])) {
        sanitized = sanitized.slice(0, -1);
    }
    return sanitized.trim();
}

function sanitizeTextHint(textHint: string): string {
    let sanitized = textHint.trim();
    if (sanitized.startsWith("`") && sanitized.endsWith("`") && sanitized.length > 1) {
        sanitized = sanitized.slice(1, -1).trim();
    }
    if (sanitized.length > TextHintMaxLength) {
        sanitized = sanitized.slice(0, TextHintMaxLength).trimEnd();
    }
    return sanitized;
}

function extractBestFilePath(text: string): string | null {
    const filePathRegex = new RegExp(FilePathPattern, "g");
    let bestPath: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const match of text.matchAll(filePathRegex)) {
        const rawPath = match[1] ?? match[0];
        let candidatePath = stripWrappingPunctuation(rawPath);
        if (/^[^\\/\s]+[=:]\s*.+/.test(candidatePath) && !/^[A-Za-z]:[\\/]/.test(candidatePath)) {
            candidatePath = candidatePath.replace(/^[^\\/\s]+[=:]\s*/, "");
        }
        if (!candidatePath) continue;
        let score = candidatePath.length;
        if (/[\\/]/.test(candidatePath)) score += 10;
        if (isAbsolutePath(candidatePath)) score += 5;
        if (score > bestScore) {
            bestScore = score;
            bestPath = candidatePath;
        }
    }
    return bestPath;
}

function extractNumberByPatterns(text: string, patterns: RegExp[]): number | undefined {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const parsed = parseInt(match[1], 10);
        if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return undefined;
}

function isAbsolutePath(filePath: string): boolean {
    return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
}

function isDirectoryLikeAbsolutePath(filePath: string): boolean {
    if (!isAbsolutePath(filePath)) {
        return false;
    }
    return filePath.endsWith("/") || !/[^/\\]+\.[A-Za-z0-9._-]+$/.test(filePath);
}
