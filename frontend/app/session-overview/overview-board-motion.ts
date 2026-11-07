// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure layout-diff logic for the Overview board's card-motion layer (FLIP).
//
// Kept free of React and DOM APIs (same convention as `overview-board-model.ts`) so the
// interesting rules — which cards fly, which just ease back into place, which appear, and
// when the whole thing must stay quiet — are directly unit-testable.

/** Shared kill switch: `false` drops the board back to the pre-motion instant-jump behavior. */
export const OVERVIEW_BOARD_MOTION_ENABLED = true;

export type BoardRect = {
    left: number;
    top: number;
    width: number;
    height: number;
};

export type BoardSnapshotItem = {
    rect: BoardRect;
    /** Normalized status column the card was rendered into (not the raw agent state). */
    status: string;
};

export type BoardSnapshot = {
    containerWidth: number;
    /**
     * 当前列的稳定 key 列表（`status:working` / `tab:<id>` / `provider:<name>`）。
     * 集合一变就说明**分组口径换了**（status ⇄ tab ⇄ provider）或列集被重排，
     * 此时所有卡片都会“跨列”——那是布局切换，不是卡片移动，必须整体静默。
     */
    columns: readonly string[];
    items: Record<string, BoardSnapshotItem>;
};

export type BoardMotionKind = "move" | "reflow" | "enter";

export type BoardMovement = {
    blockId: string;
    kind: BoardMotionKind;
    dx: number;
    dy: number;
};

export type BoardMotionOptions = {
    viewportWidth?: number;
    viewportHeight?: number;
    maxMoves?: number;
};

export const BoardMotionDefaults = {
    /** Below this sum of |dx| + |dy| the card did not really move. */
    minDeltaPx: 1.5,
    /** Per-axis displacement above this ratio of the viewport means "layout rebuilt", not "card flew". */
    maxAxisRatio: 1.5,
    /** How many cards may fly between columns in one frame; the rest are demoted to `reflow`. */
    maxMoves: 12,
} as const;

function resolveLimit(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 列 key 集合相同（顺序无关）：分组口径没换。 */
function sameColumnSet(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    for (const key of b) {
        if (!set.has(key)) return false;
    }
    return true;
}

/**
 * Diff two board snapshots into an ordered list of movements to play.
 *
 * Ordering contract: every `move` comes first, then `reflow`, then `enter`. The renderer relies
 * on that so the loud animation (a card changing column) is registered before the quiet ones.
 *
 * Silence rules, in evaluation order:
 * 1. no previous snapshot / motion disabled -> nothing;
 * 2. container width changed -> treat as resize, nothing;
 * 3. column key set changed -> grouping mode switched (status / tab / provider), nothing;
 * 4. unknown blockId -> `enter`;
 * 5. sub-pixel drift -> nothing;
 * 6. per-axis displacement beyond `maxAxisRatio * viewport` -> layout rebuild, nothing;
 * 7. column changed -> `move`, otherwise `reflow`;
 * 8. more than `maxMoves` moves -> the excess is demoted to `reflow` (never dropped).
 */
export function diffBoardLayout(
    prev: BoardSnapshot | null,
    next: BoardSnapshot,
    opts: BoardMotionOptions = {}
): BoardMovement[] {
    if (!OVERVIEW_BOARD_MOTION_ENABLED) return [];
    if (prev == null) return [];
    if (prev.containerWidth !== next.containerWidth) return [];
    if (!sameColumnSet(prev.columns ?? [], next.columns ?? [])) return [];

    const maxAxisX = resolveLimit(opts.viewportWidth, Number.POSITIVE_INFINITY) * BoardMotionDefaults.maxAxisRatio;
    const maxAxisY = resolveLimit(opts.viewportHeight, Number.POSITIVE_INFINITY) * BoardMotionDefaults.maxAxisRatio;
    const maxMoves = Math.max(0, Math.floor(resolveLimit(opts.maxMoves, BoardMotionDefaults.maxMoves)));

    const moves: BoardMovement[] = [];
    const reflows: BoardMovement[] = [];
    const enters: BoardMovement[] = [];

    for (const [blockId, nextItem] of Object.entries(next.items)) {
        const prevItem = prev.items[blockId];
        if (prevItem == null) {
            enters.push({ blockId, kind: "enter", dx: 0, dy: 0 });
            continue;
        }
        const dx = nextItem.rect.left - prevItem.rect.left;
        const dy = nextItem.rect.top - prevItem.rect.top;
        if (Math.abs(dx) + Math.abs(dy) < BoardMotionDefaults.minDeltaPx) continue;
        if (Math.abs(dx) > maxAxisX || Math.abs(dy) > maxAxisY) continue;
        const changedColumn = prevItem.status !== nextItem.status;
        const movement: BoardMovement = { blockId, kind: changedColumn ? "move" : "reflow", dx, dy };
        (changedColumn ? moves : reflows).push(movement);
    }

    while (moves.length > maxMoves) {
        const demoted = moves.pop();
        if (demoted == null) break;
        reflows.push({ ...demoted, kind: "reflow" });
    }

    return [...moves, ...reflows, ...enters];
}
