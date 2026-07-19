import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const secrets = readFileSync(new URL("./secretscontent.tsx", import.meta.url), "utf8");
const config = readFileSync(new URL("./waveconfig.tsx", import.meta.url), "utf8");
const sessions = [
    readFileSync(new URL("../aisessions/session-row.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../aisessions/session-detail.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../aisessions/controls.tsx", import.meta.url), "utf8"),
].join("\n");

describe("Wave Config and disabled-state contracts", () => {
    it("keeps secret surfaces on semantic theme tokens", () => {
        expect(secrets).not.toMatch(/(?:bg|text|border|divide)-(?:zinc|gray|white|black)(?:-|\/|\b)/);
        expect(config).not.toContain("bg-black/50");
        expect(config).not.toContain("hover:bg-black/20");
    });

    it("uses the default cursor for disabled controls", () => {
        expect(secrets).not.toContain("cursor-not-allowed");
        expect(sessions).not.toContain("cursor-not-allowed");
    });
});
