// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildConflictCopyText } from "./conflict-copy";

describe("buildConflictCopyText", () => {
    it("contains both unified diff hunks and the instruction line", () => {
        const base = "# Hello\n- first\n- second";
        const mine = "# Hello\n- first\n- second\n- third";
        const theirs = "# Hello\n- first\n- agent second";
        const text = buildConflictCopyText("test.md", base, mine, theirs);
        expect(text).toContain("文件冲突: test.md");
        expect(text).toContain("== 你的未保存修改 (base → 你的草稿) ==");
        expect(text).toContain("== 外部修改 (base → 磁盘当前) ==");
        expect(text).toContain("+- third");
        expect(text).toContain("+- agent second");
        expect(text).toContain("请分析两处修改，输出合并后的完整文件内容。");
    });
});
