// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { describe, expect, it } from "vitest";

describe("makeIconClass", () => {
    it("builds solid icon classes from a bare icon name", () => {
        expect(makeIconClass("clipboard-list", true)).toBe("fa fa-solid fa-clipboard-list fa-fw");
    });

    it("tolerates a leading fa- prefix instead of producing fa-fa-xxx", () => {
        expect(makeIconClass("fa-clipboard-list", true)).toBe("fa fa-solid fa-clipboard-list fa-fw");
    });

    it("keeps modifier markers working after the prefix is stripped", () => {
        expect(makeIconClass("fa-arrows-rotate+spin", false)).toContain("fa-spin");
        expect(makeIconClass("fa-arrows-rotate+spin", false)).toContain("fa-arrows-rotate");
    });

    it("supports explicit style prefixes", () => {
        expect(makeIconClass("regular@fa-star", false)).toBe("fa fa-sharp fa-regular fa-star");
        expect(makeIconClass("brands@fa-github", false)).toBe("fa fa-brands fa-github");
        expect(makeIconClass("custom@my-icon", false)).toBe("fa fa-kit fa-my-icon");
    });
});
