import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./commontext-compose-modal.tsx", import.meta.url), "utf8");

describe("CommonTextComposeModal hook order", () => {
    it("keeps the closed-state return after the detail auto-save effect", () => {
        const closedReturnIndex = source.lastIndexOf("if (!state.open) return null;");
        const detailSaveEffectIndex = source.indexOf(
            "}, [state.detailDirty, state.detailTitle, state.detailText, state.detailId]);"
        );

        expect(closedReturnIndex).toBeGreaterThan(detailSaveEffectIndex);
    });

    it("renders a direction-neutral focused-target insert action in each suggestion row", () => {
        expect(source).toContain('className="item-insert-btn');
        expect(source).toContain("fa fa-regular fa-paste");
        expect(source).toContain("event.stopPropagation()");
        expect(source).toContain("insertOrCopyCommonText(item.text)");
        expect(source).toContain('"Copied (no target)"');
    });

    it("offers an action-row button to dismiss editor-based filtering", () => {
        expect(source).toContain("editorFilterDismissed");
        expect(source).toContain("fa fa-solid fa-filter");
        expect(source).toContain("Stop filtering by editor content");
        expect(source).toContain("editorFilterDismissed: !state.editorFilterDismissed");
    });

    it("offers an untagged-only filter chip in the tag row", () => {
        expect(source).toContain("toggleUntagged");
        expect(source).toContain("untaggedOnly");
        expect(source).toContain(">untagged</span>");
        expect(source).toContain('title="Show items with no tags"');
        // 与具体 tag 选择互斥：选 tag 时退出无标签筛选
        expect(source).toContain("untaggedOnly: false, selectedIndex: 0");
    });
});
