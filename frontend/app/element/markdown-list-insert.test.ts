import { describe, expect, it } from "vitest";
import { computeListInsertAnchor } from "./markdown";

const DOC = [
    "1. first",
    "2. second",
    "   continued line",
    "3. third",
    "",
    "some paragraph",
].join("\n");

describe("computeListInsertAnchor", () => {
    it("inserts after the WHOLE item for a multi-line middle item", () => {
        // item 2 spans lines 2..3 (soft-broken continuation)
        const anchor = computeListInsertAnchor(DOC, 2, "after");
        expect(anchor).not.toBeNull();
        // new sibling goes below line 3 (item end), NOT line 3 (which would tear the item)
        expect(anchor!.insertAtLine).toBe(4);
        expect(anchor!.prefillMarker).toBe("3. ");
    });

    it("inserts before the item start for 'before' on a middle item", () => {
        const anchor = computeListInsertAnchor(DOC, 2, "before");
        expect(anchor!.insertAtLine).toBe(2);
        // same number as the hovered item; source renumbering normalizes
        expect(anchor!.prefillMarker).toBe("2. ");
    });

    it("works for the first item", () => {
        const anchor = computeListInsertAnchor(DOC, 1, "after");
        expect(anchor!.insertAtLine).toBe(2);
        expect(anchor!.prefillMarker).toBe("2. ");
    });

    it("works for the last item", () => {
        const anchor = computeListInsertAnchor(DOC, 4, "after");
        expect(anchor!.insertAtLine).toBe(5);
        expect(anchor!.prefillMarker).toBe("4. ");
    });

    it("handles bullet lists", () => {
        const doc = "- alpha\n- beta";
        const anchor = computeListInsertAnchor(doc, 2, "after");
        expect(anchor!.insertAtLine).toBe(3);
        expect(anchor!.prefillMarker).toBe("- ");
    });

    it("returns null outside a list", () => {
        expect(computeListInsertAnchor(DOC, 6, "after")).toBeNull();
    });
});
