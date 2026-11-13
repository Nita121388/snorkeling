// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A4 hero roster — pure model unit tests (design §6).
//
// Locks the parts the view cannot prove by itself: byte formatting, roster row
// derivation (including the ⚡ pending count), CHARTER excerpt truncation, the
// empty-roster guidance text and the honest provider/model fallback.

import { describe, expect, it } from "vitest";
import {
    DefaultHeroEmoji,
    EmptyRoleText,
    HeroCreateCommand,
    UnknownProviderModel,
    charterExcerpt,
    deriveRosterRows,
    emptyStateText,
    formatBytes,
    formatProviderModel,
    heroApproveCommand,
    heroInboxCommand,
    roleLine,
} from "./hero-model";

function makeEntry(overrides: Partial<HeroOverviewEntry> = {}): HeroOverviewEntry {
    return {
        hero: {
            schemaVersion: 1,
            id: "backup-guard",
            name: "备份卫",
            emoji: "🛡️",
            role: "管备份与归档",
            provider: "pi",
            model: "deepseek-v3",
            createdAt: "2026-11-01T00:00:00Z",
        },
        charter: "# 备份卫 — 职责书（CHARTER）\n\n> 人写为主，AI 提议修订。\n\n## 职责\n\n- 管备份\n",
        storage: {
            id: "backup-guard",
            archiveBytes: 2048,
            archiveFiles: 3,
            historyBytes: 1024,
            historyFiles: 2,
            workBytes: 512,
            workFiles: 1,
            totalBytes: 3584,
            syncableBytes: 3072,
        },
        pendingProposals: 2,
        lastJournalLine: "- 2026-11-13 归档了一批备份",
        ...overrides,
    };
}

describe("formatBytes", () => {
    it("formats zero, bytes and the first three scales with one decimal", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(null)).toBe("0 B");
        expect(formatBytes(Number.NaN)).toBe("0 B");
        expect(formatBytes(-5)).toBe("0 B");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
        expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    });
});

describe("formatProviderModel", () => {
    it("falls back honestly when provider or model is missing", () => {
        expect(formatProviderModel("pi", "deepseek-v3")).toBe("pi / deepseek-v3");
        expect(formatProviderModel("pi", "  ")).toBe("pi");
        expect(formatProviderModel(undefined, "deepseek-v3")).toBe("deepseek-v3");
        expect(formatProviderModel(null, null)).toBe(UnknownProviderModel);
    });
});

describe("deriveRosterRows", () => {
    it("derives emoji/name/role/provider-model/journal and the pending count", () => {
        const rows = deriveRosterRows({ root: "/home/me/.snorkeling/heroes", heroes: [makeEntry()] });
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.id).toBe("backup-guard");
        expect(row.emoji).toBe("🛡️");
        expect(row.name).toBe("备份卫");
        expect(row.role).toBe("管备份与归档");
        expect(row.providerModel).toBe("pi / deepseek-v3");
        expect(row.pendingProposals).toBe(2);
        expect(row.lastJournalLine).toBe("- 2026-11-13 归档了一批备份");
        expect(row.storage?.syncableBytes).toBe(3072);
        // the raw record rides along for buildHeroLaunchBlockDef
        expect(row.hero.id).toBe("backup-guard");
    });

    it("keeps directory order and drops entries without an id", () => {
        const rows = deriveRosterRows({
            root: "/root",
            heroes: [
                makeEntry(),
                { ...makeEntry({ hero: { ...makeEntry().hero, id: "second", name: "第二" } }) },
                { ...makeEntry({ hero: { ...makeEntry().hero, id: "" } }) },
            ],
        });
        expect(rows.map((row) => row.id)).toEqual(["backup-guard", "second"]);
    });

    it("falls back to emoji/name/pending when the record omits them", () => {
        const bare = makeEntry({
            hero: {
                schemaVersion: 1,
                id: "ghost",
                name: "",
                createdAt: "2026-11-01T00:00:00Z",
            },
            pendingProposals: -3,
            lastJournalLine: "   ",
            charter: "",
        });
        const [row] = deriveRosterRows({ root: "/root", heroes: [bare] });
        expect(row.emoji).toBe(DefaultHeroEmoji);
        expect(row.name).toBe("ghost");
        expect(row.role).toBe("");
        expect(row.providerModel).toBe(UnknownProviderModel);
        expect(row.pendingProposals).toBe(0);
        expect(row.lastJournalLine).toBe("");
        expect(roleLine(row)).toBe(EmptyRoleText);
    });

    it("returns an empty array for a missing overview", () => {
        expect(deriveRosterRows(null)).toEqual([]);
        expect(deriveRosterRows({})).toEqual([]);
    });
});

describe("charterExcerpt", () => {
    it("strips markdown decoration, drops comments/blank lines and marks truncation", () => {
        const charter = "<!-- GENERATED -->\n\n# 甲 — 职责书\n\n> 人写为主\n\n## 职责\n\n- 管备份\n- 管归档\n";
        expect(charterExcerpt(charter, 2)).toBe("甲 — 职责书\n人写为主 …");
        expect(charterExcerpt(charter, 99)).toBe("甲 — 职责书\n人写为主\n职责\n- 管备份\n- 管归档");
        expect(charterExcerpt("", 3)).toBe("");
        expect(charterExcerpt(null)).toBe("");
    });
});

describe("empty state + commands", () => {
    it("guides the user to the CLI create line", () => {
        expect(emptyStateText()).toContain(HeroCreateCommand);
        expect(HeroCreateCommand).toBe("wsh hero create --name <name> --yes");
    });

    it("builds the copyable memory commands from the CLI contract", () => {
        expect(heroInboxCommand("backup-guard")).toBe("wsh hero memory inbox backup-guard");
        expect(heroApproveCommand("backup-guard")).toBe("wsh hero memory approve backup-guard <stamp> --yes");
        expect(heroApproveCommand("backup-guard", "20261113-1")).toBe(
            "wsh hero memory approve backup-guard 20261113-1 --yes"
        );
    });
});
