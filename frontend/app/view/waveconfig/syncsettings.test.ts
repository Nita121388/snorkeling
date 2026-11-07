// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    blockedReasonFor,
    buildTransportSpecs,
    draftToSettingsPatch,
    readSyncDraft,
    SyncSettingDefaults,
    SyncSettingKeys,
    type SyncSettingsDraft,
} from "./syncsettings";

const baseDraft = (over: Partial<SyncSettingsDraft> = {}): SyncSettingsDraft => ({
    ...SyncSettingDefaults,
    ...over,
});

describe("syncsettings availability", () => {
    it("blocks folder until a file path is set", () => {
        expect(blockedReasonFor("folder", baseDraft())).toContain("path");
        expect(blockedReasonFor("folder", baseDraft({ folderPath: "~/x/commontext.json" }))).toBeNull();
        // Whitespace-only input must not unlock the row.
        expect(blockedReasonFor("folder", baseDraft({ folderPath: "   " }))).toContain("path");
    });

    it("blocks git until a token exists", () => {
        expect(blockedReasonFor("git", baseDraft())).toContain("token");
        expect(blockedReasonFor("git", baseDraft({ gitHasToken: true }))).toBeNull();
    });

    it("unlocks server in two steps: url, then token", () => {
        expect(blockedReasonFor("server", baseDraft())).toContain("URL");
        expect(blockedReasonFor("server", baseDraft({ serverUrl: "https://sync.example.com" }))).toContain("token");
        expect(
            blockedReasonFor("server", baseDraft({ serverUrl: "https://sync.example.com", serverHasToken: true }))
        ).toBeNull();
    });

    it("still reports a reason for a blocked transport (the panel must explain itself)", () => {
        // blockedReasonFor 是「为什么还不能用」的说明来源，不是「禁止选中」的开关。
        // 一旦有人把它接到 radio 的 disabled 上，server 就会死锁：URL 字段只在
        // transport === "server" 时渲染，而选中 server 又要求 URL 已填 —— 永远够不到。
        const specs = buildTransportSpecs(baseDraft());
        const server = specs.find((s) => s.id === "server");
        expect(server?.blockedReason).not.toBeNull();
        expect(server?.blockedReason).toContain("URL");
    });

    it("never blocks none", () => {
        expect(blockedReasonFor("none", baseDraft())).toBeNull();
    });

    it("exposes the same judgement through buildTransportSpecs", () => {
        const specs = buildTransportSpecs(baseDraft({ folderPath: "~/y.json", serverUrl: "https://s" }));
        expect(specs.map((s) => s.id)).toEqual(["folder", "git", "server", "none"]);
        expect(specs.find((s) => s.id === "folder")?.blockedReason).toBeNull();
        expect(specs.find((s) => s.id === "git")?.blockedReason).toContain("token");
        expect(specs.find((s) => s.id === "server")?.blockedReason).toContain("token");
        expect(specs.find((s) => s.id === "none")?.blockedReason).toBeNull();
        expect(specs.find((s) => s.id === "folder")?.recommended).toBe(true);
    });
});

describe("syncsettings read/write", () => {
    it("falls back to safe defaults for a missing or unknown transport", () => {
        expect(readSyncDraft(null).transport).toBe("none");
        expect(readSyncDraft({} as SettingsType).transport).toBe("none");
        // An unknown enum value must not leak through as-is.
        expect(readSyncDraft({ [SyncSettingKeys.transport]: "ftp" } as unknown as SettingsType).transport).toBe("none");
        expect(readSyncDraft({ [SyncSettingKeys.transport]: "server" } as unknown as SettingsType).transport).toBe(
            "server"
        );
    });

    it("keeps an explicitly stored false instead of falling back to the default", () => {
        // true/false vs unset is the classic settings bug: `||` would turn false into the default.
        const draft = readSyncDraft({
            [SyncSettingKeys.folderWatch]: false,
            [SyncSettingKeys.syncTombstones]: false,
        } as unknown as SettingsType);
        expect(draft.folderWatch).toBe(false);
        expect(draft.syncTombstones).toBe(false);
    });

    it("falls back to defaults for unknown conflict policies", () => {
        expect(
            readSyncDraft({ [SyncSettingKeys.conflictPolicy]: "whatever" } as unknown as SettingsType).conflictPolicy
        ).toBe("row-merge");
        expect(
            readSyncDraft({ [SyncSettingKeys.conflictPolicy]: "manual" } as unknown as SettingsType).conflictPolicy
        ).toBe("manual");
    });

    it("round-trips a draft through the settings patch", () => {
        const draft = baseDraft({
            transport: "server",
            deviceName: "Home PC",
            serverUrl: "https://sync.example.com",
            serverHasToken: true,
            serverInsecure: true,
            syncTombstones: false,
        });
        const patch = draftToSettingsPatch(draft);
        const readBack = readSyncDraft(patch as unknown as SettingsType);
        expect(readBack.transport).toBe("server");
        expect(readBack.deviceName).toBe("Home PC");
        expect(readBack.serverUrl).toBe("https://sync.example.com");
        expect(readBack.serverHasToken).toBe(true);
        expect(readBack.serverInsecure).toBe(true);
        expect(readBack.syncTombstones).toBe(false);
    });

    it("writes every settings key the panel owns", () => {
        const patch = draftToSettingsPatch(baseDraft()) as Record<string, unknown>;
        for (const key of Object.values(SyncSettingKeys)) {
            // deviceId is server-generated (first launch), never written by the panel.
            if (key === SyncSettingKeys.deviceId) continue;
            expect(patch).toHaveProperty(key);
        }
    });
});
