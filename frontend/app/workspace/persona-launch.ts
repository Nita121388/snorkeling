// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Persona stage entry (A3) — pure launch logic, no React.
//
// Design: design/plans/persona-system.md §5. A stage entry is an ordinary
// agent-launch with exactly three differences:
//   1. cmd:cwd  = the persona home base (<root>/<id>)
//   2. block meta `persona` = the persona id (A4 roster / hover card / aggregate read it)
//   3. an OPTIONAL first-prompt injection carrying "本次主工作目录" so the agent knows
//      where the real work is while its home stays the persona base.
//
// Everything else (provider/model/vendor/status chip/subagents/annotations) is
// inherited from the existing agent-launch pipeline; this module must never
// duplicate that logic.

import {
    createAgentBlockDefForProfile,
    createDefaultAgentBlockDef,
    type AgentProfileOption,
} from "@/app/workspace/agent-launch";
import { isBlank } from "@/util/util";

/** Right WidgetsBar entry for the persona stage popup. */
export const PersonaWidgetId = "defwidget@persona";

/**
 * Block meta key holding the owning persona id. Value = id (design §5.5 writes
 * this as `persona:<id>`); the key itself is `persona` because a persona is an
 * identity of the block, not an attribute of the agent vendor namespace.
 */
export const AgentPersonaIdMetaKey = "persona";

/** Block meta key recording the injected main work directory (diagnostics / future providers). */
export const AgentPersonaInjectWorkdirMetaKey = "persona:injectworkdir";

/**
 * Providers whose CLI treats a trailing positional argument as the first user
 * prompt. For these the injection can ride on `cmd:args`; for any other
 * provider we keep the meta (so a later adapter can use it) but never risk
 * turning a flag into a positional argument.
 */
const PositionalPromptProviders = new Set(["pi", "codex", "claude", "gemini"]);

export type PersonaRosterEntry = {
    id: string;
    name: string;
    emoji?: string;
    role?: string;
    provider?: string;
    model?: string;
};

export type PersonaRoster = {
    root: string;
    personas: PersonaRosterEntry[];
};

/** `<root>/<id>` with exactly one separator and no trailing slash. */
export function makePersonaHomeBase(root: string, id: string): string {
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
export function personaRosterLabel(persona: PersonaRosterEntry | null | undefined): string {
    if (persona == null) {
        return "";
    }
    const name = isBlank(persona.name) ? persona.id : persona.name;
    return isBlank(persona.emoji) ? name : `${persona.emoji} ${name}`;
}

/**
 * The first-prompt prefix injected when "注入本次主工作目录" is checked. It is
 * deliberately short: the home base AGENTS.md already carries the charter, so
 * the shift context only has to say where today's work lives.
 */
export function personaInjectionPrompt(persona: PersonaRosterEntry, mainWorkdir: string, homeBase: string): string {
    const name = isBlank(persona?.name) ? (persona?.id ?? "") : persona.name;
    return (
        `[登场上下文] 本次主工作目录: ${mainWorkdir.trim()}。` +
        `你是 ${isBlank(persona?.emoji) ? "" : persona.emoji}${name}（${persona?.id ?? ""}），` +
        `家仍在 ${homeBase}；需要读记忆先看 .persona/。`
    );
}

/**
 * Resolve which agent profile a stage entry should boot. An explicit popup pick
 * wins; otherwise the persona's declared provider, but only when it is an
 * actually detected profile — an unknown provider must fall back to the global
 * default profile instead of launching a command that does not exist.
 */
export function resolvePersonaProfileName(
    persona: PersonaRosterEntry | null | undefined,
    profileOptions: AgentProfileOption[] | null | undefined
): string | undefined {
    const declared = persona?.provider?.trim().toLowerCase();
    if (isBlank(declared) || !Array.isArray(profileOptions)) {
        return undefined;
    }
    const match = profileOptions.find((option) => option.name.trim().toLowerCase() === declared);
    return match?.name;
}

export type BuildPersonaLaunchBlockDefParams = {
    settings?: SettingsType;
    persona: PersonaRosterEntry;
    /** Persona root dir (from the roster RPC); the home base is root + id. */
    root: string;
    /** Explicit popup override. */
    profileName?: string;
    /** Explicit popup override; when blank the profile's own model (persona.json) applies. */
    model?: string;
    injectMainWorkdir?: boolean;
    /** Current main work directory to inject; required when injectMainWorkdir is true. */
    mainWorkdir?: string | null;
};

export type BuildPersonaLaunchBlockDefResult = {
    blockDef: BlockDef;
    homeBase: string;
    /** True when the injection text actually reached cmd:args for this provider. */
    injectionApplied: boolean;
};

/**
 * Build the agent block def for one stage entry (§5 semantics). Pure: no store
 * access, no side effects, so the meta contract is unit-testable.
 */
export function buildPersonaLaunchBlockDef(params: BuildPersonaLaunchBlockDefParams): BuildPersonaLaunchBlockDefResult {
    const { settings, persona, root } = params;
    const homeBase = makePersonaHomeBase(root, persona?.id ?? "");
    const profileName = isBlank(params.profileName) ? persona?.provider?.trim() : params.profileName.trim();
    const modelOverride = isBlank(params.model) ? persona?.model?.trim() : params.model.trim();
    const context = {
        connection: null,
        cwd: homeBase === "" ? null : homeBase,
        inheritWorkspaceContext: false,
    };

    const blockDef = isBlank(profileName)
        ? createDefaultAgentBlockDef(settings, context, undefined, undefined, undefined, modelOverride)
        : createAgentBlockDefForProfile(profileName, settings, context, undefined, undefined, undefined, modelOverride);

    const meta = (blockDef.meta ?? {}) as MetaType & Record<string, unknown>;
    meta[AgentPersonaIdMetaKey] = persona.id;

    let injectionApplied = false;
    const mainWorkdir = typeof params.mainWorkdir === "string" ? params.mainWorkdir.trim() : "";
    if (params.injectMainWorkdir === true && mainWorkdir !== "") {
        meta[AgentPersonaInjectWorkdirMetaKey] = mainWorkdir;
        const provider = typeof meta["agent:provider"] === "string" ? String(meta["agent:provider"]).toLowerCase() : "";
        if (PositionalPromptProviders.has(provider)) {
            const existingArgs = Array.isArray(meta["cmd:args"]) ? (meta["cmd:args"] as string[]) : [];
            meta["cmd:args"] = [...existingArgs, personaInjectionPrompt(persona, mainWorkdir, homeBase)];
            injectionApplied = true;
        }
    }

    return { blockDef: { ...blockDef, meta }, homeBase, injectionApplied };
}
