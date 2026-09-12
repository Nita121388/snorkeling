// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocTitle } from "./doc-title";

describe("DocTitle", () => {
    it("renders the fallback title text", () => {
        const html = renderToStaticMarkup(<DocTitle title="自定义命令片段-Snippets-" />);
        expect(html).toContain("md-props-doc-title");
        expect(html).toContain("自定义命令片段-Snippets-");
    });

    it("renders an empty string title without crashing", () => {
        const html = renderToStaticMarkup(<DocTitle title="" />);
        expect(html).toContain("md-props-doc-title");
    });
});
