// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Built-in "Turn into ▸" block actions (方案 02 §2.2). Pure data + the shared
 * `when` availability matrix; the grip menu in markdown.tsx renders whatever the
 * registry returns, and runBlockAction() applies transformBlockType through the
 * single commit funnel.
 */

import type { BlockKind } from "../../markdown-transform/block-type";
import type { BlockActionSpec, BlockCtx } from "../registry";

const LIST_KINDS: ReadonlySet<BlockKind> = new Set(["bulleted", "numbered", "todo"]);

function turnIntoWhen(target: BlockKind | undefined) {
    return (ctx: BlockCtx): boolean => {
        // Inside a code block nothing converts (方案 02 §4).
        if (ctx.kind === "code") {
            return false;
        }
        // Inside a table only row-level conversion back to text is allowed.
        if (ctx.kind === "table") {
            return target === "text";
        }
        // Nested list sub-items: same-family conversions only.
        if (ctx.nested) {
            return target != null && LIST_KINDS.has(target);
        }
        return true;
    };
}

export const TURN_INTO_DEFS: ReadonlyArray<{ kind: BlockKind; label: string }> = [
    { kind: "text", label: "Text" },
    { kind: "heading1", label: "Heading 1" },
    { kind: "heading2", label: "Heading 2" },
    { kind: "heading3", label: "Heading 3" },
    { kind: "heading4", label: "Heading 4" },
    { kind: "heading5", label: "Heading 5" },
    { kind: "heading6", label: "Heading 6" },
    { kind: "bulleted", label: "Bulleted List" },
    { kind: "numbered", label: "Numbered List" },
    { kind: "todo", label: "To-do List" },
    { kind: "quote", label: "Quote" },
    { kind: "code", label: "Code Block" },
    { kind: "table", label: "Table" },
];

export function builtinTurnIntoActions(): BlockActionSpec[] {
    return TURN_INTO_DEFS.map((d) => ({
        id: `turn-into-${d.kind}`,
        label: d.label,
        targetKind: d.kind,
        when: turnIntoWhen(d.kind),
    }));
}
