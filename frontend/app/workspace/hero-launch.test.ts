// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    AgentHeroIdMetaKey,
    AgentHeroInjectWorkdirMetaKey,
    buildHeroLaunchBlockDef,
    heroInjectionPrompt,
    heroRosterLabel,
    makeHeroHomeBase,
    resolveHeroProfileName,
    type HeroRosterEntry,
} from "./hero-launch";

const hero: HeroRosterEntry = {
    id: "backup-guard",
    name: "Backup Guard",
    emoji: "🎭",
    role: "备份归档",
    provider: "pi",
    model: "deepseek-v4.1-flash",
};

describe("makeHeroHomeBase", () => {
    it("joins root and id with a single slash", () => {
        expect(makeHeroHomeBase("C:/heroes", "backup")).toBe("C:/heroes/backup");
    });
    it("collapses redundant separators on both sides", () => {
        expect(makeHeroHomeBase("C:/heroes/", "/backup/")).toBe("C:/heroes/backup");
        expect(makeHeroHomeBase(String.raw`C:\heroes`, "backup")).toBe(String.raw`C:\heroes` + "/backup");
    });
    it("returns empty for blank sides", () => {
        expect(makeHeroHomeBase("", "backup")).toBe("");
        expect(makeHeroHomeBase("C:/heroes", "")).toBe("");
    });
});

describe("heroRosterLabel", () => {
    it("prefixes the emoji when present", () => {
        expect(heroRosterLabel(hero)).toBe("🎭 Backup Guard");
    });
    it("falls back to the id when the name is blank", () => {
        expect(heroRosterLabel({ id: "solo", name: "" })).toBe("solo");
    });
    it("returns empty for null", () => {
        expect(heroRosterLabel(null)).toBe("");
    });
});

describe("heroInjectionPrompt", () => {
    it("carries the main workdir, name, id and home base", () => {
        const prompt = heroInjectionPrompt(hero, "E:/code/snorkeling", "C:/heroes/backup-guard");
        expect(prompt).toContain("[Hero context] Main working directory: E:/code/snorkeling");
        expect(prompt).toContain("🎭 Backup Guard (backup-guard)");
        expect(prompt).toContain("C:/heroes/backup-guard");
        expect(prompt).toContain(".hero/");
    });
});

describe("resolveHeroProfileName", () => {
    const options = [
        { name: "codex", label: "Codex", cmd: "codex", isDefault: false },
        { name: "pi", label: "Pi", cmd: "pi", isDefault: true },
    ];
    it("matches the declared provider case-insensitively", () => {
        expect(resolveHeroProfileName({ ...hero, provider: "PI" }, options)).toBe("pi");
    });
    it("falls back to undefined for unknown providers", () => {
        expect(resolveHeroProfileName({ ...hero, provider: "unknown-vendor" }, options)).toBeUndefined();
    });
    it("falls back to undefined when the hero declares nothing", () => {
        expect(resolveHeroProfileName({ id: "x", name: "X" }, options)).toBeUndefined();
    });
});

describe("buildHeroLaunchBlockDef", () => {
    it("launches in the home base with meta.hero = id", () => {
        const { blockDef, homeBase } = buildHeroLaunchBlockDef({
            settings: undefined,
            hero,
            root: "C:/heroes",
        });
        expect(homeBase).toBe("C:/heroes/backup-guard");
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta["cmd:cwd"]).toBe("C:/heroes/backup-guard");
        expect(meta[AgentHeroIdMetaKey]).toBe("backup-guard");
        expect(meta["agent:emoji"]).toBe("🎭");
        expect(meta["cmd"]).toBe("pi");
    });

    it("applies the hero model as a per-launch override via cmd:args", () => {
        const { blockDef } = buildHeroLaunchBlockDef({
            hero,
            root: "C:/heroes",
        });
        const args = (blockDef.meta as Record<string, unknown>)["cmd:args"] as string[];
        expect(args).toContain("--model");
        expect(args).toContain("deepseek-v4.1-flash");
    });

    it("appends the injection text as the last positional arg when enabled", () => {
        const { blockDef, injectionApplied } = buildHeroLaunchBlockDef({
            hero,
            root: "C:/heroes",
            injectMainWorkdir: true,
            mainWorkdir: "E:/code/snorkeling",
        });
        expect(injectionApplied).toBe(true);
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta[AgentHeroInjectWorkdirMetaKey]).toBe("E:/code/snorkeling");
        const args = meta["cmd:args"] as string[];
        const last = args[args.length - 1];
        expect(last).toContain("[Hero context] Main working directory: E:/code/snorkeling");
        expect(last).toBe(args.find((a) => a.includes("[Hero context]")));
    });

    it("keeps the meta but skips the positional arg for providers outside the allowlist", () => {
        const other: HeroRosterEntry = { ...hero, id: "w", provider: "opencode" };
        const { blockDef, injectionApplied } = buildHeroLaunchBlockDef({
            hero: other,
            root: "C:/heroes",
            injectMainWorkdir: true,
            mainWorkdir: "E:/code/snorkeling",
        });
        expect(injectionApplied).toBe(false);
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta[AgentHeroInjectWorkdirMetaKey]).toBe("E:/code/snorkeling");
        const args = (meta["cmd:args"] as string[] | undefined) ?? [];
        expect(args.some((a) => a.includes("[Hero context]"))).toBe(false);
    });

    it("does not inject when the toggle is off", () => {
        const { blockDef, injectionApplied } = buildHeroLaunchBlockDef({
            hero,
            root: "C:/heroes",
            injectMainWorkdir: false,
            mainWorkdir: "E:/code/snorkeling",
        });
        expect(injectionApplied).toBe(false);
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta[AgentHeroInjectWorkdirMetaKey]).toBeUndefined();
        expect((meta["cmd:args"] as string[] | undefined)?.some((a) => a.includes("[Hero context]"))).toBe(false);
    });

    it("honours explicit popup profile and model picks over hero.json", () => {
        const { blockDef } = buildHeroLaunchBlockDef({
            hero,
            root: "C:/heroes",
            profileName: "codex",
            model: "gpt-5.2",
        });
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta["cmd"]).toBe("codex");
        expect(meta["agent:provider"]).toBe("codex");
        const args = meta["cmd:args"] as string[];
        expect(args).toContain("gpt-5.2");
        expect(args).not.toContain("deepseek-v4.1-flash");
    });

    it("defaults to the codex profile when the hero declares no provider", () => {
        const bare: HeroRosterEntry = { id: "bare", name: "Bare" };
        const { blockDef } = buildHeroLaunchBlockDef({
            hero: bare,
            root: "C:/heroes",
        });
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta["cmd"]).toBe("codex");
        expect(meta[AgentHeroIdMetaKey]).toBe("bare");
        expect(meta["cmd:cwd"]).toBe("C:/heroes/bare");
    });
});
