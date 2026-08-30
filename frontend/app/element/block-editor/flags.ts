// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Block-editor feature switches (方案 06 §5). Everything defaults ON; a user (or future
 * settings UI) can flip a capability off via localStorage "snorkeling:block-editor:*" =
 * "off". The master switch `blockeditor` gates every sub-feature, so turning it off
 * returns the Note surface to the pre-block-editor baseline behavior.
 *
 * NOTE (deviation from plan): these are localStorage-backed rather than Wave settings
 * keys — adding a real `markdown:*` settings key requires regenerating gotypes.d.ts from
 * the Go schema, so the buttoned-up settings panel lands with M6's polish pass. The
 * gate call sites are intentionally a single function, so swapping the store later is a
 * one-file change.
 */

export type BlockEditorFeature =
    | "blockeditor" // master switch
    | "turninto" // grip menu "Turn into ▸"
    | "slash" // `/` palette + typing patterns
    | "toolbar" // floating selection toolbar
    | "emoji" // `:` emoji trigger
    | "docemoji" // document emoji badge (frontmatter)
    | "table" // table toolbar
    | "codelang"; // code block language badge

const LS_PREFIX = "snorkeling:block-editor:";

const ALL_FEATURES: BlockEditorFeature[] = [
    "blockeditor",
    "turninto",
    "slash",
    "toolbar",
    "emoji",
    "docemoji",
    "table",
    "codelang",
];

let flagsCache: Record<BlockEditorFeature, boolean> | null = null;

function readFlags(): Record<BlockEditorFeature, boolean> {
    const out = {} as Record<BlockEditorFeature, boolean>;
    let store: Storage | null = null;
    try {
        store = typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        store = null;
    }
    const master = store?.getItem(LS_PREFIX + "blockeditor") ?? "on";
    for (const f of ALL_FEATURES) {
        const raw = store?.getItem(LS_PREFIX + f) ?? "on";
        // master "off" forces every feature off, whatever the per-feature key says.
        out[f] = raw !== "off" && master !== "off";
    }
    return out;
}

/** Current flag map (cached; invalidated by setBlockEditorFlag). */
export function blockEditorFlags(): Record<BlockEditorFeature, boolean> {
    if (flagsCache == null) {
        flagsCache = readFlags();
    }
    return flagsCache;
}

export function isBlockEditorFeatureEnabled(feature: BlockEditorFeature): boolean {
    return blockEditorFlags()[feature];
}

/** Flip a flag (mainly for manual console use / future settings UI). */
export function setBlockEditorFlag(feature: BlockEditorFeature, enabled: boolean): void {
    try {
        window.localStorage?.setItem(LS_PREFIX + feature, enabled ? "on" : "off");
    } catch {
        /* no storage (tests / SSR) */
    }
    flagsCache = null;
}

/** Test helper. */
export function resetBlockEditorFlagsForTests(): void {
    flagsCache = null;
}
