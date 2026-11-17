// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// resolveBoardPropRows — Overview 卡片自定义属性归一（红证/单测）。
//
// 判据：status/select 单值胶囊着色、多值 chips、checkbox、空值过滤、
// 内置 key 排除、order 排序、上限截断 + 溢出计数。纯函数，不触碰 DOM。

import { describe, expect, it } from "vitest";
import type { PropertyCell } from "@/app/view/aisessions/property/property-model";
import { resolveBoardPropRows } from "./overview-board-model";

function cell(value: PropertyCell["value"], extra: Partial<PropertyCell> = {}): PropertyCell {
    return { value, source: "user", updatedAt: 0, ...extra };
}

describe("resolveBoardPropRows", () => {
    it("returns empty for null / undefined / empty props", () => {
        expect(resolveBoardPropRows(null)).toEqual({ visible: [], hiddenCount: 0 });
        expect(resolveBoardPropRows(undefined)).toEqual({ visible: [], hiddenCount: 0 });
        expect(resolveBoardPropRows({})).toEqual({ visible: [], hiddenCount: 0 });
    });

    it("excludes builtin keys (note/tags/starred/title-source/dates)", () => {
        const props: Record<string, PropertyCell> = {
            note: cell("hello"),
            tags: cell(["a"]),
            starred: cell(true),
            titleSource: cell("user"),
            created_at: cell("2026-01-01"),
            updated_at: cell("2026-01-02"),
            status: cell("done", { type: "status" }),
        };
        const { visible } = resolveBoardPropRows(props);
        // note/tags/starred/title_source/created_at/updated_at 全被过滤，只剩自定义 status
        expect(visible.map((row) => row.key)).toEqual(["status"]);
    });

    it("renders status/select single value (hash-colored deterministically)", () => {
        const props: Record<string, PropertyCell> = {
            status: cell("进行中", { type: "status" }),
        };
        expect(resolveBoardPropRows(props).visible[0]).toMatchObject({
            key: "status",
            name: "Status",
            single: { value: "进行中" },
        });
    });

    it("maps the same value to the same color every time (9-tone palette)", () => {
        const colorOf = (key: string) => resolveBoardPropRows({ [key]: cell("done", { type: "status" }) }).visible[0].single?.color;
        expect(colorOf("a")).toBe(colorOf("a"));
        expect(colorOf("b")).toBe(colorOf("b"));
        const known = ["blue", "green", "yellow", "orange", "red", "purple", "pink", "brown", "gray"];
        expect(known).toContain(colorOf("status"));
    });

    it("renders multi_select as chips list", () => {
        const props: Record<string, PropertyCell> = {
            labels: cell(["a", "b"], { type: "multi_select" }),
        };
        const row = resolveBoardPropRows(props).visible[0];
        expect(row.multi).toEqual(["a", "b"]);
    });

    it("filters checkbox false, keeps true", () => {
        const props: Record<string, PropertyCell> = {
            off: cell(false, { type: "checkbox" }),
            on: cell(true, { type: "checkbox" }),
        };
        const { visible } = resolveBoardPropRows(props);
        expect(visible.map((row) => row.key)).toEqual(["on"]);
        expect(resolveBoardPropRows(props).visible[0].checked).toBe(true);
    });

    it("renders text/url/date/number as single-line text", () => {
        const props: Record<string, PropertyCell> = {
            owner: cell("chemclin", { type: "text" }),
            url: cell("https://example.com", { type: "url" }),
            count: cell(42, { type: "number" }),
        };
        expect(resolveBoardPropRows(props).visible).toMatchObject([
            { key: "owner", text: "chemclin" },
            { key: "url", text: "https://example.com" },
            { key: "count", text: "42" },
        ]);
    });

    it("filters empty values (null / empty string / empty array)", () => {
        const props: Record<string, PropertyCell> = {
            a: cell(null, { type: "text" }),
            b: cell("", { type: "text" }),
            c: cell([], { type: "multi_select" }),
            d: cell("keep", { type: "text" }),
        };
        expect(resolveBoardPropRows(props).visible.map((row) => row.key)).toEqual(["d"]);
    });

    it("sorts by order then insertion order", () => {
        const props: Record<string, PropertyCell> = {
            first: cell("1", { type: "text", order: 2 }),
            second: cell("2", { type: "text", order: 1 }),
            third: cell("3", { type: "text" }),
        };
        expect(resolveBoardPropRows(props).visible.map((row) => row.key)).toEqual([
            "second",
            "first",
            "third",
        ]);
    });

    it("caps visible rows and reports hidden count", () => {
        const props: Record<string, PropertyCell> = {};
        for (let i = 0; i < 5; i++) {
            props[`p${i}`] = cell(String(i), { type: "text", order: i + 1 });
        }
        expect(resolveBoardPropRows(props, undefined, 3)).toEqual({
            visible: [0, 1, 2].map((i) => ({ key: `p${i}`, name: `P${i}`, type: "text", text: String(i) })),
            hiddenCount: 2,
        });
    });

    it("falls back to humanized key when name is missing", () => {
        const props: Record<string, PropertyCell> = {
            my_custom_field: cell("x", { type: "text" }),
        };
        expect(resolveBoardPropRows(props).visible[0].name).toBe("My Custom Field");
    });
});