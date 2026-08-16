// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
    ObsidianPropertiesCard,
    getObsidianPropsCollapsed,
    parsePropertyEditString,
    propertyValueToEditString,
    setObsidianPropsCollapsed,
} from "./obsidian-properties-card";

function block(content: string): MarkdownContentBlockType {
    return { type: "obsidian-props", id: "obsidian-props[fm]", content };
}

function renderCard(yaml: string, props?: { collapsedSeed?: boolean }): string {
    return renderToStaticMarkup(<ObsidianPropertiesCard block={block(yaml)} {...props} />);
}

describe("ObsidianPropertiesCard rendering", () => {
    it("renders property rows with key names", () => {
        const html = renderCard('title: Hello\ntags: ["#coding"]\n');
        expect(html).toContain("obsidian-props-card");
        expect(html).toContain("title");
        expect(html).toContain("Hello");
    });

    it("renders tag chip with is-tag class", () => {
        const html = renderCard('tags: ["#coding"]');
        expect(html).toContain("is-tag");
        expect(html).toContain("#coding");
    });

    it("renders list chips", () => {
        const html = renderCard('aliases: ["A", "B"]');
        expect(html).toContain("obsidian-props-chips");
        expect(html).toContain("A");
        expect(html).toContain("B");
    });

    it("renders boolean value", () => {
        const html = renderCard("draft: true");
        expect(html).toContain("obsidian-props-boolean");
        expect(html).toContain("true");
    });

    it("renders json value", () => {
        const yaml = "meta: {key: 1}";
        const html = renderCard(yaml);
        expect(html).toContain("obsidian-props-json");
        expect(html).toContain("key");
    });

    it("renders empty frontmatter header without crashing", () => {
        const html = renderCard("");
        expect(html).toContain("obsidian-props-header");
        expect(html).toContain("0");
        // No row elements
        expect(html).not.toContain("obsidian-props-row");
    });
});
describe("property edit value helpers", () => {
    const entry = (
        over: Partial<import("./frontmatter-block").PropertyEntry> = {}
    ): import("./frontmatter-block").PropertyEntry => ({
        key: "k",
        type: "text",
        value: "v",
        ...over,
    });

    it("formats list/tags as comma-joined string", () => {
        expect(propertyValueToEditString(entry({ type: "list", value: ["a", "b"] }))).toBe("a, b");
        expect(propertyValueToEditString(entry({ type: "tags", value: ["#x", "#y"] }))).toBe("#x, #y");
    });

    it("formats json compactly", () => {
        expect(propertyValueToEditString(entry({ type: "json", value: { a: 1 } }))).toBe('{"a":1}');
    });

    it("parses comma-separated input back to arrays", () => {
        expect(parsePropertyEditString(entry({ type: "list" }), "a, b, c")).toEqual(["a", "b", "c"]);
        expect(parsePropertyEditString(entry({ type: "tags" }), " #x, #y ")).toEqual(["#x", "#y"]);
        expect(parsePropertyEditString(entry({ type: "list" }), "  ")).toEqual([]);
    });

    it("parses number and json, falling back to raw text", () => {
        expect(parsePropertyEditString(entry({ type: "number" }), "42")).toBe(42);
        expect(parsePropertyEditString(entry({ type: "number" }), "abc")).toBe("abc");
        expect(parsePropertyEditString(entry({ type: "json" }), '{"x": 1}')).toEqual({ x: 1 });
        expect(parsePropertyEditString(entry({ type: "json" }), "not-json")).toBe("not-json");
    });

    it("keeps plain text values as-is (trimmed)", () => {
        expect(parsePropertyEditString(entry({ type: "text" }), " hello ")).toBe("hello");
    });
});

describe("ObsidianPropertiesCard collapse", () => {
    it("renders expanded by default with chevron-down", () => {
        const html = renderCard('title: A\ntags: ["#b"]');
        expect(html).toContain("fa-chevron-down");
        expect(html).toContain("obsidian-props-row");
        expect(html).not.toContain("fa-chevron-right");
    });

    it("collapsed header is clickable and hides rows (static render shows rows, interaction toggles)", () => {
        const html = renderCard("title: A");
        expect(html).toContain("obsidian-props-header");
    });

    it("collapsedSeed=true renders collapsed (no rows, chevron-right)", () => {
        const html = renderCard('title: A\ntags: ["#b"]', { collapsedSeed: true });
        expect(html).toContain("fa-chevron-right");
        expect(html).not.toContain("fa-chevron-down");
        expect(html).not.toContain("obsidian-props-row");
        expect(html).toContain("is-collapsed");
    });

    it("collapsedSeed=false still renders expanded", () => {
        const html = renderCard("title: A", { collapsedSeed: false });
        expect(html).toContain("fa-chevron-down");
        expect(html).toContain("obsidian-props-row");
    });
});

describe("obsidian-props collapsed persistence cache", () => {
    it("returns false for unknown keys", () => {
        expect(getObsidianPropsCollapsed("ghost-block")).toBe(false);
    });

    it("round-trips set/get per key independently", () => {
        setObsidianPropsCollapsed("block-a", true);
        setObsidianPropsCollapsed("block-b", false);
        expect(getObsidianPropsCollapsed("block-a")).toBe(true);
        expect(getObsidianPropsCollapsed("block-b")).toBe(false);
    });

    it("overwrites previous value", () => {
        setObsidianPropsCollapsed("block-c", true);
        setObsidianPropsCollapsed("block-c", false);
        expect(getObsidianPropsCollapsed("block-c")).toBe(false);
    });
});
