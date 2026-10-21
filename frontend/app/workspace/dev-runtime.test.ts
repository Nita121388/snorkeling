import { describe, expect, test } from "vitest";
import { formatAppDebugCopy, formatCdpCopy, formatDevRuntimeCopy } from "./dev-runtime";

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
Versions: Electron 36.3.0 · Node 22.5.0
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

    test("includes electron and node versions", () => {
        const text = formatDevRuntimeCopy(makeRuntime());
        expect(text).toContain("Versions: Electron 36.3.0 · Node 22.5.0");
    });

    test("omits the versions line when unavailable", () => {
        const text = formatDevRuntimeCopy(makeRuntime({ electronVersion: null, nodeVersion: null }));
        expect(text).not.toContain("Versions:");
    });
});

function makeDebugInfo(overrides: Partial<AppDebugInfo> = {}): AppDebugInfo {
    const runtime = makeRuntime();
    return {
        generatedAt: "2026-01-15T12:00:00.000Z",
        devRuntime: runtime,
        app: {
            name: "Snorkeling",
            version: "0.14.6-beta.0.snorkeling.0.0.98",
            buildTime: Date.UTC(2026, 0, 15, 12, 0, 0),
            isPackaged: false,
            isDev: true,
        },
        runtime: {
            platform: "win32",
            arch: "x64",
            electron: "36.3.0",
            chrome: "136.0.7103.49",
            node: "22.14.0",
            v8: "13.6.233.17",
        },
        updater: {
            status: null,
            channel: "beta",
            autoCheckEnabled: true,
            intervalms: 3_600_000,
            lastUpdateCheck: "2026-01-15T06:00:00.000Z",
            updateSupport: { supported: true },
            availableUpdateReleaseName: null,
        },
        paths: {
            home: "/home/nita",
            data: "/home/nita/.runcfg/cdp/data",
            config: "/home/nita/.runcfg/cdp/config",
            logFile: "/home/nita/.runcfg/cdp/data/waveapp.log",
        },
        logs: {
            waveapp: { path: "/home/nita/.runcfg/cdp/data/waveapp.log", exists: true, size: 2048 },
        },
        ...overrides,
    };
}

describe("formatAppDebugCopy", () => {
    test("emits a single copyable dump with app, runtime, dev and paths sections", () => {
        const text = formatAppDebugCopy(makeDebugInfo());
        expect(text.startsWith("Snorkeling Debug Info\n")).toBe(true);
        expect(text).toContain("Generated: 2026-01-15T12:00:00.000Z");
        expect(text).toContain(
            "App: Snorkeling 0.14.6-beta.0.snorkeling.0.0.98 (built 2026-01-15T12:00:00.000Z, dev, unpackaged)"
        );
        expect(text).toContain(
            "Runtime: win32 x64 · Electron 36.3.0 · Chrome 136.0.7103.49 · Node 22.14.0 · V8 13.6.233.17"
        );
        expect(text).toContain("Dev Runtime:");
        expect(text).toContain("Branch: main");
        expect(text).toContain("CDP: http://127.0.0.1:9224 (requested 9222)");
        expect(text).toContain("Home: /home/nita");
        expect(text).toContain("Data: /home/nita/.runcfg/cdp/data");
        expect(text).toContain("Log: /home/nita/.runcfg/cdp/data/waveapp.log");
        expect(text).toContain(
            "Updater: channel beta · auto check on (1h) · last check 2026-01-15T06:00:00.000Z"
        );
    });

    test("does not duplicate app version and run dirs inside the dev section", () => {
        const text = formatAppDebugCopy(makeDebugInfo());
        expect(text).not.toContain("App: 0.14.6");
        expect(text).not.toContain("Config: /home/nita/.runcfg/cdp/config\nConfig:");
        expect(text.match(/Data: /g)?.length).toBe(1);
    });

    test("omits the log tail unless explicitly requested", () => {
        const info = makeDebugInfo();
        info.logs.waveapp.tail = "line one\nline two";
        expect(formatAppDebugCopy(info)).not.toContain("line one");
        const withTail = formatAppDebugCopy(info, { includeLogTail: true });
        expect(withTail).toContain("Log tail (");
        expect(withTail).toContain("line one\nline two");
    });

    test("reports a missing log file instead of an empty block", () => {
        const info = makeDebugInfo();
        info.logs.waveapp = { path: "/nope.log", exists: false };
        const text = formatAppDebugCopy(info, { includeLogTail: true });
        expect(text).toContain("<log file not found>");
    });

    test("surfaces a log read error", () => {
        const info = makeDebugInfo();
        info.logs.waveapp = { path: "/nope.log", exists: true, error: "EACCES" };
        expect(formatAppDebugCopy(info, { includeLogTail: true })).toContain("<error: EACCES>");
    });

    test("skips the dev section when not running under the dev launcher", () => {
        const text = formatAppDebugCopy(makeDebugInfo({ devRuntime: null }));
        expect(text).not.toContain("Dev Runtime:");
        expect(text).not.toContain("Branch:");
        expect(text).toContain("App: Snorkeling");
    });

    test("formats the auto-check interval in the largest whole unit", () => {
        expect(formatAppDebugCopy(makeDebugInfo())).toContain("auto check on (1h)");
        const minutes = makeDebugInfo();
        minutes.updater.intervalms = 180_000;
        expect(formatAppDebugCopy(minutes)).toContain("auto check on (3m)");
        const seconds = makeDebugInfo();
        seconds.updater.intervalms = 45_000;
        expect(formatAppDebugCopy(seconds)).toContain("auto check on (45s)");
    });

    test("notes when updates are unsupported", () => {
        const info = makeDebugInfo();
        info.updater.updateSupport = { supported: false, reason: "no app-update.yml" };
        expect(formatAppDebugCopy(info)).toContain("update unsupported: no app-update.yml");
    });

    test("omits a zero or invalid build time instead of printing 1970", () => {
        const info = makeDebugInfo();
        info.app.buildTime = 0;
        const text = formatAppDebugCopy(info);
        expect(text).toContain("App: Snorkeling");
        expect(text).not.toContain("built");
    });

    test("omits the paths block when no paths are available", () => {
        const info = makeDebugInfo();
        (info as { paths: unknown }).paths = null;
        const text = formatAppDebugCopy(info);
        expect(text).not.toContain("Home:");
        expect(text).toContain("Dev Runtime:");
    });
});
