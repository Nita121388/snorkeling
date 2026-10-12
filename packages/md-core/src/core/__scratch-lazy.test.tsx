// scratch: verify lazy host component resolves before first render
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { getMdHost } from "./host";
import { getMarkdownRenderer, registerBuiltinRenderers } from "../render/renderer-registry";

registerBuiltinRenderers();

describe("scratch", () => {
    it("table renderer uses host TableBlock (wrapper div carries data-block-id)", () => {
        const spec = getMarkdownRenderer("table")!;
        const ctx: any = {
            collapsedTables: new Set(),
            toggleTableCollapse: () => {},
        };
        const props: any = { node: { position: { start: { line: 1 }, end: { line: 3 } } }, "data-block-id": "blk-x-0", children: "x" };
        const html = renderToStaticMarkup(spec.render(props, ctx) as any);
        console.log("HTML>>>", html);
        console.log("components>>>", Object.keys(getMdHost().components));
        expect(html).toContain("<table");
    });
});
