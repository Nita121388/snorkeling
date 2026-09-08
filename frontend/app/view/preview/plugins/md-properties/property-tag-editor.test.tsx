// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PropertyTagEditor, canCreateOption, filterOptions } from "./property-tag-editor";

function render(props: Partial<React.ComponentProps<typeof PropertyTagEditor>> = {}): string {
    return renderToStaticMarkup(
        <PropertyTagEditor
            items={["a", "b"]}
            onChange={() => undefined}
            onClose={() => undefined}
            {...props}
        />
    );
}

describe("filterOptions", () => {
    it("空输入返回全部候选", () => {
        expect(filterOptions(["a", "b", "c"], "")).toEqual(["a", "b", "c"]);
    });

    it("按包含匹配且忽略大小写", () => {
        expect(filterOptions(["Apple", "Banana", "app"], "APP")).toEqual(["Apple", "app"]);
    });

    it("保留已选项（Wolai 同行为）", () => {
        expect(filterOptions(["进行中", "已完成"], "进行")).toEqual(["进行中"]);
    });

    it("无匹配返回空数组（由调用方显示创建行）", () => {
        expect(filterOptions(["a"], "zzz")).toEqual([]);
    });
});

describe("canCreateOption", () => {
    it("空输入不创建", () => {
        expect(canCreateOption("", ["a"])).toBe(false);
        expect(canCreateOption("   ", ["a"])).toBe(false);
    });

    it("已存在同名项时不创建（忽略大小写）", () => {
        expect(canCreateOption("apple", ["Apple"])).toBe(false);
    });

    it("新值可创建", () => {
        expect(canCreateOption("zzz", ["a", "b"])).toBe(true);
    });
});

describe("PropertyTagEditor 渲染", () => {
    it("已选值渲染为 chip，且带颜色变量", () => {
        const html = render({ items: ["进行中"] });
        expect(html).toContain("ptag-chip");
        expect(html).toContain("进行中");
        expect(html).toContain("--ptag-base");
    });

    it("输入框与 chip 同在已选区（不是独立输入行）", () => {
        const html = render({ items: ["a"] });
        expect(html).toContain("ptag-selected");
        expect(html).toContain("ptag-input");
        expect(html.indexOf("ptag-input")).toBeGreaterThan(html.indexOf("ptag-selected"));
        expect(html.indexOf("ptag-input")).toBeLessThan(html.indexOf("ptag-list"));
    });

    it("候选列表渲染候选项", () => {
        const html = render({ items: ["a"], options: ["a", "b", "c"] });
        expect(html).toContain("ptag-list");
        expect(html).toContain(">b<");
        expect(html).toContain(">c<");
    });

    it("没有输入时不显示创建行", () => {
        const html = render({ items: [], options: ["a"] });
        expect(html).not.toContain("ptag-create-label");
    });
});
