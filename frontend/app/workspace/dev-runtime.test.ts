import { describe, expect, test } from "vitest";
import { formatCdpCopy, formatDevRuntimeCopy } from "./dev-runtime";

function makeRuntime(overrides: Partial<DevRuntimeInfo> = {}): DevRuntimeInfo {
    return {
        profile: "cdp",
        gitBranch: "main",
        portMode: "auto",
        vite: { port: 51743, requestedPort: 51742, url: "http://127.0.0.1:51743" },
        cdp: { port: 9224, requestedPort: 9222, url: "http://127.0.0.1:9224" },
        cdpJsonUrl: "http://127.0.0.1:9224/json/version",
        inspectCommand: "node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:9224 state",
        appVersion: "0.14.6-beta.0.snorkeling.0.0.73",
        electronVersion: "36.3.0",
        nodeVersion: "22.5.0",
        dirs: {
            data: "/Users/nita/.runcfg/cdp/data",
            config: "/Users/nita/.runcfg/cdp/config",
            logFile: "/Users/nita/.runcfg/cdp/data/waveapp.log",
        },
        ...overrides,
    };
}

describe("formatCdpCopy", () => {
    test("returns the bare CDP URL for pasting", () => {
        expect(formatCdpCopy(makeRuntime())).toBe("http://127.0.0.1:9224");
    });

    test("marks CDP disabled", () => {
        expect(formatCdpCopy(makeRuntime({ cdp: null }))).toBe("CDP: Disabled");
    });
});

describe("formatDevRuntimeCopy", () => {
    test("includes branch, actual and requested ports plus CDP commands", () => {
        expect(formatDevRuntimeCopy(makeRuntime())).toBe(`Snorkeling Dev Runtime
Profile: cdp
Branch: main
Port mode: auto
Vite: http://127.0.0.1:51743 (requested 51742)
CDP: http://127.0.0.1:9224 (requested 9222)
App: 0.14.6-beta.0.snorkeling.0.0.73
Data: /Users/nita/.runcfg/cdp/data
Config: /Users/nita/.runcfg/cdp/config
Log: /Users/nita/.runcfg/cdp/data/waveapp.log
CDP JSON: http://127.0.0.1:9224/json/version
Inspect: node scripts/inspect-electron-ui.mjs --endpoint http://127.0.0.1:9224 state`);
    });

    test("falls back to n/a without a branch", () => {
        expect(formatDevRuntimeCopy(makeRuntime({ gitBranch: null }))).toContain("Branch: n/a\n");
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

    test("omits app version and dirs when unavailable", () => {
        const text = formatDevRuntimeCopy(
            makeRuntime({ appVersion: null, electronVersion: null, nodeVersion: null, dirs: null })
        );
        expect(text).not.toContain("App:");
        expect(text).not.toContain("Data:");
        expect(text).not.toContain("Config:");
        expect(text).not.toContain("Log:");
    });

    test("parts of the dump include the run folders", () => {
        const text = formatDevRuntimeCopy(
            makeRuntime({ dirs: { data: "/x/data", config: "/x/config", logFile: "/x/data/app.log" } })
        );
        expect(text).toContain("Data: /x/data");
        expect(text).toContain("Config: /x/config");
        expect(text).toContain("Log: /x/data/app.log");
    });
});
