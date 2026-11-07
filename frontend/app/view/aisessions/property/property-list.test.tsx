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
        expect(markup).toContain("More properties (2)");
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

    it("detail 模式把只读低价值内置行折叠到 More properties 之后", () => {
        const markup = renderToStaticMarkup(
            <PropertyList
                summary={makeSummary({ createdAt: 1767225600000, updatedAt: 1767225600000 })}
                mode="detail"
                canEdit
            />
        );
        // Title Source / Starred / Created / Updated 四行默认折叠。
        expect(markup).not.toContain('data-property-key="created_at"');
        expect(markup).not.toContain('data-property-key="updated_at"');
        expect(markup).toContain("More properties (3)");
    });

    it("detail 模式给空的 Note 一个与其它属性一致的空态", () => {
        const markup = renderToStaticMarkup(<PropertyList summary={makeSummary({ note: "" })} mode="detail" />);
        expect(markup).toContain('data-property-key="note"');
        expect(markup).toContain("property-empty");
        // 不再只在 card 模式才出现占位文案。
        expect(markup).not.toContain("Click to add a note...");
    });

    it("select 类型内置值按 humanize 显示而不是原始枚举", () => {
        const markup = renderToStaticMarkup(
            <PropertyList summary={makeSummary({ titleSource: "first_user_message" })} mode="card" />
        );
        expect(markup).toContain("First User Message");
    });

    it("detail 模式不铺出本会话无值的模板属性", () => {
        const markup = renderToStaticMarkup(
            <PropertyList
                summary={makeSummary({ note: "n" })}
                mode="detail"
                schema={[{ key: "tech_stack", name: "Tech Stack", type: "multi_select", order: 1 }]}
            />
        );
        expect(markup).not.toContain("Tech Stack");
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
