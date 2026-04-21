// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeRelativePathForCopy } from "@/app/view/preview/preview-paths";
import { describe, expect, it } from "vitest";

describe("preview path helpers", () => {
    it("returns a descendant path relative to the tree root", () => {
        expect(makeRelativePathForCopy("/tmp/project/src/index.ts", "/tmp/project")).toBe("src/index.ts");
    });

    it("returns dot when copying the tree root itself", () => {
        expect(makeRelativePathForCopy("/tmp/project", "/tmp/project")).toBe(".");
    });

    it("preserves windows separators for windows-style paths", () => {
        expect(makeRelativePathForCopy("C:\\repo\\src\\index.ts", "C:\\repo")).toBe("src\\index.ts");
    });

    it("returns null when the paths are on different windows drives", () => {
        expect(makeRelativePathForCopy("D:\\project\\file.txt", "C:\\project")).toBeNull();
    });
});
