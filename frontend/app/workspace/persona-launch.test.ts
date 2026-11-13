// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    AgentPersonaIdMetaKey,
    AgentPersonaInjectWorkdirMetaKey,
    buildPersonaLaunchBlockDef,
    makePersonaHomeBase,
    personaInjectionPrompt,
    personaRosterLabel,
    resolvePersonaProfileName,
    type PersonaRosterEntry,
} from "./persona-launch";

const persona: PersonaRosterEntry = {
    id: "backup-guard",
    name: "Backup Guard",
    emoji: "🎭",
    role: "备份归档",
    provider: "pi",
    model: "deepseek-v4.1-flash",
};

describe("makePersonaHomeBase", () => {
    it("joins root and id with a single slash", () => {
        expect(makePersonaHomeBase("C:/personas", "backup")).toBe("C:/personas/backup");
    });
    it("collapses redundant separators on both sides", () => {
        expect(makePersonaHomeBase("C:/personas/", "/backup/")).toBe("C:/personas/backup");
        expect(makePersonaHomeBase(String.raw`C:\personas`, "backup")).toBe(String.raw`C:\personas` + "/backup");
    });
    it("returns empty for blank sides", () => {
        expect(makePersonaHomeBase("", "backup")).toBe("");
        expect(makePersonaHomeBase("C:/personas", "")).toBe("");
    });
});

describe("personaRosterLabel", () => {
    it("prefixes the emoji when present", () => {
        expect(personaRosterLabel(persona)).toBe("🎭 Backup Guard");
    });
    it("falls back to the id when the name is blank", () => {
        expect(personaRosterLabel({ id: "solo", name: "" })).toBe("solo");
    });
    it("returns empty for null", () => {
        expect(personaRosterLabel(null)).toBe("");
    });
});

describe("personaInjectionPrompt", () => {
    it("carries the main workdir, name, id and home base", () => {
        const prompt = personaInjectionPrompt(persona, "E:/code/snorkeling", "C:/personas/backup-guard");
        expect(prompt).toContain("[登场上下文] 本次主工作目录: E:/code/snorkeling");
        expect(prompt).toContain("🎭Backup Guard（backup-guard）");
        expect(prompt).toContain("C:/personas/backup-guard");
        expect(prompt).toContain(".persona/");
    });
});

describe("resolvePersonaProfileName", () => {
    const options = [
        { name: "codex", label: "Codex", cmd: "codex", isDefault: false },
        { name: "pi", label: "Pi", cmd: "pi", isDefault: true },
    ];
    it("matches the declared provider case-insensitively", () => {
        expect(resolvePersonaProfileName({ ...persona, provider: "PI" }, options)).toBe("pi");
    });
    it("falls back to undefined for unknown providers", () => {
        expect(resolvePersonaProfileName({ ...persona, provider: "unknown-vendor" }, options)).toBeUndefined();
    });
    it("falls back to undefined when the persona declares nothing", () => {
        expect(resolvePersonaProfileName({ id: "x", name: "X" }, options)).toBeUndefined();
    });
});

describe("buildPersonaLaunchBlockDef", () => {
    it("launches in the home base with meta.persona = id", () => {
        const { blockDef, homeBase } = buildPersonaLaunchBlockDef({
            settings: undefined,
            persona,
            root: "C:/personas",
        });
        expect(homeBase).toBe("C:/personas/backup-guard");
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta["cmd:cwd"]).toBe("C:/personas/backup-guard");
        expect(meta[AgentPersonaIdMetaKey]).toBe("backup-guard");
        expect(meta["cmd"]).toBe("pi");
    });

    it("applies the persona model as a per-launch override via cmd:args", () => {
        const { blockDef } = buildPersonaLaunchBlockDef({
            persona,
            root: "C:/personas",
        });
        const args = (blockDef.meta as Record<string, unknown>)["cmd:args"] as string[];
        expect(args).toContain("--model");
        expect(args).toContain("deepseek-v4.1-flash");
    });

    it("appends the injection text as the last positional arg when enabled", () => {
        const { blockDef, injectionApplied } = buildPersonaLaunchBlockDef({
            persona,
            root: "C:/personas",
            injectMainWorkdir: true,
            mainWorkdir: "E:/code/snorkeling",
        });
        expect(injectionApplied).toBe(true);
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta[AgentPersonaInjectWorkdirMetaKey]).toBe("E:/code/snorkeling");
        const args = meta["cmd:args"] as string[];
        const last = args[args.length - 1];
        expect(last).toContain("[登场上下文] 本次主工作目录: E:/code/snorkeling");
        expect(last).toBe(args.find((a) => a.includes("[登场上下文]")));
    });

    it("keeps the meta but skips the positional arg for providers outside the allowlist", () => {
        const other: PersonaRosterEntry = { ...persona, id: "w", provider: "opencode" };
        const { blockDef, injectionApplied } = buildPersonaLaunchBlockDef({
            persona: other,
            root: "C:/personas",
            injectMainWorkdir: true,
            mainWorkdir: "E:/code/snorkeling",
        });
        expect(injectionApplied).toBe(false);
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta[AgentPersonaInjectWorkdirMetaKey]).toBe("E:/code/snorkeling");
        const args = (meta["cmd:args"] as string[] | undefined) ?? [];
        expect(args.some((a) => a.includes("[登场上下文]"))).toBe(false);
    });

    it("does not inject when the toggle is off", () => {
        const { blockDef, injectionApplied } = buildPersonaLaunchBlockDef({
            persona,
            root: "C:/personas",
            injectMainWorkdir: false,
            mainWorkdir: "E:/code/snorkeling",
        });
        expect(injectionApplied).toBe(false);
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta[AgentPersonaInjectWorkdirMetaKey]).toBeUndefined();
        expect((meta["cmd:args"] as string[] | undefined)?.some((a) => a.includes("[登场上下文]"))).toBe(false);
    });

    it("honours explicit popup profile and model picks over persona.json", () => {
        const { blockDef } = buildPersonaLaunchBlockDef({
            persona,
            root: "C:/personas",
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

    it("defaults to the codex profile when the persona declares no provider", () => {
        const bare: PersonaRosterEntry = { id: "bare", name: "Bare" };
        const { blockDef } = buildPersonaLaunchBlockDef({
            persona: bare,
            root: "C:/personas",
        });
        const meta = blockDef.meta as Record<string, unknown>;
        expect(meta["cmd"]).toBe("codex");
        expect(meta[AgentPersonaIdMetaKey]).toBe("bare");
        expect(meta["cmd:cwd"]).toBe("C:/personas/bare");
    });
});
