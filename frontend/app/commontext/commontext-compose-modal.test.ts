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

    it("offers a tag-row action to dismiss editor-based filtering", () => {
        expect(source).toContain("editorFilterDismissed");
        expect(source).toContain("fa fa-solid fa-filter-circle-xmark");
        expect(source).toContain('aria-label="Show all common text"');
        expect(source).toContain("Cancel editor-based filtering");
    });
});
