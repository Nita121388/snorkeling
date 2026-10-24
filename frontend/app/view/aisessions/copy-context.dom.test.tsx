// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy Context DOM 契约的集成测试（jsdom）。
//
// 单测覆盖格式化；这里覆盖「属性 → resolver → 菜单项文本」的接线，
// 重点是旧契约（data-copy-context-path + data-source-line）不能被回归。
//
// @vitest-environment jsdom

import { clearSessionContextResolvers, registerSessionContextResolver } from "@/app/element/copy-context-contract";
import { getCopyContextTextFromDom } from "@/app/element/selection-copy-overlay";
import { afterEach, describe, expect, it } from "vitest";
import { formatSessionContext, makeSessionContextResolver } from "./copy-context";
import { sessionContextAttrs } from "@/app/element/copy-context-contract";

function setDom(html: string): void {
    document.body.innerHTML = html;
}

function selectNodeText(node: Node): Selection {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection;
}

afterEach(() => {
    clearSessionContextResolvers();
    document.body.innerHTML = "";
});

describe("getCopyContextTextFromDom — session contract", () => {
    it("resolves provenance for a session message selection", () => {
        registerSessionContextResolver(
            "sess-1",
            makeSessionContextResolver(() => ({
                summary: { id: "sess-1", source: "claude", title: "T" },
                messages: [{ seq: 7, role: "assistant", text: "a" }],
                seqRange: null,
            }))
        );
        setDom(
            `<div ${Object.entries(sessionContextAttrs({ sessionId: "sess-1", seq: 7, role: "assistant" }))
                .map(([k, v]) => `${k}='${v.replace(/'/g, "&apos;")}'`)
                .join(" ")}><p>a</p></div>`
        );
        const text = getCopyContextTextFromDom(selectNodeText(document.querySelector("p")!));
        expect(text).toContain("session-id: sess-1");
        expect(text).toContain("message-seq: 7");
    });

    it("returns null when no resolver is registered", () => {
        setDom(
            `<div ${Object.entries(sessionContextAttrs({ sessionId: "nope", seq: 1 }))
                .map(([k, v]) => `${k}='${v}'`)
                .join(" ")}><p>x</p></div>`
        );
        expect(getCopyContextTextFromDom(selectNodeText(document.querySelector("p")!))).toBeNull();
    });

    it("ignores malformed meta payloads", () => {
        setDom(`<div data-copy-context-kind="aisession" data-copy-context-meta="{oops"><p>x</p></div>`);
        expect(getCopyContextTextFromDom(selectNodeText(document.querySelector("p")!))).toBeNull();
    });

    it("ignores an unknown kind instead of guessing", () => {
        setDom(`<div data-copy-context-kind="agentterm" data-copy-context-meta='{"sessionId":"z"}'><p>x</p></div>`);
        expect(getCopyContextTextFromDom(selectNodeText(document.querySelector("p")!))).toBeNull();
    });
});

describe("getCopyContextTextFromDom — file contract (regression)", () => {
    it("still resolves the file + source line branch unchanged", () => {
        setDom(
            `<div data-copy-context-path="E:\\a.ts"><span data-source-line="12">hello world</span></div>`
        );
        const text = getCopyContextTextFromDom(selectNodeText(document.querySelector("span")!));
        expect(text).toBe("E:\\a.ts:12\n```markdown\nhello world\n```");
    });

    it("still returns null for a file root without a valid source line", () => {
        setDom(`<div data-copy-context-path="E:\\a.ts"><span>hello</span></div>`);
        expect(getCopyContextTextFromDom(selectNodeText(document.querySelector("span")!))).toBeNull();
    });
});

describe("entry point consistency", () => {
    it("the 💡 resolver emits byte-identical text to the hover button builder", () => {
        const summary = { id: "s", source: "claude", title: "T" };
        const messages = [
            { seq: 1, role: "user", text: "q" },
            { seq: 2, role: "assistant", text: "a" },
        ];
        // Hover path: built straight from the model for one message.
        const hover = formatSessionContext({ summary, messages, seqStart: 2, seqEnd: 2, selectedText: "a" });

        // 💡 path: DOM annotation → resolver registry → formatter.
        registerSessionContextResolver("s", makeSessionContextResolver(() => ({ summary, messages, seqRange: null })));
        setDom(
            `<div ${Object.entries(sessionContextAttrs({ sessionId: "s", seq: 2 }))
                .map(([k, v]) => `${k}='${v.replace(/'/g, "&apos;")}'`)
                .join(" ")}><p>a</p></div>`
        );
        const overlay = getCopyContextTextFromDom(selectNodeText(document.querySelector("p")!));
        expect(overlay).toBe(hover);
    });
});
