import { describe, expect, test } from "vitest";
import { formatDevRuntimeCopy } from "./dev-runtime";

function makeRuntime(overrides: Partial<DevRuntimeInfo> = {}): DevRuntimeInfo {
    return {
        profile: "cdp",
        portMode: "auto",
        vite: { port: 51743, requestedPort: 51742, url: "http://127.0.0.1:51743" },
        cdp: { port: 9224, requestedPort: 9222, url: "http://127.0.0.1:9224" },
        cdpJsonUrl: "http://127.0.0.1:9224/json/version",
        inspectCommand: "node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:9224 state",
        ...overrides,
    };
}

describe("formatDevRuntimeCopy", () => {
    test("includes actual and requested ports plus CDP commands", () => {
        expect(formatDevRuntimeCopy(makeRuntime())).toBe(`Snorkeling Dev Runtime
Profile: cdp
Port mode: auto
Vite: http://127.0.0.1:51743 (requested 51742)
CDP: http://127.0.0.1:9224 (requested 9222)
CDP JSON: http://127.0.0.1:9224/json/version
Inspect: node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:9224 state`);
    });

    test("marks CDP disabled and omits CDP commands", () => {
        const text = formatDevRuntimeCopy(makeRuntime({ cdp: null, cdpJsonUrl: null, inspectCommand: null }));
        expect(text).toContain("CDP: Disabled");
        expect(text).not.toContain("CDP JSON:");
        expect(text).not.toContain("Inspect:");
    });

    test("omits requested port when it matches the actual port", () => {
        const text = formatDevRuntimeCopy(
            makeRuntime({ vite: { port: 51742, requestedPort: 51742, url: "http://127.0.0.1:51742" } })
        );
        expect(text).toContain("Vite: http://127.0.0.1:51742\n");
        expect(text).not.toContain("Vite: http://127.0.0.1:51742 (requested");
    });
});
