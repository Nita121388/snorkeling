// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { findFrontmatterSpan, getFrontmatterEmoji, setFrontmatterEmoji } from "./doc-meta";

describe("findFrontmatterSpan", () => {
    test("frontmatter at document start", () => {
        expect(findFrontmatterSpan("---\ntitle: x\n---\nbody")).toEqual({ start: 0, end: 2 });
        expect(findFrontmatterSpan("---\na: 1\n...\nbody")).toEqual({ start: 0, end: 2 });
    });

    test("not at document start → null", () => {
        expect(findFrontmatterSpan("\n---\ntitle: x\n---")).toBeNull();
        expect(findFrontmatterSpan("no frontmatter")).toBeNull();
        expect(findFrontmatterSpan("---\nnever closed")).toBeNull();
    });
});

describe("getFrontmatterEmoji", () => {
    test("reads quoted / unquoted / single-quoted values", () => {
        expect(getFrontmatterEmoji('---\nemoji: "🐠"\n---\nbody')).toBe("🐠");
        expect(getFrontmatterEmoji("---\nemoji: 🐠\n---\nbody")).toBe("🐠");
        expect(getFrontmatterEmoji("---\nemoji: '🐠'\n---\nbody")).toBe("🐠");
    });

    test("absent / no frontmatter → null", () => {
        expect(getFrontmatterEmoji("---\ntitle: x\n---\nbody")).toBeNull();
        expect(getFrontmatterEmoji("plain body")).toBeNull();
    });

    test("other keys left untouched while reading", () => {
        const t = '---\ntitle: "x"\ntags: [a]\nemoji: "🐠"\ncreated: today\n---\n';
        expect(getFrontmatterEmoji(t)).toBe("🐠");
    });
});

describe("setFrontmatterEmoji", () => {
    test("no frontmatter → minimal block prepended above the content", () => {
        expect(setFrontmatterEmoji("# Title\nbody", "🐠")).toBe('---\nemoji: "🐠"\n---\n# Title\nbody');
    });

    test("existing frontmatter without emoji → line added before the closing fence", () => {
        expect(setFrontmatterEmoji("---\ntitle: x\n---\nbody", "🐠")).toBe('---\ntitle: x\nemoji: "🐠"\n---\nbody');
    });

    test("existing emoji → replaced in place, other keys untouched", () => {
        expect(setFrontmatterEmoji('---\nemoji: "🪼"\ntitle: x\n---\nbody', "🐠")).toBe(
            '---\nemoji: "🐠"\ntitle: x\n---\nbody'
        );
    });

    test("setting the same emoji is a no-op (identical text back)", () => {
        const t = '---\nemoji: "🐠"\n---\n';
        expect(setFrontmatterEmoji(t, "🐠")).toBe(t);
    });

    test("remove: emoji line dropped, other keys survive", () => {
        expect(setFrontmatterEmoji('---\nemoji: "🐠"\ntitle: x\n---\nbody', null)).toBe("---\ntitle: x\n---\nbody");
    });

    test("remove: emoji-only frontmatter drops the WHOLE fence pair", () => {
        expect(setFrontmatterEmoji('---\nemoji: "🐠"\n---\n# Doc', null)).toBe("# Doc");
    });

    test("remove on emoji-less doc is a no-op", () => {
        expect(setFrontmatterEmoji("plain", null)).toBe("plain");
        expect(setFrontmatterEmoji("---\ntitle: x\n---\nplain", null)).toBe("---\ntitle: x\n---\nplain");
    });
});
