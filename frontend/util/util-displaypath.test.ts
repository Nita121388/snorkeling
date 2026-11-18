// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// displayPath 只用于展示：Windows 上把 `/` 统一成 `\`，消掉
// `E:\primary\heros/hero-feaa3f86` 这种 makeHeroHomeBase 用 `/` 拼接
// Windows 盘符路径产生的混合分隔符。
// 复制 / 传给后端的路径一律用原值 —— `E:/x/y` 与 `E:\x\y` 在 Windows 均合法，
// 不动 meta（`cmd:cwd`）避免影响已有块。

import { describe, expect, it } from "vitest";
import { displayPath } from "./util";

describe("displayPath", () => {
    it("normalizes forward slashes to backslashes on Windows", () => {
        expect(displayPath(String.raw`E:\primary\heros` + "/hero-feaa3f86", true)).toBe(
            String.raw`E:\primary\heros\hero-feaa3f86`
        );
    });

    it("keeps posix separators on non-Windows platforms", () => {
        expect(displayPath("/home/user/work", false)).toBe("/home/user/work");
    });

    it("passes through blank input untouched", () => {
        expect(displayPath("", true)).toBe("");
        expect(displayPath(null as unknown as string, false)).toBe(null as unknown as string);
    });
});
