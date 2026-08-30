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
