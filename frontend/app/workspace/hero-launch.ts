// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero stage entry (A3) — pure launch logic, no React.
//
// Design: design/plans/hero-system.md §5. A stage entry is an ordinary
// agent-launch with exactly three differences:
//   1. cmd:cwd  = the hero home base (<root>/<id>)
//   2. block meta `hero` = the hero id (A4 roster / hover card / aggregate read it)
//   3. an OPTIONAL first-prompt injection carrying "本次主工作目录" so the agent knows
//      where the real work is while its home stays the hero base.
//
// Everything else (provider/model/vendor/status chip/subagents/annotations) is
// inherited from the existing agent-launch pipeline; this module must never
// duplicate that logic.

import { AgentEmojiMetaKey } from "@/app/view/term/agent-logo";
import {
    createAgentBlockDefForProfile,
    createDefaultAgentBlockDef,
    type AgentProfileOption,
} from "@/app/workspace/agent-launch";
import { isBlank } from "@/util/util";

/** Right WidgetsBar entry for the hero stage popup. */
export const HeroWidgetId = "defwidget@hero";

/**
 * Block meta key holding the owning hero id. Value = id (design §5.5 writes
 * this as `hero:<id>`); the key itself is `hero` because a hero is an
 * identity of the block, not an attribute of the agent vendor namespace.
 */
export const AgentHeroIdMetaKey = "hero";

/** Block meta key recording the injected main work directory (diagnostics / future providers). */
export const AgentHeroInjectWorkdirMetaKey = "hero:injectworkdir";

/**
 * Providers whose CLI treats a trailing positional argument as the first user
 * prompt. For these the injection can ride on `cmd:args`; for any other
 * provider we keep the meta (so a later adapter can use it) but never risk
 * turning a flag into a positional argument.
 */
const PositionalPromptProviders = new Set(["pi", "codex", "claude", "gemini"]);

export type HeroRosterEntry = {
    id: string;
    name: string;
    emoji?: string;
    role?: string;
    provider?: string;
    model?: string;
};

export type HeroRoster = {
    root: string;
    heroes: HeroRosterEntry[];
};

/** `<root>/<id>` with exactly one separator and no trailing slash. */
export function makeHeroHomeBase(root: string, id: string): string {
    const trimmedRoot = (root ?? "").trim().replace(/[\\/]+$/, "");
    const trimmedId = (id ?? "")
        .trim()
        .replace(/^[\\/]+/, "")
        .replace(/[\\/]+$/, "");
    if (trimmedRoot === "" || trimmedId === "") {
        return "";
    }
    return `${trimmedRoot}/${trimmedId}`;
}

/** Display label for a roster row: emoji + name, falling back to the id. */
export function heroRosterLabel(hero: HeroRosterEntry | null | undefined): string {
    if (hero == null) {
        return "";
    }
    const name = isBlank(hero.name) ? hero.id : hero.name;
    return isBlank(hero.emoji) ? name : `${hero.emoji} ${name}`;
}

/**
 * The first-prompt prefix injected when "注入本次主工作目录" is checked. It is
 * deliberately short: the home base AGENTS.md already carries the charter, so
 * the shift context only has to say where today's work lives.
 */
export function heroInjectionPrompt(hero: HeroRosterEntry, mainWorkdir: string, homeBase: string): string {
    const name = isBlank(hero?.name) ? (hero?.id ?? "") : hero.name;
    return (
        `[Hero context] Main working directory: ${mainWorkdir.trim()}. ` +
        `You are ${isBlank(hero?.emoji) ? "" : hero.emoji + " "}${name} (${hero?.id ?? ""}); ` +
        `your home base is ${homeBase}; read your memory under .hero/.`
    );
}

/**
 * Resolve which agent profile a stage entry should boot. An explicit popup pick
 * wins; otherwise the hero's declared provider, but only when it is an
 * actually detected profile — an unknown provider must fall back to the global
 * default profile instead of launching a command that does not exist.
 */
export function resolveHeroProfileName(
    hero: HeroRosterEntry | null | undefined,
    profileOptions: AgentProfileOption[] | null | undefined
): string | undefined {
    const declared = hero?.provider?.trim().toLowerCase();
    if (isBlank(declared) || !Array.isArray(profileOptions)) {
        return undefined;
    }
    const match = profileOptions.find((option) => option.name.trim().toLowerCase() === declared);
    return match?.name;
}

export type BuildHeroLaunchBlockDefParams = {
    settings?: SettingsType;
    hero: HeroRosterEntry;
    /** Hero root dir (from the roster RPC); the home base is root + id. */
    root: string;
    /** Explicit popup override. */
    profileName?: string;
    /** Explicit popup override; when blank the profile's own model (hero.json) applies. */
    model?: string;
    injectMainWorkdir?: boolean;
    /** Current main work directory to inject; required when injectMainWorkdir is true. */
    mainWorkdir?: string | null;
};

export type BuildHeroLaunchBlockDefResult = {
    blockDef: BlockDef;
    homeBase: string;
    /** True when the injection text actually reached cmd:args for this provider. */
    injectionApplied: boolean;
};

/**
 * Build the agent block def for one stage entry (§5 semantics). Pure: no store
 * access, no side effects, so the meta contract is unit-testable.
 */
export function buildHeroLaunchBlockDef(params: BuildHeroLaunchBlockDefParams): BuildHeroLaunchBlockDefResult {
    const { settings, hero, root } = params;
    const homeBase = makeHeroHomeBase(root, hero?.id ?? "");
    const profileName = isBlank(params.profileName) ? hero?.provider?.trim() : params.profileName.trim();
    const modelOverride = isBlank(params.model) ? hero?.model?.trim() : params.model.trim();
    const context = {
        connection: null,
        cwd: homeBase === "" ? null : homeBase,
        inheritWorkspaceContext: false,
    };

    const blockDef = isBlank(profileName)
        ? createDefaultAgentBlockDef(settings, context, undefined, undefined, undefined, modelOverride)
        : createAgentBlockDefForProfile(profileName, settings, context, undefined, undefined, undefined, modelOverride);

    const meta = (blockDef.meta ?? {}) as MetaType & Record<string, unknown>;
    meta[AgentHeroIdMetaKey] = hero.id;
    // The launched block inherits the hero's own emoji: getAgentIcon() already
    // honors the block-level `agent:emoji` meta, so the header/card shows the
    // hero identity instead of the provider brand logo.
    const heroEmoji = typeof hero.emoji === "string" ? hero.emoji.trim() : "";
    if (heroEmoji !== "") {
        meta[AgentEmojiMetaKey] = heroEmoji;
    }

    let injectionApplied = false;
    const mainWorkdir = typeof params.mainWorkdir === "string" ? params.mainWorkdir.trim() : "";
    if (params.injectMainWorkdir === true && mainWorkdir !== "") {
        meta[AgentHeroInjectWorkdirMetaKey] = mainWorkdir;
        const provider = typeof meta["agent:provider"] === "string" ? String(meta["agent:provider"]).toLowerCase() : "";
        if (PositionalPromptProviders.has(provider)) {
            const existingArgs = Array.isArray(meta["cmd:args"]) ? (meta["cmd:args"] as string[]) : [];
            meta["cmd:args"] = [...existingArgs, heroInjectionPrompt(hero, mainWorkdir, homeBase)];
            injectionApplied = true;
        }
    }

    return { blockDef: { ...blockDef, meta }, homeBase, injectionApplied };
}
