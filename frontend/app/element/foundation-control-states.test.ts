import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("foundational control state contracts", () => {
    it("uses the accent role for keyboard focus", () => {
        expect(files("button.scss")).toContain("outline: 2px solid var(--accent-color)");
        expect(files("iconbutton.scss")).toContain("outline: 2px solid var(--accent-color)");
        expect(files("input.scss")).toContain("var(--form-element-primary-color)");
        expect(files("multilineinput.scss")).toContain("var(--form-element-primary-color)");
        expect(files("toggle.scss")).toContain("input:focus-visible + .slider");
    });

    it("keeps disabled controls on the default cursor and exposes input errors", () => {
        expect(files("multilineinput.scss")).toContain("&:disabled");
        expect(files("toggle.scss")).toContain("input:disabled + .slider");
        expect(files("input.tsx")).toContain("aria-invalid={error || undefined}");
        expect(files("multilineinput.tsx")).toContain("aria-invalid={error || undefined}");
        expect(files("toggle.tsx")).toContain("aria-invalid={error || undefined}");
    });
});
