// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

function normalizeSessionTag(tag: string): string {
    const normalized = tag
        .trim()
        .toLowerCase()
        .replace(/^#+/, "")
        .replace(/#+$/, "");
    return /^[\p{L}\p{N}_-]+$/u.test(normalized) ? normalized : "";
}

function normalizeSessionTags(tags: string[] | null | undefined): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const tag of tags ?? []) {
        const nextTag = normalizeSessionTag(tag);
        if (nextTag === "" || seen.has(nextTag)) continue;
        seen.add(nextTag);
        normalized.push(nextTag);
    }
    return normalized;
}

function mergeSessionTags(left: string[] | null | undefined, right: string[] | null | undefined): string[] {
    return normalizeSessionTags([...(left ?? []), ...(right ?? [])]);
}

function extractSessionTagsFromNote(note: string): { note: string; tags: string[] } {
    const tags: string[] = [];
    note.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (match, prefix, tag) => {
        tags.push(tag);
        return match;
    });
    return {
        note: note.trim(),
        tags: normalizeSessionTags(tags),
    };
}

function stripSessionTagHashes(note: string): string {
    return note
        .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

function removeSessionTagFromNote(note: string, tag: string): string {
    const normalizedTag = normalizeSessionTag(tag);
    if (normalizedTag === "") return note;
    return note
        .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (match, prefix, nextTag) =>
            normalizeSessionTag(nextTag) === normalizedTag ? prefix : match
        )
        .trim()
        .replace(/[ \t]{2,}/g, " ");
}

function sessionTagsEqual(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
    const leftTags = normalizeSessionTags(left);
    const rightTags = normalizeSessionTags(right);
    if (leftTags.length !== rightTags.length) return false;
    return leftTags.every((tag, index) => tag === rightTags[index]);
}

function sessionTagsLabel(tags: string[] | null | undefined): string {
    return normalizeSessionTags(tags)
        .map((tag) => `#${tag}`)
        .join(" ");
}

export {
    extractSessionTagsFromNote,
    mergeSessionTags,
    normalizeSessionTag,
    normalizeSessionTags,
    removeSessionTagFromNote,
    sessionTagsEqual,
    sessionTagsLabel,
    stripSessionTagHashes,
};
