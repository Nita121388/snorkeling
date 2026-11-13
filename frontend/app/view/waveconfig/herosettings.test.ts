// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A5.5 hero settings panel — the testable half.
//
// Three contracts are asserted here because getting them wrong is silent:
//
//   1. **Governance defaults** — the Go keys are `*bool` / `int` with `omitempty`, so "unset" and
//      "explicitly false/0" are different states. The draft must show the documented default when
//      the key is missing, and the stored value when it is present.
//   2. **Root validation** — a relative root would resolve against the app's cwd and scatter
//      hero homes; empty must stay legal (it means "use the default root").
//   3. **Bucket accounting** — archive / history / work stay separate; only archive + history are
//      syncable (design §3.4). Adding them into one number is how a user ends up syncing a
//      multi-GB `work/` folder.

import { describe, expect, it } from "vitest";

import {
    DefaultHeroRoot,
    draftToSettingsPatch,
    formatBytes,
    heroRelocateCommand,
    HeroSettingDefaults,
    HeroSettingKeys,
    heroStorageTotals,
    readHeroDraft,
    validateHeroRootDir,
    validatePositiveInt,
    type HeroSettingsDraft,
} from "./herosettings";

const stat = (over: Partial<StorageStats> = {}): StorageStats => ({
    id: "backup-guard",
    archiveBytes: 0,
    archiveFiles: 0,
    historyBytes: 0,
    historyFiles: 0,
    workBytes: 0,
    workFiles: 0,
    totalBytes: 0,
    syncableBytes: 0,
    ...over,
});

describe("formatBytes", () => {
    it("renders KB and MB without noise", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
        expect(formatBytes(2.3 * 1024 ** 3)).toBe("2.3 GB");
    });

    it("treats negative / non-finite input as empty instead of printing NaN", () => {
        expect(formatBytes(-1)).toBe("0 B");
        expect(formatBytes(Number.NaN)).toBe("0 B");
    });
});

describe("validateHeroRootDir", () => {
    it("accepts empty (default root) and absolute paths", () => {
        expect(validateHeroRootDir("")).toBeNull();
        expect(validateHeroRootDir("   ")).toBeNull();
        expect(validateHeroRootDir("/data/heroes")).toBeNull();
        expect(validateHeroRootDir("D:/Data/heroes")).toBeNull();
        expect(validateHeroRootDir("D:\\Data\\heroes")).toBeNull();
        // pkg/hero.expandHome expands a leading ~, so it is not a relative path here.
        expect(validateHeroRootDir("~/heroes")).toBeNull();
    });

    it("rejects relative paths", () => {
        expect(validateHeroRootDir("heroes")).toContain("absolute");
        expect(validateHeroRootDir("./heroes")).toContain("absolute");
        expect(validateHeroRootDir("../heroes")).toContain("absolute");
    });
});

describe("readHeroDraft", () => {
    it("falls back to the documented governance defaults when nothing is stored", () => {
        const draft = readHeroDraft({});
        expect(draft).toEqual(HeroSettingDefaults);
        expect(draft.rootDir).toBe("");
        expect(draft.journalRotate).toBe(true);
        expect(draft.dormantDays).toBe("90");
        expect(draft.softLimitMb).toBe("50");
        expect(draft.softLimitAction).toBe("warn");
    });

    it("keeps stored values, including an explicitly stored false and 0-ish numbers", () => {
        const draft = readHeroDraft({
            [HeroSettingKeys.rootDir]: "D:/Data/heroes",
            [HeroSettingKeys.journalRotate]: false,
            [HeroSettingKeys.dormantDays]: 30,
            [HeroSettingKeys.softLimitMb]: 512,
            [HeroSettingKeys.softLimitAction]: "readonly",
        });
        expect(draft.rootDir).toBe("D:/Data/heroes");
        expect(draft.journalRotate).toBe(false);
        expect(draft.dormantDays).toBe("30");
        expect(draft.softLimitMb).toBe("512");
        expect(draft.softLimitAction).toBe("readonly");
    });

    it("survives an unknown enum / garbage value without crashing the panel", () => {
        const draft = readHeroDraft({
            [HeroSettingKeys.softLimitAction]: "explode",
            [HeroSettingKeys.dormantDays]: "abc",
        } as unknown as SettingsType);
        expect(draft.softLimitAction).toBe("warn");
        expect(draft.dormantDays).toBe(HeroSettingDefaults.dormantDays);
    });

    it("round-trips through draftToSettingsPatch", () => {
        const draft: HeroSettingsDraft = {
            rootDir: "  /data/heroes  ",
            journalRotate: false,
            dormantDays: "45",
            softLimitMb: "128",
            softLimitAction: "warn-distill",
        };
        expect(draftToSettingsPatch(draft)).toEqual({
            [HeroSettingKeys.rootDir]: "/data/heroes",
            [HeroSettingKeys.journalRotate]: false,
            [HeroSettingKeys.dormantDays]: 45,
            [HeroSettingKeys.softLimitMb]: 128,
            [HeroSettingKeys.softLimitAction]: "warn-distill",
        });
    });

    it("never writes NaN when a number field is invalid", () => {
        const patch = draftToSettingsPatch({ ...HeroSettingDefaults, dormantDays: "", softLimitMb: "abc" });
        expect(patch[HeroSettingKeys.dormantDays]).toBe(90);
        expect(patch[HeroSettingKeys.softLimitMb]).toBe(50);
    });
});

describe("validatePositiveInt", () => {
    it("rejects empty, non-numeric and non-positive values", () => {
        expect(validatePositiveInt("")).not.toBeNull();
        expect(validatePositiveInt("abc")).not.toBeNull();
        expect(validatePositiveInt("0")).not.toBeNull();
        expect(validatePositiveInt("-5")).not.toBeNull();
        expect(validatePositiveInt("90")).toBeNull();
    });
});

describe("heroStorageTotals", () => {
    it("keeps the three buckets separate and sums syncable as archive + history", () => {
        const totals = heroStorageTotals([
            stat({
                id: "a",
                archiveBytes: 1024,
                historyBytes: 2048,
                workBytes: 4096,
                totalBytes: 7168,
                syncableBytes: 3072,
            }),
            stat({ id: "b", archiveBytes: 0, historyBytes: 1024, workBytes: 0, totalBytes: 1024, syncableBytes: 1024 }),
        ]);
        expect(totals.count).toBe(2);
        expect(totals.archiveBytes).toBe(1024);
        expect(totals.historyBytes).toBe(3072);
        expect(totals.workBytes).toBe(4096);
        expect(totals.syncableBytes).toBe(4096);
        expect(totals.totalBytes).toBe(8192);
    });

    it("reports zero for an empty roster instead of throwing", () => {
        expect(heroStorageTotals(undefined).count).toBe(0);
        expect(heroStorageTotals([]).syncableBytes).toBe(0);
    });
});

describe("heroRelocateCommand", () => {
    it("prints a dry-run preview for the draft root", () => {
        expect(heroRelocateCommand("D:/Data/heroes")).toBe("wsh hero relocate D:/Data/heroes --dry-run");
        expect(heroRelocateCommand("D:/Data/heroes", "apply")).toBe("wsh hero relocate D:/Data/heroes --yes");
    });

    it("quotes a path with spaces and keeps a placeholder when the root is empty", () => {
        expect(heroRelocateCommand("D:/My Data/heroes")).toBe('wsh hero relocate "D:/My Data/heroes" --dry-run');
        expect(heroRelocateCommand("")).toBe(`wsh hero relocate <new-root> --dry-run`);
    });

    it("names the documented default root", () => {
        expect(DefaultHeroRoot).toBe("~/.snorkeling/heroes");
    });
});
