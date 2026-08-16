import { describe, expect, it } from "vitest";
import { computeEditorMaxHeight, EDITOR_MAX_HEIGHT_MIN_PX } from "./commontext-editor-size";

describe("computeEditorMaxHeight", () => {
    it("scales the expanded editor cap with the modal height", () => {
        // 默认弹窗 620px：310px（比原来写死的 280px 更宽容）
        expect(computeEditorMaxHeight(620, 1400)).toBe(310);
        expect(computeEditorMaxHeight(900, 1400)).toBe(450);
        expect(computeEditorMaxHeight(1200, 1400)).toBe(600);
    });

    it("never drops below the 280px floor on small modals", () => {
        expect(computeEditorMaxHeight(350, 1400)).toBe(EDITOR_MAX_HEIGHT_MIN_PX);
        expect(computeEditorMaxHeight(100, 1400)).toBe(EDITOR_MAX_HEIGHT_MIN_PX);
    });

    it("caps at 55% of the viewport height so huge modals cannot eat the screen", () => {
        expect(computeEditorMaxHeight(2000, 1000)).toBe(550);
        expect(computeEditorMaxHeight(2000, 800)).toBe(440);
    });
});
