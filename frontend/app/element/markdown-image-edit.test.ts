// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    editImageSyntaxInFullText,
    removeImageSyntaxInLine,
    replaceImageSrcInLine,
} from "./markdown-util";

describe("image syntax editing (markdown preview image menu)", () => {
    it("replaces src in a bare image fragment", () => {
        expect(replaceImageSrcInLine("![cat](assets/cat.png)", "assets/cat.png", "assets/cat2.png")).toBe(
            "![cat](assets/cat2.png)"
        );
    });

    it("preserves title while replacing src", () => {
        expect(
            replaceImageSrcInLine('![cat](assets/cat.png "A cat")', "assets/cat.png", "assets/cat2.png")
        ).toBe('![cat](assets/cat2.png "A cat")');
    });

    it("preserves surrounding text on the same line", () => {
        expect(
            replaceImageSrcInLine("see ![cat](assets/cat.png) here", "assets/cat.png", "x.png")
        ).toBe("see ![cat](x.png) here");
    });

    it("picks the fragment whose src matches when a line has several images", () => {
        const line = "![a](one.png) ![b](two.png)";
        expect(replaceImageSrcInLine(line, "two.png", "three.png")).toBe("![a](one.png) ![b](three.png)");
    });

    it("returns null when src is not present", () => {
        expect(replaceImageSrcInLine("![cat](assets/cat.png)", "nope.png", "x.png")).toBeNull();
    });

    it("removes a lone image fragment and reports the line is empty", () => {
        const removed = removeImageSyntaxInLine("![cat](assets/cat.png)", "assets/cat.png");
        expect(removed).toEqual({ text: "", isEmpty: true });
    });

    it("removes only the fragment, keeping surrounding text", () => {
        const removed = removeImageSyntaxInLine("see ![cat](assets/cat.png) here", "assets/cat.png");
        expect(removed).toEqual({ text: "see  here", isEmpty: false });
    });

    it("edits the right line in the full text and joins with \\n", () => {
        const full = "# title\n\n![cat](assets/cat.png)\n\ntext";
        const next = editImageSyntaxInFullText(full, 3, (lineText) =>
            replaceImageSrcInLine(lineText, "assets/cat.png", "assets/new.png")
        );
        expect(next).toBe("# title\n\n![cat](assets/new.png)\n\ntext");
    });

    it("returns null for an out-of-range line", () => {
        expect(editImageSyntaxInFullText("a\nb", 99, (t) => t)).toBeNull();
    });

    it("deletes the whole line when the image was its only content", () => {
        const full = "# title\n\n![cat](assets/cat.png)\n\ntext";
        const next = editImageSyntaxInFullText(full, 3, (lineText) => {
            const removed = removeImageSyntaxInLine(lineText, "assets/cat.png");
            if (removed == null) {
                return null;
            }
            return removed.isEmpty ? "" : removed.text;
        });
        // The image's line becomes blank (kept as a paragraph separator); markdown
        // rendering of two blank lines is identical to one.
        expect(next).toBe("# title\n\n\n\ntext");
    });
});
