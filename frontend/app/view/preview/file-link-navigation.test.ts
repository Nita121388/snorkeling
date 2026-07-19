// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    applyPreviewOpenOptions,
    findMarkdownHeadingLine,
    isPathWithinRoot,
    isSamePreviewPath,
    normalizeLinkedFilePath,
    makeMarkdownWikiLinkHref,
    parseMarkdownWikiLink,
    parseMarkdownFileLineReference,
} from "@/app/view/preview/file-link-navigation";
import { describe, expect, it } from "vitest";

describe("file link navigation helpers", () => {
    it("parses wiki links and preserves aliases and headings", () => {
        expect(parseMarkdownWikiLink("[[终端笔记|打开笔记]]")).toEqual({
            target: "终端笔记.md",
            label: "打开笔记",
            heading: undefined,
        });
        expect(parseMarkdownWikiLink(makeMarkdownWikiLinkHref("终端笔记.md", "TTY 驱动"))).toEqual({
            target: "终端笔记.md",
            label: "终端笔记.md",
            heading: "TTY 驱动",
        });
    });

    it("resolves wiki link headings to source lines", () => {
        expect(findMarkdownHeadingLine("# Overview\n\n## TTY 驱动\n内容", "TTY  驱动")).toBe(3);
        expect(findMarkdownHeadingLine("# Overview", "Missing")).toBeNull();
    });
    it("parses absolute markdown references with source lines", () => {
        expect(
            parseMarkdownFileLineReference(
                "E:/primary/Obsidian/Primary Mission/70-专业知识学习/05-技术基础/终端与OS基元/内核 tty 驱动 - 学习笔记.md:43"
            )
        ).toEqual({
            filePath:
                "E:/primary/Obsidian/Primary Mission/70-专业知识学习/05-技术基础/终端与OS基元/内核 tty 驱动 - 学习笔记.md",
            lineNumber: 43,
        });
        expect(parseMarkdownFileLineReference("E:/notes/readme.md:0")).toBeNull();
    });

    it("recognizes local file paths from markdown links", () => {
        expect(normalizeLinkedFilePath("E:/code/tpot/tpot/__init__.py")).toBe("E:/code/tpot/tpot/__init__.py");
        expect(normalizeLinkedFilePath("E:\\code\\tpot\\tpot\\__init__.py")).toBe("E:/code/tpot/tpot/__init__.py");
        expect(normalizeLinkedFilePath("/Users/nita/project/file.ts")).toBe("/Users/nita/project/file.ts");
        expect(normalizeLinkedFilePath("~/project/file.ts")).toBe("~/project/file.ts");
        expect(normalizeLinkedFilePath("file:///E:/code/tpot/tpot/__init__.py")).toBe("E:/code/tpot/tpot/__init__.py");
    });

    it("ignores web links and heading fragments", () => {
        expect(normalizeLinkedFilePath("https://example.com")).toBeNull();
        expect(normalizeLinkedFilePath("mailto:test@example.com")).toBeNull();
        expect(normalizeLinkedFilePath("#heading")).toBeNull();
        expect(normalizeLinkedFilePath("docs/readme.md")).toBeNull();
    });

    it("resolves relative markdown links against the current file directory", () => {
        expect(
            normalizeLinkedFilePath("docs/dl/README.md", {
                baseDir: "/Users/nita/Primary/projects/ai_learning/ai_interview_note",
            })
        ).toBe("/Users/nita/Primary/projects/ai_learning/ai_interview_note/docs/dl/README.md");
        expect(normalizeLinkedFilePath("../README.md#overview", { baseDir: "/tmp/project/docs" })).toBe(
            "/tmp/project/README.md"
        );
        expect(normalizeLinkedFilePath(".\\guide\\intro.md", { baseDir: "E:/code/project/docs" })).toBe(
            "E:/code/project/docs/guide/intro.md"
        );
    });

    it("checks whether a target path is under a tree root", () => {
        expect(isPathWithinRoot("E:/code/tpot/tpot/__init__.py", "E:/code/tpot")).toBe(true);
        expect(isPathWithinRoot("E:/code/tpot/tpot/__init__.py", "E:/")).toBe(true);
        expect(isPathWithinRoot("E:/code/tpot-other/file.py", "E:/code/tpot")).toBe(false);
        expect(isPathWithinRoot("/tmp/project/src/index.ts", "/tmp/project")).toBe(true);
        expect(isPathWithinRoot("/tmp/project2/index.ts", "/tmp/project")).toBe(false);
    });

    it("compares preview paths using normalized separators and trailing slashes", () => {
        expect(isSamePreviewPath("/tmp/project/src/index.ts", "/tmp/project/src/index.ts")).toBe(true);
        expect(isSamePreviewPath("/tmp/project/src/", "/tmp/project/src")).toBe(true);
        expect(isSamePreviewPath("E:\\code\\tpot\\tpot\\__init__.py", "E:/code/tpot/tpot/__init__.py")).toBe(true);
        expect(isSamePreviewPath("/tmp/project/src/index.ts", "/tmp/project2/src/index.ts")).toBe(false);
        expect(isSamePreviewPath("", "/tmp/project/src/index.ts")).toBe(false);
    });

    it("applies preview open options to newly-created preview block metadata", () => {
        expect(applyPreviewOpenOptions({ view: "preview" }, { lineNumber: 12.8, editMode: true })).toEqual({
            view: "preview",
            "preview:searchline": 12,
            edit: true,
        });
    });
});
