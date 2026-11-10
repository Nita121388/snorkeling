// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    blockedReasonFor,
    buildProbePayload,
    buildProtocolMismatchPayload,
    buildSyncFailurePayload,
    buildTransportSpecs,
    draftToSettingsPatch,
    isProtocolCompatible,
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

// ── copy-for-agent payloads (sync diagnostics) ───────────────────────────────

/** 三段式契约：每段小节头必须都在（缺 Output contract 时 agent 会回一篇分析）。 */
function expectAgentPayloadShape(text: string): void {
    expect(text).toContain("### Context");
    expect(text).toContain("### Task");
    expect(text).toContain("### Output contract");
}

const failedStatus = (over: Partial<Status> = {}): Status => ({
    transport: "folder",
    configured: true,
    running: false,
    lastRunAt: "2026-11-10T10:00:00Z",
    lastError: "reading commontext.json: permission denied",
    lastPulled: 0,
    lastApplied: 0,
    lastPushed: 0,
    conflicts: 0,
    pending: 0,
    intervalSeconds: 300,
    ...over,
});

describe("sync diagnostics payloads", () => {
    it("builds a self-contained last-sync failure payload from backend-rendered event lines", () => {
        const text = buildSyncFailurePayload(failedStatus(), "Work Mac", [
            "11-10 10:00:00  run start (timer)",
            "11-10 10:00:00  ERROR  pull: permission denied",
        ]);
        expectAgentPayloadShape(text);
        // 证据本体：transport / 设备 / 错误 / 事件行都在
        expect(text).toContain("transport: folder");
        expect(text).toContain("device: Work Mac");
        expect(text).toContain("last error: reading commontext.json: permission denied");
        expect(text).toContain("ERROR  pull: permission denied");
        expect(text).toContain("Diagnose why the last sync run failed");
    });

    it("builds an unreachable-server payload that carries the checks and their fixes", () => {
        const text = buildProbePayload({
            transport: "server",
            clientProtocolVersion: 1,
            probe: {
                url: "https://sync.example.com",
                ready: false,
                checks: [
                    { id: "url", state: "ok", detail: "https://sync.example.com" },
                    {
                        id: "reach",
                        state: "failed",
                        detail: "connection refused",
                        fix: "start the server: wsh commontext-sync doctor",
                    },
                ],
            },
        });
        expectAgentPayloadShape(text);
        expect(text).toContain("url: https://sync.example.com");
        expect(text).toContain("unreachable");
        // 两个验收字面量：checks 段与 fix 行
        expect(text).toContain("checks:");
        expect(text).toContain("fix:");
        expect(text).toContain("connection refused");
    });

    it("builds a protocol-mismatch payload with both versions and capabilities", () => {
        const text = buildProtocolMismatchPayload({
            transport: "server",
            clientProtocolVersion: 2,
            probe: {
                url: "https://sync.example.com",
                ready: true,
                health: {
                    service: "waveterm-sync",
                    protocolVersion: 1,
                    appVersion: "0.14.5",
                    items: 0,
                    rev: 0,
                    requiresAuth: true,
                    capabilities: ["bulk"],
                },
                checks: [],
            },
        });
        expectAgentPayloadShape(text);
        expect(text).toContain("client protocol version: 2");
        expect(text).toContain("server protocol version: 1");
        expect(text).toContain("server app version: 0.14.5");
        expect(text).toContain("server capabilities: bulk");
        expect(text).toContain("Decide which side must be upgraded");
    });

    it("treats a missing health as incompatible and an equal version as compatible", () => {
        const reachableOnly: CommonTextSyncProbeResponse = {
            transport: "server",
            clientProtocolVersion: 1,
            probe: { url: "https://sync.example.com", ready: false, checks: [] },
        };
        expect(isProtocolCompatible(reachableOnly)).toBe(false);
        const sameVersion: CommonTextSyncProbeResponse = {
            transport: "server",
            clientProtocolVersion: 1,
            probe: {
                url: "https://sync.example.com",
                ready: true,
                health: { service: "waveterm-sync", protocolVersion: 1, appVersion: "0", items: 0, rev: 0, requiresAuth: false },
                checks: [],
            },
        };
        expect(isProtocolCompatible(sameVersion)).toBe(true);
        const mismatch: CommonTextSyncProbeResponse = {
            transport: "server",
            clientProtocolVersion: 1,
            probe: {
                url: "https://sync.example.com",
                ready: true,
                health: { service: "waveterm-sync", protocolVersion: 3, appVersion: "0", items: 0, rev: 0, requiresAuth: false },
                checks: [],
            },
        };
        expect(isProtocolCompatible(mismatch)).toBe(false);
    });
});
