import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const ThemeOwnedFiles = ["aipanel.tsx", "aipanelheader.tsx", "aipanelinput.tsx", "aimode.tsx", "byokannouncement.tsx"];

describe("AI panel theme and state contracts", () => {
    it.each(ThemeOwnedFiles)("keeps %s on semantic surface and content colors", (name) => {
        expect(source(name)).not.toMatch(/(?:bg|text|border)-(?:zinc|gray|white)(?:-|\b)/);
    });

    it("provides focus-visible treatment for panel controls", () => {
        expect(source("aipanelheader.tsx")).toContain("focus-visible:ring-1 focus-visible:ring-accent");
        expect(source("aipanelinput.tsx")).toContain("focus-visible:ring-1 focus-visible:ring-accent");
        expect(source("aimode.tsx")).toContain("focus-visible:ring-1");
        expect(source("byokannouncement.tsx")).toContain("focus-visible:ring-1 focus-visible:ring-accent");
    });

    it("keeps the BYOK announcement on the app accent family", () => {
        expect(source("byokannouncement.tsx")).not.toMatch(/(?:bg|text|border)-(?:blue|zinc|gray|white)-/);
    });
});
