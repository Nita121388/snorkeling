// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import remarkFrontmatterToWaveBlock from "./frontmatter-to-waveblock";
import type { Root } from "mdast";

type WaveBlockNode = {
    type: "paragraph";
    data?: { hName?: string; hProperties?: Record<string, unknown> };
    position?: { start: { line: number }; end: { line: number } };
};

function transform(
    md: string,
    opts: { startLine: number; endLine: number; blockKey: string }
): { tree: Root; children: any[] } {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkFrontmatterToWaveBlock, opts)
        .use(remarkStringify);
    const tree = processor.parse(md);
    const result = processor.runSync(tree);
    return { tree: result as any, children: (result as any).children ?? [] };
}

describe("remarkFrontmatterToWaveBlock", () => {
    it("replaces the line range with a single waveblock node", () => {
        const md = [
            "---",
            "title: Hello",
            "tags: [a, b]",
            "---",
            "",
            "Body here.",
        ].join("\n");

        const { children } = transform(md, {
            startLine: 1,
            endLine: 3,
            blockKey: "obsidian-props[fm]",
        });

        expect(children.length).toBe(2);
        const wb = children[0] as WaveBlockNode;
        expect(wb.type).toBe("paragraph");
        expect(wb.data?.hName).toBe("waveblock");
        expect(wb.data?.hProperties?.blockkey).toBe("obsidian-props[fm]");
        // body preserved
        const body = children[1];
        expect(body.type).toBe("paragraph");
    });

    it("injects position spanning the original frontmatter region", () => {
        const md = "---\ntitle: X\n---\n\nBody.";
        const { children } = transform(md, {
            startLine: 1,
            endLine: 3,
            blockKey: "fm",
        });
        const wb = children[0] as WaveBlockNode;
        expect(wb.position?.start.line).toBe(1);
        expect(wb.position?.end.line).toBe(3);
    });

    it("does nothing when no node falls inside the range", () => {
        const md = "Hello.\n\nWorld.";
        const { children } = transform(md, {
            startLine: 50,
            endLine: 60,
            blockKey: "fm",
        });
        // No node in range — tree unchanged
        expect(children.length).toBe(2);
    });

    it("handles CRLF line endings", () => {
        const md = "---\r\ntitle: X\r\n---\r\n\r\nBody.";
        const { children } = transform(md, {
            startLine: 1,
            endLine: 3,
            blockKey: "fm",
        });
        const wb = children[0] as WaveBlockNode;
        expect(wb.data?.hProperties?.blockkey).toBe("fm");
    });

    it("leaves surrounding nodes intact", () => {
        const md = "# Header\n\n---\nkey: val\n---\n\nFooter.";
        // Frontmatter at lines 3-5
        const { children } = transform(md, {
            startLine: 3,
            endLine: 5,
            blockKey: "fm",
        });
        // header(1) + waveblock + footer(1) = 3
        expect(children.length).toBe(3);
        expect(children[0].type).toBe("heading");
        expect(children[1].data?.hProperties?.blockkey).toBe("fm");
        expect(children[2].type).toBe("paragraph");
    });
});