// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// End-to-end render test for the full markdown pipeline (makeRemarkPlugins): blank-line
// separated ordered lists must render as separate <ol start="N"> groups (the user-authored
// first number of each group survives), with a spacer paragraph between them.

import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { makeRemarkPlugins } from "./index";

function render(md: string): string {
    return renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={makeRemarkPlugins({ contentBlocksMap: new Map() })}>{md}</ReactMarkdown>
    );
}

describe("split loose lists render pipeline", () => {
    it("splits groups into two <ol> with per-group start attributes", () => {
        const html = render("1. a\n2. b\n\n5. c\n5. d");
        const orderedLists = html.match(/<ol[^>]*>/g) ?? [];
        expect(orderedLists).toHaveLength(2);
        // start=1 is the default and is omitted from the markup; only later groups pin theirs.
        expect(orderedLists[1]).toContain('start="5"');
        // Each group has its source-written 2 items
        expect(html.match(/<li[\s>]/g) ?? []).toHaveLength(4);
    });

    it("tight lists stay a single <ol>", () => {
        const html = render("1. a\n2. b\n3. c");
        expect(html.match(/<ol[^>]*>/g) ?? []).toHaveLength(1);
    });

    it("the blank between groups becomes a real spacer row", () => {
        const html = render("1. a\n\n5. b");
        // blank-line-spacers tags spacer paragraphs with class "blank-spacer"
        expect(html).toContain("blank-spacer");
    });

    it("post-first split groups carry data-split-group on <ol> for the grip menu", () => {
        const html = render("1. a\n\n5. b");
        const orderedLists = html.match(/<ol[^>]*>/g) ?? [];
        expect(orderedLists[0]).not.toContain("data-split-group");
        expect(orderedLists[1]).toContain('data-split-group="true"');
    });

    it("fence contents are never split", () => {
        const html = render("1. a\n\n```\n1. code\n5. code\n```\n\n2. b");
        const orderedLists = html.match(/<ol[^>]*>/g) ?? [];
        expect(orderedLists).toHaveLength(2);
    });
});
