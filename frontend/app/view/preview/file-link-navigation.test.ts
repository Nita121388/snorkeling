// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    applyPreviewOpenOptions,
    isPathWithinRoot,
    normalizeLinkedFilePath,
} from "@/app/view/preview/file-link-navigation";
import { describe, expect, it } from "vitest";

describe("file link navigation helpers", () => {
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

    it("applies preview open options to newly-created preview block metadata", () => {
        expect(applyPreviewOpenOptions({ view: "preview" }, { lineNumber: 12.8, editMode: true })).toEqual({
            view: "preview",
            "preview:searchline": 12,
            edit: true,
        });
    });
});
