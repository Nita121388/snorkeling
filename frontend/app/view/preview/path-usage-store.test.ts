// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Store-level coverage for the per-block initial-record gate (PRD AC15).
//
// `path-usage-store.ts` keeps module-level mutable state (pending buffer, debounce timer,
// initial-record claims), so every case re-imports a fresh module instance and drives a
// fake `@/store/global` whose `fullConfigAtom` plays the role of the loaded config.
// The only observable output is the payload handed to `SetConfigCommand`.

import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ sent: [] as Record<string, any>[] }));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        SetConfigCommand: vi.fn((_client: unknown, data: Record<string, any>) => {
            hoisted.sent.push(data);
            return Promise.resolve();
        }),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

vi.mock("@/store/global", async () => {
    const { atom, createStore } = await import("jotai");
    const store = createStore();
    const fullConfigAtom = atom<any>(null);
    const keyAtoms = new Map<string, any>();
    const getSettingsKeyAtom = (key: string) => {
        let keyAtom = keyAtoms.get(key);
        if (keyAtom == null) {
            keyAtom = atom((get: any) => get(fullConfigAtom)?.settings?.[key] ?? null);
            keyAtoms.set(key, keyAtom);
        }
        return keyAtom;
    };
    (globalThis as any).__fakeGlobalStore = { store, fullConfigAtom };
    return { globalStore: store, atoms: { fullConfigAtom }, getSettingsKeyAtom };
});

type StoreModule = typeof import("./path-usage-store");

async function freshStore(settings: Record<string, any> | null): Promise<StoreModule> {
    hoisted.sent.length = 0;
    vi.resetModules();
    const mod = await import("./path-usage-store");
    const fake = (globalThis as any).__fakeGlobalStore as { store: any; fullConfigAtom: any };
    fake.store.set(fake.fullConfigAtom, settings == null ? null : { settings });
    return mod;
}

function lastEntries(): PathUsageEntryType[] {
    const payload = hoisted.sent.at(-1);
    expect(payload).toBeDefined();
    return payload["preview:path-usage"];
}

const ReadyConfig = { "preview:path-usage": [] };

describe("recordInitialPathUsage", () => {
    it("buffers the constructor-time record once per block", async () => {
        const store = await freshStore(ReadyConfig);
        store.recordInitialPathUsage("block-1", "/home/u/a", "dir");
        store.recordInitialPathUsage("block-1", "/home/u/a", "dir");
        store.flushPathUsageWrites();
        expect(lastEntries()).toEqual([
            { path: "/home/u/a", connection: undefined, kind: "dir", count: 1, lastAt: expect.any(Number) },
        ]);
    });

    it("still records the first mount of a different block", async () => {
        const store = await freshStore(ReadyConfig);
        store.recordInitialPathUsage("block-1", "/home/u/a", "dir");
        store.recordInitialPathUsage("block-2", "/home/u/b", "dir");
        store.flushPathUsageWrites();
        expect(lastEntries().map((e) => [e.path, e.count])).toEqual([
            ["/home/u/a", 1],
            ["/home/u/b", 1],
        ]);
    });

    it("releases the claim when the record could not be buffered (config not loaded)", async () => {
        const store = await freshStore(null);
        store.recordInitialPathUsage("block-1", "/home/u/a", "dir");
        store.flushPathUsageWrites();
        expect(hoisted.sent).toHaveLength(0);

        const fake = (globalThis as any).__fakeGlobalStore as { store: any; fullConfigAtom: any };
        fake.store.set(fake.fullConfigAtom, { settings: ReadyConfig });
        store.recordInitialPathUsage("block-1", "/home/u/a", "dir");
        store.flushPathUsageWrites();
        expect(lastEntries()).toEqual([
            { path: "/home/u/a", connection: undefined, kind: "dir", count: 1, lastAt: expect.any(Number) },
        ]);
    });

    it("leaves the ungated navigation record untouched", async () => {
        const store = await freshStore(ReadyConfig);
        store.recordInitialPathUsage("block-1", "/home/u/a", "dir");
        expect(store.recordPathUsage("/home/u/a", "dir")).toBe(true);
        store.flushPathUsageWrites();
        expect(lastEntries()).toHaveLength(1);
        expect(lastEntries()[0].count).toBe(2);
    });
});

describe("recordPathUsage return contract", () => {
    it("returns false without buffering a noise path", async () => {
        const store = await freshStore(ReadyConfig);
        expect(store.recordPathUsage("/tmp/scratch", "dir")).toBe(false);
        expect(store.recordPathUsage("/home/u/node_modules/pkg", "dir")).toBe(false);
        store.flushPathUsageWrites();
        expect(hoisted.sent).toHaveLength(0);
    });

    it("returns false and writes nothing before the config is loaded", async () => {
        const store = await freshStore(null);
        expect(store.recordPathUsage("/home/u/a", "dir")).toBe(false);
        store.flushPathUsageWrites();
        expect(hoisted.sent).toHaveLength(0);
    });

    it("returns true when a change is buffered", async () => {
        const store = await freshStore(ReadyConfig);
        expect(store.recordPathUsage("/home/u/a", "dir")).toBe(true);
        store.flushPathUsageWrites();
        expect(lastEntries()).toHaveLength(1);
    });
});
