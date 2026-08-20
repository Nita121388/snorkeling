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
        `文件冲突: ${filePath}`,
        "该文件在你编辑期间被外部修改（可能是 AI Agent），你的未保存修改与磁盘当前内容冲突。",
        "",
        "---",
        "",
        "== 你的未保存修改 (base → 你的草稿) ==",
        "",
        minePatch,
        "",
        "== 外部修改 (base → 磁盘当前) ==",
        "",
        theirsPatch,
        "---",
        "",
        "请分析两处修改，输出合并后的完整文件内容。",
    ].join("\n");
}
