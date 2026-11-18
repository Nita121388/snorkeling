// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hero 身份在 Block 头部的接线判据。
//
// 背景：Hero 据点目录名是磁盘不变量（pkg/hero ValidateID: 目录名 == id），
// 中文名 Hero 的 id 必然是 `hero-<hash8>`；`block.tsx` 的 agent 分支原先
// 直接用 `basename(cmd:cwd)` 当标题，于是 Tab / Block 头部显示
// `E:\primary\heros/hero-feaa3f86` 这类既哈希又混合分隔符的目录名。
//
// 锁两件事：
//   1. `heroHeaderName` 只认启动时写下的 `hero:name`，空白一律回空串（回退现状）；
//   2. `block.tsx` 的 defaultTitle 在 cwd basename 之前真的用了它（源码锚点）。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { heroHeaderName } from "./block-title";

describe("heroHeaderName", () => {
    it("returns the stamped hero identity", () => {
        expect(heroHeaderName({ "hero:name": "🦸 状态维护Hero" })).toBe("🦸 状态维护Hero");
    });

    it("returns empty for blocks without hero identity", () => {
        expect(heroHeaderName({})).toBe("");
        expect(heroHeaderName(null)).toBe("");
        expect(heroHeaderName(undefined)).toBe("");
        expect(heroHeaderName({ "hero:name": "   " })).toBe("");
        expect(heroHeaderName({ "hero:name": 42 })).toBe("");
    });
});

describe("block.tsx defaultTitle wiring", () => {
    it("prefers the hero identity over the cwd basename", () => {
        const source = readFileSync(path.resolve(__dirname, "block.tsx"), "utf8");
        expect(source).toContain("heroHeaderName(agentMeta)");
    });
});
