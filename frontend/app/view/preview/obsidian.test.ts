// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Shaped per-call by tests; obsidian.ts only uses getApi().getPlatform / openExternal.
let mockPlatform: NodeJS.Platform = "darwin";
const openExternalMock = vi.fn<(url: string) => void>();
const pickDirectoryMock = vi.fn<() => Promise<string | null>>();
const obsidianReadVaultsMock = vi.fn<() => Promise<string[]>>();

type MockApi = {
    getPlatform: () => NodeJS.Platform;
    openExternal: (url: string) => void;
    pickDirectory: () => Promise<string | null>;
    obsidianReadVaults: () => Promise<string[]>;
};

// localStorage backed by a Map — obsidian.ts uses window.localStorage.{getItem,setItem,removeItem}.
const storage = new Map<string, string>();
const localStorageMock = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => {
        storage.set(key, value);
    },
    removeItem: (key: string) => {
        storage.delete(key);
    },
    clear: () => storage.clear(),
};

function makeMockApi(): MockApi {
    return {
        getPlatform: () => mockPlatform,
        openExternal: openExternalMock,
        pickDirectory: pickDirectoryMock,
        obsidianReadVaults: obsidianReadVaultsMock,
    };
}

async function importObsidian(overrides?: Partial<MockApi>) {
    vi.resetModules();
    vi.doMock("@/app/store/global", () => ({
        getApi: () => ({ ...makeMockApi(), ...overrides }),
    }));
    vi.stubGlobal("window", { localStorage: localStorageMock });
    return (await import("./obsidian")) as typeof import("./obsidian");
}

const FileSep = "snorkeling.obsidian.userVaults";

function setUserVaults(vaults: string[]) {
    storage.set(FileSep, JSON.stringify(vaults));
}

function clearUserVaults() {
    storage.delete(FileSep);
}

describe("obsidian integration", () => {
    beforeEach(() => {
        openExternalMock.mockReset();
        pickDirectoryMock.mockReset();
        obsidianReadVaultsMock.mockReset();
        obsidianReadVaultsMock.mockResolvedValue([]);
        storage.clear();
        mockPlatform = "darwin";
    });

    afterEach(() => {
        vi.doUnmock("@/app/store/global");
        vi.unstubAllGlobals();
    });


    describe("buildObsidianUri", () => {
        it("builds vault + file from a posix path inside a vault", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri("/Users/nita/Primary/obsidians/Obsidian/Inbox/2026-04-28.md", [
                "/Users/nita/Primary/obsidians/Obsidian",
            ]);
            expect(uri).toBe(
                "obsidian://open?vault=Obsidian&file=Inbox%2F2026-04-28.md"
            );
        });

        it("returns null when the file is not inside any known vault", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri("/home/some/other/file.md", ["/Users/nita/Primary/obsidians/Obsidian"]);
            expect(uri).toBeNull();
        });

        it("picks the most specific (longest-prefix) vault", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri(
                "/Users/nita/Primary/obsidians/Obsidian/Sub/note.md",
                [
                    "/Users/nita/Primary/obsidians/Obsidian", // vault named Obsidian
                    "/Users/nita/Primary/obsidians/Obsidian/Sub", // nested vault named Sub
                ]
            );
            expect(uri).toBe("obsidian://open?vault=Sub&file=note.md");
        });

        it("does not match a sibling prefix (/foo/ba vs /foo/bar)", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri("/Users/nita/vaults/bar/note.md", ["/Users/nita/vaults/ba"]);
            expect(uri).toBeNull();
        });

        it("encodes special characters in the file path", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri("/v/inbox/file with spaces & plus.md", ["/v"]);
            expect(uri).toBe("obsidian://open?vault=v&file=inbox%2Ffile%20with%20spaces%20%26%20plus.md");
        });

        it("appends line/column when provided", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri(
                "/v/note.md",
                ["/v"],
                { line: 42, column: 7 }
            );
            expect(uri).toBe("obsidian://open?vault=v&file=note.md&line=42&column=7");
        });

        it("appends only line when column is missing", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri("/v/note.md", ["/v"], { line: 10 });
            expect(uri).toBe("obsidian://open?vault=v&file=note.md&line=10");
        });
    });

    describe("buildObsidianUri — Windows paths", () => {
        beforeEach(() => {
            mockPlatform = "win32";
        });

        it("normalizes backslashes to forward slashes", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri(
                "C:\\Users\\nita\\Obsidian\\Inbox\\2026-04-28.md",
                ["C:\\Users\\nita\\Obsidian"]
            );
            expect(uri).toBe("obsidian://open?vault=Obsidian&file=Inbox%2F2026-04-28.md");
        });

        it("matches case-insensitively on win32", async () => {
            const mod = await importObsidian();
            const uri = mod.buildObsidianUri("c:\\users\\Nita\\Obsidian\\Inbox\\note.md", [
                "C:\\Users\\nita\\Obsidian",
            ]);
            expect(uri).toBe("obsidian://open?vault=Obsidian&file=Inbox%2Fnote.md");
        });
    });

    describe("openInObsidian", () => {
        it("returns 'no_button' when no vaults are known", async () => {
            const mod = await importObsidian();
            const r = mod.openInObsidian({ absPath: "/v/note.md", vaults: [] });
            expect(r).toBe("no_button");
            expect(openExternalMock).not.toHaveBeenCalled();
        });

        it("returns 'fallback_to_picker' when the file is not in any known vault", async () => {
            const mod = await importObsidian();
            const r = mod.openInObsidian({
                absPath: "/somewhere/else/note.md",
                vaults: ["/v"],
            });
            expect(r).toBe("fallback_to_picker");
            expect(openExternalMock).not.toHaveBeenCalled();
        });

        it("returns 'obsidian' and calls openExternal when the file is in a vault", async () => {
            const mod = await importObsidian();
            const r = mod.openInObsidian({ absPath: "/v/note.md", vaults: ["/v"] });
            expect(r).toBe("obsidian");
            expect(openExternalMock).toHaveBeenCalledTimes(1);
            expect(openExternalMock).toHaveBeenCalledWith("obsidian://open?vault=v&file=note.md");
        });
    });

    describe("user vaults (localStorage)", () => {
        it("getUserVaults reads previously-stored entries", async () => {
            setUserVaults(["/home/me/MyVault", "/home/me/Other"]);
            const mod = await importObsidian();
            expect(mod.getUserVaults()).toEqual(["/home/me/MyVault", "/home/me/Other"]);
        });

        it("getUserVaults returns [] on bad data", async () => {
            storage.set(FileSep, "not json");
            const mod = await importObsidian();
            expect(mod.getUserVaults()).toEqual([]);
        });

        it("addUserVaultAndOpen dedupes and persists then opens", async () => {
            setUserVaults(["/home/me/MyVault"]);
            const mod = await importObsidian();
            // first call: existing vault already matches the file
            const opened = await mod.addUserVaultAndOpen({
                absPath: "/home/me/MyVault/inbox/note.md",
                userVaultDir: "/home/me/MyVault",
            });
            expect(opened).toBe(true);
            expect(openExternalMock).toHaveBeenCalledTimes(1);
            // localStorage unchanged (no duplicate added)
            expect(mod.getUserVaults()).toEqual(["/home/me/MyVault"]);
        });

        it("addUserVaultAndOpen adds a brand-new user vault and opens through it", async () => {
            setUserVaults([]);
            const mod = await importObsidian();
            const opened = await mod.addUserVaultAndOpen({
                absPath: "/brand/new/vault/note.md",
                userVaultDir: "/brand/new/vault",
            });
            expect(opened).toBe(true);
            expect(openExternalMock).toHaveBeenCalledTimes(1);
            expect(mod.getUserVaults()).toEqual(["/brand/new/vault"]);
        });

        it("addUserVaultAndOpen rejects empty user dir", async () => {
            const mod = await importObsidian();
            const opened = await mod.addUserVaultAndOpen({
                absPath: "/v/note.md",
                userVaultDir: "  ",
            });
            expect(opened).toBe(false);
            expect(openExternalMock).not.toHaveBeenCalled();
        });
    });

    describe("isOpenableForObsidian", () => {
        it("returns true for a .md path when vaults are known", async () => {
            setUserVaults(["/v"]);
            const mod = await importObsidian();
            expect(mod.isOpenableForObsidian("/v/inbox/note.md", "text/markdown")).toBe(true);
        });

        it("returns true for a .mdx path by name when mime is null", async () => {
            setUserVaults(["/v"]);
            const mod = await importObsidian();
            expect(mod.isOpenableForObsidian("/v/note.mdx", null)).toBe(true);
        });

        it("returns false for a non-markdown file", async () => {
            setUserVaults(["/v"]);
            const mod = await importObsidian();
            expect(mod.isOpenableForObsidian("/v/sketch.png", "image/png")).toBe(false);
        });

        it("returns true for markdown files even when no vaults are known", async () => {
            clearUserVaults();
            const mod = await importObsidian();
            expect(mod.isOpenableForObsidian("/v/note.md", "text/markdown")).toBe(true);
        });

        it("returns false for empty/null path", async () => {
            setUserVaults(["/v"]);
            const mod = await importObsidian();
            expect(mod.isOpenableForObsidian("", "text/markdown")).toBe(false);
            expect(mod.isOpenableForObsidian(null as unknown as string, "text/markdown")).toBe(false);
        });
    });

    describe("openInObsidianWithPicker", () => {
        it("opens immediately if the vault is already known", async () => {
            setUserVaults(["/v"]);
            const mod = await importObsidian();
            const r = await mod.openInObsidianWithPicker({ absPath: "/v/note.md" });
            expect(r).toBe("obsidian");
            expect(openExternalMock).toHaveBeenCalledTimes(1);
        });

        it("picks a directory then opens when no vault matches", async () => {
            setUserVaults([]);
            // simulate "user picks /brand/new/vault when prompted"
            const mod = await importObsidian({
                pickDirectory: async () => "/brand/new/vault",
                obsidianReadVaults: async () => [],
            });
            const r = await mod.openInObsidianWithPicker({ absPath: "/brand/new/vault/note.md" });
            expect(r).toBe("obsidian");
            expect(openExternalMock).toHaveBeenCalledTimes(1);
            // user vault persisted
            expect(mod.getUserVaults()).toEqual(["/brand/new/vault"]);
        });

        it("returns 'fallback_to_picker' if the user cancels the directory picker", async () => {
            setUserVaults(["/v"]);
            const mod = await importObsidian({
                pickDirectory: async () => null,
                obsidianReadVaults: async () => ["/v"],
            });
            const r = await mod.openInObsidianWithPicker({ absPath: "/somewhere/else/note.md" });
            expect(r).toBe("fallback_to_picker");
            expect(openExternalMock).not.toHaveBeenCalled();
        });
    });
});
