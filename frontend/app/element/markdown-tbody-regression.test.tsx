// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// Regression: tight ordered-list item with <br/> + sub-<ul> must not render the body twice.

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { splitOrderedListItemChildren } from "./markdown";

describe("markdown preview tight ordered list body (regression)", () => {
    it("does not duplicate sub-list content in the body", () => {
        // Trailing-2-space hard breaks produce <br/> in tight lists.
        const src = [
            "1. AP - PR 曲线下面积  ",
            "   计算公式：...  ",
            "   取值范围：[0, 1]  ",
            "\t- 关注：排序能力",
            "\t- 含义：随机抽真阳性",
        ].join("\n");

        let captured: React.ReactNode[] | undefined;

        const components = {
            p: (props: any) => <div className="paragraph" {...props} />,
            li: (props: any) => {
                const flat = React.Children.toArray(props.children);
                const hasSubUl = flat.some(
                    (c) =>
                        React.isValidElement(c) &&
                        typeof c.type === "string" &&
                        (c.type === "ul" || c.type === "ol")
                );
                if (hasSubUl && captured == null) {
                    captured = flat;
                }
                return <li {...props} />;
            },
        };

        renderToStaticMarkup(
            <ReactMarkdown components={components as any}>{src}</ReactMarkdown>
        );

        expect(captured).toBeDefined();
        const split = splitOrderedListItemChildren(captured!);
        // canCollapse must be true (so the body container renders)
        expect(split.bodyChildren.length).toBeGreaterThan(0);

        const ulInBody = split.bodyChildren.filter(
            (c) => React.isValidElement(c) && c.type === "ul"
        );
        // The exact bug: previously this was 2 because the tight branch
        // appended childArray.slice(1) on top of an already-complete after.
        expect(ulInBody).toHaveLength(1);
    });
});
