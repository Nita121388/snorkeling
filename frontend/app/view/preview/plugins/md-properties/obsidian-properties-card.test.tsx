// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import { ObsidianPropertiesCard } from "./obsidian-properties-card";

function block(content: string): MarkdownContentBlockType {
    return { type: "obsidian-props", id: "obsidian-props[fm]", content };
}

function renderCard(yaml: string): string {
    return renderToStaticMarkup(<ObsidianPropertiesCard block={block(yaml)} />);
}

describe("ObsidianPropertiesCard rendering", () => {
    it("renders property rows with key names", () => {
        const html = renderCard("title: Hello\ntags: [\"#coding\"]\n");
        expect(html).toContain("obsidian-props-card");
        expect(html).toContain("title");
        expect(html).toContain("Hello");
    });

    it("renders tag chip with is-tag class", () => {
        const html = renderCard("tags: [\"#coding\"]");
        expect(html).toContain("is-tag");
        expect(html).toContain("#coding");
    });

    it("renders list chips", () => {
        const html = renderCard("aliases: [\"A\", \"B\"]");
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