// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { PlatformWindows, setPlatform } from "@/util/platformutil";
import {
    fileUrlToNativePath,
    isFileUrl,
    terminalFilePath,
    terminalLinkHint,
    TerminalLinkRegex,
} from "./term-file-url";

const CjkAnswerUrl =
    "file:///E:/code/snorkeling/docs/answers/vcs-%E4%B8%AD%E6%96%87%E8%B7%AF%E5%BE%84%E4%B9%B1%E7%A0%81-20261022-145411.html";

function matchLink(text: string): string | null {
    const regex = new RegExp(TerminalLinkRegex.source, "g");
    return regex.exec(text)?.[0] ?? null;
}

describe("fileUrlToNativePath", () => {
    it("maps a Windows drive path", () => {
        expect(fileUrlToNativePath("file:///E:/code/snorkeling/docs/answers/a.html")).toBe(
            "E:/code/snorkeling/docs/answers/a.html"
        );
    });

    it("decodes percent-encoded CJK segments", () => {
        expect(fileUrlToNativePath(CjkAnswerUrl)).toBe(
            "E:/code/snorkeling/docs/answers/vcs-中文路径乱码-20261022-145411.html"
        );
    });

    it("decodes raw CJK segments", () => {
        expect(fileUrlToNativePath("file:///E:/code/snorkeling/docs/answers/vcs-中文路径乱码.html")).toBe(
            "E:/code/snorkeling/docs/answers/vcs-中文路径乱码.html"
        );
    });

    it("keeps a POSIX path as is", () => {
        expect(fileUrlToNativePath("file:///home/me/a.txt")).toBe("/home/me/a.txt");
    });

    it("maps a UNC host to a Windows UNC path when the host is included", () => {
        expect(fileUrlToNativePath("file://server/share/x.txt", { includeHost: true })).toBe(
            "\\\\server\\share\\x.txt"
        );
    });

    it("ignores the host by default", () => {
        expect(fileUrlToNativePath("file://myhost/home/me/a.txt")).toBe("/home/me/a.txt");
    });

    it("treats localhost as a local path", () => {
        expect(fileUrlToNativePath("file://localhost/E:/code/a.txt", { includeHost: true })).toBe(
            "E:/code/a.txt"
        );
    });

    it("returns null for a non-file URL", () => {
        expect(fileUrlToNativePath("https://example.com/a.html")).toBeNull();
    });

    it("returns null for a malformed URL", () => {
        expect(fileUrlToNativePath("not a url")).toBeNull();
    });

    it("returns null for an empty string", () => {
        expect(fileUrlToNativePath("")).toBeNull();
    });

    it("keeps the raw path when the percent encoding is broken", () => {
        expect(fileUrlToNativePath("file:///E:/code/100%.txt")).toBe("E:/code/100%.txt");
    });
});

describe("isFileUrl", () => {
    it("accepts file URLs", () => {
        expect(isFileUrl(CjkAnswerUrl)).toBe(true);
    });

    it("rejects other protocols", () => {
        expect(isFileUrl("https://example.com")).toBe(false);
        expect(isFileUrl("")).toBe(false);
    });
});

describe("terminalFilePath", () => {
    it("ignores the host on non-Windows platforms", () => {
        expect(terminalFilePath("file://server/share/x.txt")).toBe("/share/x.txt");
    });

    it("keeps the host as a UNC share on Windows", () => {
        setPlatform(PlatformWindows);
        try {
            expect(terminalFilePath("file://server/share/x.txt")).toBe("\\\\server\\share\\x.txt");
        } finally {
            setPlatform("darwin");
        }
    });
});

describe("TerminalLinkRegex", () => {
    it("has no global flag so the addon can append one", () => {
        expect(TerminalLinkRegex.flags).not.toContain("g");
    });

    it("matches a file URL with CJK characters", () => {
        expect(matchLink(`打开 ${CjkAnswerUrl}`)).toBe(CjkAnswerUrl);
    });

    it("matches a raw CJK file URL", () => {
        const raw = "file:///E:/code/snorkeling/docs/answers/vcs-中文路径乱码-20261022-145411.html";
        expect(matchLink(raw)).toBe(raw);
    });

    it("does not match a profile URL", () => {
        expect(matchLink("see profile://example.com/x")).toBeNull();
    });

    it("keeps trailing punctuation out of the link", () => {
        expect(matchLink("open file:///E:/a.html.")).toBe("file:///E:/a.html");
        expect(matchLink("open file:///E:/a.html, then")).toBe("file:///E:/a.html");
    });

    it("still matches https URLs", () => {
        expect(matchLink("visit https://example.com/a")).toBe("https://example.com/a");
    });

    it("matches a UNC file URL", () => {
        expect(matchLink("file://server/share/x.txt")).toBe("file://server/share/x.txt");
    });
});

describe("terminalLinkHint", () => {
    it("mentions the default app for file URLs", () => {
        expect(terminalLinkHint(CjkAnswerUrl, "Ctrl")).toBe("Ctrl-click to open in default app");
    });

    it("keeps the link wording for http URLs", () => {
        expect(terminalLinkHint("https://example.com", "Ctrl")).toBe("Ctrl-click to open link");
    });
});
