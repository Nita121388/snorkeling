// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * L1.5 registry (方案 01 §2 / 06): every block-editor capability is a REGISTRATION,
 * never hardcoded UI in markdown.tsx. M1 ships the block-action registry that backs
 * the grip menu's "Turn into ▸" submenu; M2/M3 extend this module with the slash
 * command / inline style / trigger registries (same shape, same rules).
 *
 * Contract:
 *   - a capability = one register*() call + pure functions from markdown-transform/
 *   - markdown.tsx only ASKS the registry for items; it never enumerates kinds itself
 *   - everything here is plain data + closures; no React, no DOM
 */

import { transformBlockType, type BlockKind } from "../markdown-transform/block-type";

/** Minimal context describing "what block is this" to registry items. */
export interface BlockCtx {
    /** Current full document text. */
    text: string;
    /** 1-based line where the anchor block starts. */
    line: number;
    /** 1-based line where the anchor block ends (inclusive). */
    endLine: number;
    /** Detected kind of the anchor block. */
    kind: BlockKind;
    /** True when the anchor line is an indented (nested) list item — per 方案 02 §4 the
     *  Turn-into submenu then only offers same-family (list) conversions. */
    nested?: boolean;
}

export interface BlockActionSpec {
    id: string;
    label: string;
    /** Optional right-aligned hint text in menus. */
    hint?: string;
    /**
     * When set, `run` defaults to `transformBlockType(ctx.text, ctx.line, targetKind)`
     * and the UI shows a checkbox + checkmark state against ctx.kind.
     */
    targetKind?: BlockKind;
    /** Availability filter (plan §2.4 disable matrix). Defaults to enabled. */
    when?: (ctx: BlockCtx) => boolean;
    run?: (ctx: BlockCtx) => { text: string; caret?: number } | null;
}

const blockActions: BlockActionSpec[] = [];

/** Register a block action (grip menu item). Returns an unregister disposer. */
export function registerBlockAction(spec: BlockActionSpec): () => void {
    blockActions.push(spec);
    return () => {
        const i = blockActions.indexOf(spec);
        if (i >= 0) {
            blockActions.splice(i, 1);
        }
    };
}

/** All registered block actions in registration order (visibility is NOT filtered —
 *  menus show unavailable items greyed out; check `isBlockActionEnabled`). */
export function listBlockActions(): BlockActionSpec[] {
    return blockActions.slice();
}

/** Whether an action is available for `ctx` (方案 02 §4 disable matrix). */
export function isBlockActionEnabled(action: BlockActionSpec, ctx: BlockCtx): boolean {
    return action.when == null || action.when(ctx);
}

/** Run a block action. targetKind actions dispatch to transformBlockType. */
export function runBlockAction(action: BlockActionSpec, ctx: BlockCtx): { text: string; caret?: number } | null {
    if (action.run != null) {
        return action.run(ctx);
    }
    if (action.targetKind != null) {
        return transformBlockType(ctx.text, ctx.line, action.targetKind, { sourceKind: ctx.kind });
    }
    return null;
}

/** Test helper: drop all registrations. */
export function resetBlockActionsForTests(): void {
    blockActions.length = 0;
}

// ---------------------------------------------------------------------------
// Slash commands (M2 — 方案 02 §2.3)
// ---------------------------------------------------------------------------

export type SlashGroup = "text" | "structure" | "insert" | "custom";

/** Discriminated-union result types for slash command execution. */

/** Text replacement (the common case — existing commands). */
export interface TextReplaceResult {
    type: "text-replace";
    text: string;
    caret?: number;
    focusLine?: number;
}

/** Open a picker (emoji, file, date, …) — UI dispatch handled by the host. */
export interface OpenPickerResult {
    type: "open-picker";
    /** Picker type identifier (must match a registered PickerDefinition). */
    pickerType: string;
    /** Arbitrary config forwarded to the picker component. */
    pickerConfig?: Record<string, unknown>;
}

/** Composite: text replacement + open a picker in one command. */
export interface CompositeResult {
    type: "composite";
    textReplace?: { text: string; caret?: number; focusLine?: number };
    openPicker?: { pickerType: string; pickerConfig?: Record<string, unknown> };
}

/** All result types a slash command `run()` may return. */
export type SlashCommandRunResult = TextReplaceResult | OpenPickerResult | CompositeResult;

/** Legacy inline shape — every existing command returns this. */
export interface SlashCommandSimpleResult {
    text: string;
    caret?: number;
    focusLine?: number;
}

/**
 * Normalize the return value of a slash command `run()`. Existing commands return
 * `{ text, caret?, focusLine? }` (the old simple shape); the new discriminated-union
 * types pass through unchanged. This helper lets `execSlashCommand` / `handleSlashPick`
 * accept BOTH old-style and new-style commands without modifying every call-site.
 */
export function normalizeSlashCommandResult(
    value: SlashCommandRunResult | SlashCommandSimpleResult | null | undefined
): SlashCommandRunResult | null {
    if (value == null) {
        return null;
    }
    // Already a discriminated-union member?
    if ("type" in value) {
        return value as SlashCommandRunResult;
    }
    // Legacy simple shape → wrap in TextReplaceResult.
    return { type: "text-replace", text: value.text, caret: value.caret, focusLine: value.focusLine };
}

export interface SlashCommandSpec {
    id: string;
    label: string;
    /** Grey hint shown right-aligned (e.g. a shortcut or "#"). */
    hint?: string;
    /** Lucide-ish icon name resolved by the palette component. */
    icon?: string;
    /** Extra search terms (pinyin, English aliases, …). */
    keywords?: string[];
    group: SlashGroup;
    /** Availability filter — same semantics as block actions (false ⇒ greyed/hidden). */
    when?: (ctx: BlockCtx) => boolean;
    /**
     * Produce the post-command result. `ctx` describes the block the slash trigger
     * sits in, with the trigger query ALREADY stripped (see exec.ts).
     *
     * Accepts both legacy `{ text, caret?, focusLine? }` and the new
     * discriminated-union types (TextReplaceResult / OpenPickerResult / CompositeResult).
     * Use `normalizeSlashCommandResult()` to unify both shapes.
     */
    run: (ctx: BlockCtx) => SlashCommandRunResult | SlashCommandSimpleResult | null;
}

const slashCommands: SlashCommandSpec[] = [];

export function registerSlashCommand(spec: SlashCommandSpec): () => void {
    slashCommands.push(spec);
    return () => {
        const i = slashCommands.indexOf(spec);
        if (i >= 0) {
            slashCommands.splice(i, 1);
        }
    };
}

export function listSlashCommands(ctx: BlockCtx): SlashCommandSpec[] {
    return slashCommands.filter((c) => c.when == null || c.when(ctx));
}

/**
 * Query-filter slash commands: prefix > substring across label + keywords (both query
 * and keywords are matched case-insensitively; Chinese / pinyin keywords ride the same
 * comparison since they're plain strings). Ordering inside the filtered set is stable.
 */
export function filterSlashCommands(cmds: SlashCommandSpec[], query: string): SlashCommandSpec[] {
    const q = query.trim().toLowerCase();
    if (q === "") {
        return cmds;
    }
    const score = (c: SlashCommandSpec): number | null => {
        const hay = [c.label, c.id, ...(c.keywords ?? [])].map((s) => s.toLowerCase());
        for (const h of hay) {
            if (h.startsWith(q)) {
                return 0; // prefix beats substring
            }
        }
        for (const h of hay) {
            if (h.includes(q)) {
                return 1;
            }
        }
        return null;
    };
    const scored: Array<{ c: SlashCommandSpec; s: number; i: number }> = [];
    cmds.forEach((c, i) => {
        const s = score(c);
        if (s != null) {
            scored.push({ c, s, i });
        }
    });
    return scored.sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Inline styles (M2 — 方案 03 §1): data-driven toolbar + shared shortcuts.
// ---------------------------------------------------------------------------

export interface InlineStyleSpec {
    id: string;
    label: string;
    /** Display hint, e.g. "⌘B". */
    hint?: string;
}

/** Legacy alias — use SlashCommandRunResult instead. */
export type SlashCommandRunResultCompat = SlashCommandSimpleResult;

const inlineStyles: InlineStyleSpec[] = [];

export function registerInlineStyle(spec: InlineStyleSpec): () => void {
    inlineStyles.push(spec);
    return () => {
        const i = inlineStyles.indexOf(spec);
        if (i >= 0) {
            inlineStyles.splice(i, 1);
        }
    };
}

export function listInlineStyles(): InlineStyleSpec[] {
    return inlineStyles.slice();
}

/** Test helper: drop ALL registries (block actions + slash + inline styles). */
export function resetRegistriesForTests(): void {
    resetBlockActionsForTests();
    slashCommands.length = 0;
    inlineStyles.length = 0;
}
