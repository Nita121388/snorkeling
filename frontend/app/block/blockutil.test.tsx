import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeMagnifyButtonDecl } from "./blockutil";

describe("makeMagnifyButtonDecl", () => {
    it("uses the minimize icon direction when the action collapses a popup back to the tab", () => {
        const decl = makeMagnifyButtonDecl({
            magnified: true,
            toggleMagnify: vi.fn(),
            disabled: false,
            title: "Collapse to Tab",
        });

        expect(decl.title).toBe("Collapse to Tab");
        expect(isValidElement<{ enabled: boolean }>(decl.icon)).toBe(true);
        if (!isValidElement<{ enabled: boolean }>(decl.icon)) return;
        expect(decl.icon.props.enabled).toBe(true);
    });
});
