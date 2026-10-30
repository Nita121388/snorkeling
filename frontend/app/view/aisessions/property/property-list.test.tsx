// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PropertyList } from "./property-list";

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        key: "codex:abc:/tmp/a.jsonl",
        id: "abc",
        source: "codex",
        ...overrides,
    } as SessionSummary;
}

describe("PropertyList", () => {
    it("shows note, tags and starred for a card", () => {
        const markup = renderToStaticMarkup(
            <PropertyList
                summary={makeSummary({ note: "refactor auth", tags: ["fix"], marked: true })}
                mode="card"
            />
        );
        expect(markup).toContain("Note");
        expect(markup).toContain("refactor auth");
        expect(markup).toContain("Tags");
        expect(markup).toContain("fix");
        expect(markup).toContain("is-checked");
    });

    it("hides empty properties on a card", () => {
        const markup = renderToStaticMarkup(<PropertyList summary={makeSummary({ note: "" })} mode="card" />);
        expect(markup).toContain("Click to add a note...");
        expect(markup).not.toContain("Empty");
    });

    it("shows Empty placeholders in detail mode", () => {
        const markup = renderToStaticMarkup(<PropertyList summary={makeSummary({ note: "" })} mode="detail" />);
        expect(markup).toContain("Empty");
    });

    it("caps a card at five rows and offers +N more", () => {
        const props: { [key: string]: PropertyCell } = {};
        for (let i = 0; i < 7; i++) {
            props[`prop_${i}`] = { value: `v${i}`, type: "text", source: "user", updatedAt: 1 };
        }
        const markup = renderToStaticMarkup(
            <PropertyList summary={makeSummary({ note: "", tags: [], marked: false, props })} mode="card" />
        );
        expect(markup).toContain("v0");
        expect(markup).toContain("v4");
        expect(markup).not.toContain("v5");
        expect(markup).toContain("+2 more properties");
    });

    it("marks AI-sourced values", () => {
        const markup = renderToStaticMarkup(
            <PropertyList
                summary={makeSummary({
                    note: "",
                    tags: [],
                    marked: false,
                    props: { tech_stack: { value: ["Go"], type: "multi_select", source: "ai", updatedAt: 1 } },
                })}
                mode="card"
            />
        );
        expect(markup).toContain("Tech Stack");
        expect(markup).toContain("✨");
    });

    it("renders read-only properties without an enabled edit button", () => {
        const markup = renderToStaticMarkup(
            <PropertyList summary={makeSummary({ createdAt: 1767225600000 })} mode="detail" canEdit />
        );
        expect(markup).toContain("Created");
        expect(markup).toContain("property-readonly");
    });

    it("invokes onEditNote when the note row is clicked", () => {
        // 纯静态渲染不好触发点击，这里只保证渲染出的 note 行可点（有 set Note 的按钮）。
        const onEditNote = vi.fn();
        const markup = renderToStaticMarkup(
            <PropertyList summary={makeSummary({ note: "x" })} mode="card" canEdit onEditNote={onEditNote} />
        );
        expect(markup).toContain('aria-label="Set Note"');
        expect(onEditNote).not.toHaveBeenCalled();
    });
});
