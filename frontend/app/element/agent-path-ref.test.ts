// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { repairAgentPathText, parseAgentPathRef } from "./agent-path-ref";

describe("repairAgentPathText", () => {
    it("repairs a broken file:/// prefix", () => {
        expect(repairAgentPathText("file///E:/code/a.html")).toBe("file:///E:/code/a.html");
        expect(repairAgentPathText("file//E:/code/a.html")).toBe("file:///E:/code/a.html");
        expect(repairAgentPathText("file:/E:/code/a.html")).toBe("file:///E:/code/a.html");
    });

    it("collapses double slashes after a drive letter only", () => {
        expect(repairAgentPathText("E://primary/a.html")).toBe("E:/primary/a.html");
        expect(repairAgentPathText("D://x//y.html")).toBe("D:/x/y.html");
    });

    it("keeps UNC prefixes intact", () => {
        expect(repairAgentPathText("//server/share/x.html")).toBe("//server/share/x.html");
    });

    it("strips wrapping punctuation and backticks", () => {
        expect(repairAgentPathText("(E://xxxx)")).toBe("E:/xxxx");
        expect(repairAgentPathText("[E:/code/a.html]")).toBe("E:/code/a.html");
        expect(repairAgentPathText("`E:/code/a.ts:12`")).toBe("E:/code/a.ts:12");
        expect(repairAgentPathText("「E:/code/a.ts」")).toBe("E:/code/a.ts");
        expect(repairAgentPathText("《E:/code/a.ts》")).toBe("E:/code/a.ts");
    });

    it("drops trailing punctuation", () => {
        expect(repairAgentPathText("E:/code/a.html。")).toBe("E:/code/a.html");
        expect(repairAgentPathText("E:/code/a.html,")).toBe("E:/code/a.html");
    });

    it("normalizes backslashes and unwraps vscode://file links", () => {
        expect(repairAgentPathText("E:\\code\\a.html")).toBe("E:/code/a.html");
        expect(repairAgentPathText("vscode://file/E:/code/a.ts")).toBe("E:/code/a.ts");
    });

    it("leaves percent-encoded file URLs encoded for the URL parser", () => {
        expect(repairAgentPathText("file:///E:/code/x%20y.html")).toBe("file:///E:/code/x%20y.html");
    });
});

describe("parseAgentPathRef", () => {
    it("parses a standard file URL into a native path", () => {
        expect(parseAgentPathRef("file:///E:/code/a.html")).toMatchObject({
            kind: "file",
            filePath: "E:/code/a.html",
            refText: "E:/code/a.html",
        });
    });

    it("parses a repaired broken file URL", () => {
        expect(parseAgentPathRef("file///E:/code/a.html")).toMatchObject({
            kind: "file",
            filePath: "E:/code/a.html",
        });
    });

    it("parses a bare Windows path with double slash", () => {
        expect(parseAgentPathRef("E://primary/a.html")).toMatchObject({
            kind: "file",
            filePath: "E:/primary/a.html",
        });
    });

    it("parses a parenthesized placeholder path", () => {
        expect(parseAgentPathRef("(E://xxxx)")).toMatchObject({ kind: "file", filePath: "E:/xxxx" });
    });

    it("keeps the line number of a relative reference", () => {
        expect(parseAgentPathRef("src/foo.ts:12")).toMatchObject({
            kind: "file",
            filePath: "src/foo.ts",
            lineNumber: 12,
        });
    });

    it("classifies http links", () => {
        expect(parseAgentPathRef("https://example.com/x")).toMatchObject({
            kind: "http",
            url: "https://example.com/x",
        });
    });

    it("rejects unsafe schemes", () => {
        expect(parseAgentPathRef("javascript:alert(1)")).toMatchObject({ kind: "other" });
    });

    it("returns null for text that is not a path", () => {
        expect(parseAgentPathRef("hello world")).toBeNull();
        expect(parseAgentPathRef("and/or")).toBeNull();
        expect(parseAgentPathRef("1.5/2")).toBeNull();
        expect(parseAgentPathRef("")).toBeNull();
    });
});
