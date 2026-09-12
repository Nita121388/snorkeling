// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// emain-open.ts imports ./emain-log and ./emain-window for a couple of symbols;
// mocking them keeps the test from pulling in the heavy emain-platform graph
// (and the real electron module). The electron namespace import in emain-open
// is never dereferenced at runtime, so an empty mock is enough.
vi.mock("electron", () => ({}));
vi.mock("./emain-log", () => ({ log: vi.fn() }));
vi.mock("./emain-window", () => ({
    focusedWaveWindow: null,
    getAllWaveWindows: () => [],
}));

import { extractOpenPathsFromArgv, normalizeExternalOpenArg } from "./emain-open";

let tempDir: string | null = null;
function makeTempFile(): string {
    if (tempDir == null) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "emain-open-"));
    }
    const p = path.join(tempDir, `file-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(p, "x");
    return p;
}

afterEach(() => {
    if (tempDir != null) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = null;
    }
});

describe("normalizeExternalOpenArg", () => {
    it("rejects empty and whitespace-only args", () => {
        expect(normalizeExternalOpenArg(null)).toBeNull();
        expect(normalizeExternalOpenArg(undefined)).toBeNull();
        expect(normalizeExternalOpenArg("")).toBeNull();
        expect(normalizeExternalOpenArg("   ")).toBeNull();
    });

    it("rejects switch-style args (flags/options)", () => {
        expect(normalizeExternalOpenArg("--dev")).toBeNull();
        expect(normalizeExternalOpenArg("-x")).toBeNull();
        expect(normalizeExternalOpenArg("--remote-debugging-port=9222")).toBeNull();
        expect(normalizeExternalOpenArg("--inspect=9229")).toBeNull();
    });

    it("strips surrounding quotes", () => {
        const abs = path.resolve("some file.txt");
        expect(normalizeExternalOpenArg(`"${abs}"`)).toBe(abs);
        expect(normalizeExternalOpenArg(`'${abs}'`)).toBe(abs);
    });

    it("resolves relative paths to absolute", () => {
        const result = normalizeExternalOpenArg("somefile.txt");
        expect(result).toBe(path.resolve("somefile.txt"));
    });
});

describe("extractOpenPathsFromArgv", () => {
    it("skips argv[0] (the app's own executable path)", () => {
        const ownExec = process.execPath;
        const target = makeTempFile();
        const paths = extractOpenPathsFromArgv([ownExec, target]);
        expect(paths).toEqual([target]);
    });

    it("skips process.execPath even when it appears at a non-zero index", () => {
        const ownExec = process.execPath;
        const target = makeTempFile();
        const paths = extractOpenPathsFromArgv(["node", ownExec, target]);
        expect(paths).toEqual([target]);
    });

    it("does not open the running binary when it is the only arg", () => {
        expect(extractOpenPathsFromArgv([process.execPath])).toEqual([]);
    });

    it("ignores flag args and non-existent paths", () => {
        const target = makeTempFile();
        const missing = path.join(tempDir!, "does-not-exist.txt");
        const paths = extractOpenPathsFromArgv(["--dev", missing, target]);
        expect(paths).toEqual([target]);
    });

    it("returns [] for empty or null argv", () => {
        expect(extractOpenPathsFromArgv([])).toEqual([]);
        expect(extractOpenPathsFromArgv(null as unknown as string[])).toEqual([]);
    });
});