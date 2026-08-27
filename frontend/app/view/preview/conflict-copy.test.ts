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
        expect(text).toContain("File conflict: test.md");
        expect(text).toContain("== Your unsaved changes (base → your draft) ==");
        expect(text).toContain("== External changes (base → current disk) ==");
        expect(text).toContain("+- third");
        expect(text).toContain("+- agent second");
        expect(text).toContain("Please analyze both changes and output the merged, complete file content.");
    });
});
