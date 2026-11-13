// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero roster block (A4, design §6) — pure derivation, no React.
//
// Everything the roster renders is derived here so the view stays a dumb
// renderer and every fallback (missing emoji / role / provider / model /
// journal) is unit-testable without mounting a component.

import { isBlank } from "@/util/util";

/** Fallback avatar when a hero.json carries no emoji. */
export const DefaultHeroEmoji = "🦸";

/** Shown when neither provider nor model is declared. */
export const UnknownProviderModel = "unknown";

/** Shown when the hero has no `role` and its CHARTER has no usable first line. */
export const EmptyRoleText = "(no role)";

/** Shown when the hero has no journal entries yet. */
export const EmptyJournalText = "(no journal yet)";

/** Shown in the detail pane when CHARTER.md is empty. */
export const EmptyCharterText = "(CHARTER.md is empty)";

/** Default number of CHARTER lines rendered as an excerpt. */
export const DefaultCharterLines = 6;

/** Empty-roster guidance (design §6): the CLI is the only create path in v1. */
export const HeroCreateCommand = "wsh hero create --name <name> --yes";

/** One roster row: identity + list-line summary + detail payload. */
export type HeroRosterRow = {
    id: string;
    /** Raw hero record from the RPC (handed to buildHeroLaunchBlockDef). */
    hero: Hero;
    emoji: string;
    name: string;
    role: string;
    provider: string;
    model: string;
    /** "provider / model" with the honest fallbacks below. */
    providerModel: string;
    lastJournalLine: string;
    pendingProposals: number;
    storage: StorageStats | null;
    charter: string;
};

/**
 * Human byte size. Roster/capacity numbers are all "how much disk does this
 * hero own", so one decimal is enough precision at every scale.
 */
export function formatBytes(bytes: number | null | undefined): string {
    const value = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
    if (value <= 0) {
        return "0 B";
    }
    if (value < 1024) {
        return `${Math.trunc(value)} B`;
    }
    const units = ["KB", "MB", "GB", "TB"];
    let scaled = value / 1024;
    let unitIdx = 0;
    while (scaled >= 1024 && unitIdx < units.length - 1) {
        scaled = scaled / 1024;
        unitIdx++;
    }
    return `${scaled.toFixed(1)} ${units[unitIdx]}`;
}

/** "provider / model" — never fabricates the half that is missing. */
export function formatProviderModel(provider: string | null | undefined, model: string | null | undefined): string {
    const p = isBlank(provider) ? "" : provider.trim();
    const m = isBlank(model) ? "" : model.trim();
    if (p !== "" && m !== "") {
        return `${p} / ${m}`;
    }
    if (p !== "") {
        return p;
    }
    if (m !== "") {
        return m;
    }
    return UnknownProviderModel;
}

/**
 * First `maxLines` meaningful CHARTER lines with markdown decoration stripped
 * (headings lose their `#`, quotes lose their `>`), HTML comments and blank
 * lines dropped. Truncation is marked with a trailing ellipsis so the excerpt
 * never pretends to be the whole charter.
 */
export function charterExcerpt(charter: string | null | undefined, maxLines: number = DefaultCharterLines): string {
    const limit = Number.isFinite(maxLines) && maxLines > 0 ? Math.trunc(maxLines) : DefaultCharterLines;
    const lines = String(charter ?? "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .filter((line) => !line.startsWith("<!--"))
        .map((line) =>
            line
                .replace(/^#{1,6}\s+/, "")
                .replace(/^>\s?/, "")
                .trim()
        )
        .filter((line) => line !== "");
    if (lines.length === 0) {
        return "";
    }
    const kept = lines.slice(0, limit);
    return lines.length > limit ? `${kept.join("\n")} …` : kept.join("\n");
}

/** The single line a list row shows as "what this hero is for". */
export function roleLine(row: HeroRosterRow | null | undefined): string {
    if (row == null) {
        return EmptyRoleText;
    }
    if (!isBlank(row.role)) {
        return row.role.trim();
    }
    const excerpt = charterExcerpt(row.charter, 1);
    return excerpt === "" ? EmptyRoleText : excerpt;
}

/**
 * Roster rows in backend (directory) order: the roster count must equal the
 * number of hero dirs on disk, so this never sorts or de-duplicates.
 */
export function deriveRosterRows(overview: AISessionsHeroOverviewResponse | null | undefined): HeroRosterRow[] {
    const entries = overview?.heroes ?? [];
    const rows: HeroRosterRow[] = [];
    for (const entry of entries) {
        const hero = entry?.hero;
        if (hero == null || isBlank(hero.id)) {
            continue;
        }
        const provider = isBlank(hero.provider) ? "" : hero.provider.trim();
        const model = isBlank(hero.model) ? "" : hero.model.trim();
        const pending = typeof entry.pendingProposals === "number" ? entry.pendingProposals : 0;
        rows.push({
            id: hero.id,
            hero,
            emoji: isBlank(hero.emoji) ? DefaultHeroEmoji : hero.emoji.trim(),
            name: isBlank(hero.name) ? hero.id : hero.name.trim(),
            role: isBlank(hero.role) ? "" : hero.role.trim(),
            provider,
            model,
            providerModel: formatProviderModel(provider, model),
            lastJournalLine: isBlank(entry.lastJournalLine) ? "" : entry.lastJournalLine.trim(),
            pendingProposals: pending > 0 ? Math.trunc(pending) : 0,
            storage: entry.storage ?? null,
            charter: entry.charter ?? "",
        });
    }
    return rows;
}

/** Empty-roster guidance text (the CLI create line is the actionable part). */
export function emptyStateText(): string {
    return `No heroes yet. Create one in a terminal: ${HeroCreateCommand}`;
}

/** Copyable human-approval command for one pending memory proposal. */
export function heroApproveCommand(id: string, stamp: string = "<stamp>"): string {
    return `wsh hero memory approve ${id} ${stamp} --yes`;
}

/** Copyable "show me the pending proposals" command (stamps come from here). */
export function heroInboxCommand(id: string): string {
    return `wsh hero memory inbox ${id}`;
}

/** Copyable "open this hero's home base" hint for the detail pane. */
export function heroHomeBaseHint(root: string | null | undefined, id: string): string {
    const trimmedRoot = isBlank(root) ? "" : root.trim().replace(/[\\/]+$/, "");
    if (trimmedRoot === "" || isBlank(id)) {
        return "";
    }
    return `${trimmedRoot}/${id}`;
}
