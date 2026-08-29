// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import {
    buildLinkReplacement,
    replaceLinkInSource,
    sanitizeLinkLabel,
    sanitizeLinkUrl,
    wikiTargetFromHref,
} from "./markdown-link-edit";

describe("sanitize", () => {
    test("label strips brackets and newlines", () => {
        expect(sanitizeLinkLabel("a[b]\nc")).toBe("abc");
    });
    test("url encodes spaces and parens", () => {
        expect(sanitizeLinkUrl("a b(c)")).toBe("a%20b(c%29");
    });
});

describe("buildLinkReplacement", () => {
    test("markdown mode", () => {
        expect(buildLinkReplacement("markdown", "站点", "https://x.dev")).toBe("[站点](https://x.dev)");
    });
    test("wiki mode ignores label", () => {
        expect(buildLinkReplacement("wiki", "whatever", "My Note")).toBe("[[My Note]]");
    });
});

describe("replaceLinkInSource — offset strategy", () => {
    const text = "alpha [old](https://a.com) beta";
    const start = text.indexOf("[old]");
    const end = start + "[old](https://a.com)".length;

    test("replaces via validated offsets", () => {
        expect(
            replaceLinkInSource(
                text,
                { mode: "markdown", href: "https://a.com", label: "old", startOffset: start, endOffset: end },
                "新名字",
                "https://b.com"
            )
        ).toBe("alpha [新名字](https://b.com) beta");
    });

    test("rejects offsets whose slice no longer looks like a link (stale node)", () => {
        expect(
            replaceLinkInSource(
                text,
                { mode: "markdown", href: "https://a.com", label: "old", startOffset: 0, endOffset: 5 },
                "x",
                "y"
            )
        ).toBeNull();
    });
});

describe("replaceLinkInSource — line-window fallback", () => {
    test("finds the link by href inside the block lines", () => {
        const text = "# T\n\nSee [here](https://a.com) and [here](https://a.com) too.\n\nnext";
        const out = replaceLinkInSource(
            text,
            { mode: "markdown", href: "https://a.com", label: "here", blockStartLine: 3, blockEndLine: 3 },
            "这里",
            "https://b.com"
        );
        // first occurrence inside the block window is replaced
        expect(out).toBe("# T\n\nSee [这里](https://b.com) and [here](https://a.com) too.\n\nnext");
    });

    test("offsets win over fallback when both present", () => {
        const text = "[a](x) [b](x)";
        const start = text.indexOf("[b](x)");
        const out = replaceLinkInSource(
            text,
            {
                mode: "markdown",
                href: "x",
                label: "b",
                startOffset: start,
                endOffset: start + "[b](x)".length,
                blockStartLine: 1,
                blockEndLine: 1,
            },
            "B",
            "y"
        );
        expect(out).toBe("[a](x) [B](y)");
    });

    test("wiki link fallback", () => {
        const text = "intro\n\nSee [[My Note]] please.";
        const out = replaceLinkInSource(
            text,
            { mode: "wiki", href: "wave-wiki:My%20Note", label: "My Note", blockStartLine: 3, blockEndLine: 3 },
            "",
            "Other Note"
        );
        expect(out).toBe("intro\n\nSee [[Other Note]] please.");
    });

    test("returns null when nothing matches", () => {
        expect(
            replaceLinkInSource(
                "no links here",
                { mode: "markdown", href: "https://a.com", label: "x", blockStartLine: 1, blockEndLine: 1 },
                "a",
                "b"
            )
        ).toBeNull();
    });
});

describe("wikiTargetFromHref", () => {
    test("decodes wave-wiki hrefs", () => {
        expect(wikiTargetFromHref("wave-wiki:My%20Note%23H", "")).toBe("My Note#H");
    });
    test("passes non-wiki hrefs through", () => {
        expect(wikiTargetFromHref("https://a.com", "f")).toBe("https://a.com");
    });
});
