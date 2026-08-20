// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Build a structured diff text that the user can paste directly into an AI Agent
 * prompt to resolve a save conflict.  Format: two unified diffs (base→mine,
 * base→theirs) wrapped with a header and an instruction line.
 *
 * ponytail: jsdiff is already in node_modules as a transitive dep of ts-node;
 *         adding it to package.json makes the dependency explicit with zero
 *         new install.
 */
import { createTwoFilesPatch } from "diff";

export function buildConflictCopyText(
    filePath: string,
    baseContent: string,
    mineContent: string,
    theirsContent: string
): string {
    const patchOpts = { context: 3 };
    const minePatch = createTwoFilesPatch(
        `${filePath} (base)`,
        "your draft",
        baseContent,
        mineContent,
        "",
        "",
        patchOpts
    );
    const theirsPatch = createTwoFilesPatch(
        `${filePath} (base)`,
        "current disk",
        baseContent,
        theirsContent,
        "",
        "",
        patchOpts
    );
    return [
        `File conflict: ${filePath}`,
        "This file was modified externally while you were editing it (possibly by an AI Agent). Your unsaved changes conflict with the current disk content.",
        "",
        "---",
        "",
        "== Your unsaved changes (base → your draft) ==",
        "",
        minePatch,
        "",
        "== External changes (base → current disk) ==",
        "",
        theirsPatch,
        "---",
        "",
        "Please analyze both changes and output the merged, complete file content.",
    ].join("\n");
}
