// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A2 creation wizard pure logic (design/plans/persona-system.md §4).
// The wizard NEVER writes to disk: it previews the A1 scaffold tree through the
// backend `aisessions.PersonaScaffoldPreview` RPC (the same `persona.Create`
// dry-run the CLI uses) and hands the user a copy-pasteable command, so the
// propose gate stays on the CLI side.

export type PersonaCreateDraft = {
    name: string;
    emoji: string;
    role: string;
    provider: string;
    model: string;
};

export type PersonaCreatePrefill = {
    /** Where the wizard was opened from (aisessions | block | detail). */
    source?: string;
    /** Session title, when opened from a session surface. */
    sessionTitle?: string;
    /** Session cwd / project path, when available. */
    projectPath?: string;
};

const emptyDraft: PersonaCreateDraft = {
    name: "",
    emoji: "",
    role: "",
    provider: "",
    model: "",
};

/**
 * Mirror of Go `persona.Slugify` for the ASCII case: lowercase, keep
 * [a-z0-9-_], collapse every other run into a single "-", trim "-_".
 *
 * Deliberate gap: Go appends a short hash for empty and non-ASCII names
 * (`persona-<hash>`), which this preview does not reproduce — the wizard
 * labels the id as a preview and the CLI remains the authority.
 */
export function slugPreview(name: string | null | undefined): string {
    const s = (name ?? "").trim().toLowerCase();
    let out = "";
    let prevDash = false;
    for (const ch of s) {
        if (/[a-z0-9\-_]/.test(ch)) {
            out += ch;
            prevDash = false;
        } else if (!prevDash) {
            out += "-";
            prevDash = true;
        }
    }
    return out.replace(/^[-_]+/, "").replace(/[-_]+$/, "");
}

function shellQuote(value: string): string {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
}

/**
 * The command the user runs to actually land the persona. Only non-empty
 * identity flags are appended, in a fixed order, so the output is stable.
 */
export function buildCreateCommand(draft: PersonaCreateDraft | null | undefined): string {
    const d = draft ?? emptyDraft;
    const parts = ["wsh persona create", `--name ${shellQuote((d.name ?? "").trim())}`];
    const emoji = (d.emoji ?? "").trim();
    if (emoji !== "") {
        parts.push(`--emoji ${shellQuote(emoji)}`);
    }
    const role = (d.role ?? "").trim();
    if (role !== "") {
        parts.push(`--role ${shellQuote(role)}`);
    }
    const provider = (d.provider ?? "").trim();
    if (provider !== "") {
        parts.push(`--provider ${shellQuote(provider)}`);
    }
    const model = (d.model ?? "").trim();
    if (model !== "") {
        parts.push(`--model ${shellQuote(model)}`);
    }
    parts.push("--yes");
    return parts.join(" ");
}

/** Merge a surface's prefill into a fresh draft (never keeps stale fields). */
export function mergePrefill(prefill: PersonaCreatePrefill | null | undefined): PersonaCreateDraft {
    const title = (prefill?.sessionTitle ?? "").trim();
    return { ...emptyDraft, name: title };
}

/** Returns an error message, or "" when the identity step is submittable. */
export function validateCreateDraft(draft: PersonaCreateDraft | null | undefined): string {
    if ((draft?.name ?? "").trim() === "") {
        return "Name is required";
    }
    return "";
}

/** Depth of a scaffold path, used to indent the file tree. */
export function treeDepth(path: string): number {
    return path.split("/").filter((part) => part !== "").length - 1;
}

export { emptyDraft as emptyPersonaCreateDraft };
