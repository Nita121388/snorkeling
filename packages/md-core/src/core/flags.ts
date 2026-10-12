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
 *
 * ---- md-core 物理抽包（10-12）----
 * 本模块**零 import**（纯函数 + `window.localStorage`），因此随包搬到
 * `@md/core/core/flags`：渲染层需要一个**同步**的 flag 读取点，而同步能力无法用
 * 「延迟 import() 兜底」实现。宿主 `frontend/app/element/block-editor/flags.ts`
 * 现在只是一层 re-export shim（保持 ~10 个宿主调用点不变）。
 *
 * 宿主若要把 flag 存到别处（settings / 远端配置），可覆盖
 * `MdHostAdapter.features.isBlockEditorFeatureEnabled`（见 `./host.ts`）——渲染层只经
 * adapter 读取，不直接依赖本模块。
 */

export type BlockEditorFeature =
    | "blockeditor" // master switch
    | "turninto" // grip menu "Turn into ▸"
    | "slash" // `/` palette + typing patterns
    | "toolbar" // floating selection toolbar
    | "emoji" // `:` emoji trigger
    | "docemoji" // document emoji badge (frontmatter)
    | "table" // table toolbar
    | "tablecell" // milkdown-style table WYSIWYG: in-cell editing + hover handles (off → M4 raw editor)
    | "codelang" // code block language badge
    | "wysiwyg"; // WYSIWYG contentEditable editing for prose blocks (p/h/list/quote/blank)

const LS_PREFIX = "snorkeling:block-editor:";

const ALL_FEATURES: BlockEditorFeature[] = [
    "blockeditor",
    "turninto",
    "slash",
    "toolbar",
    "emoji",
    "docemoji",
    "table",
    "tablecell",
    "codelang",
    "wysiwyg",
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
