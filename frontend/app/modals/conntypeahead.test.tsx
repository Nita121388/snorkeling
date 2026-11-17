// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 连接下拉的行数据契约（纯函数层）。
//
// 回归背景（2026-11-17）：
//  1. 一键复制只能出现在「有连接名语义」的行上 —— 本机行 / Disconnect / Edit Connections /
//     New Connection 都是动作行，给它们一个复制按钮等于骗人（复制出来是空串或命令名）。
//  2. 排序只看 display:order（默认全 0 = 后端顺序），常用连接永不上浮。
//     现在次数优先，display:order 退化为同频次的显式优先级。
//
// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import * as jotai from "jotai";
import { describe, expect, it } from "vitest";
import {
    createFilteredLocalSuggestionItem,
    createRemoteSuggestionItems,
    createWslSuggestionItems,
    getConnectionsEditItem,
    sortConnSuggestionItems,
} from "./conntypeahead";

const FULL_CONFIG = { connections: {} } as any;

describe("copyText：只在有连接名的行上", () => {
    it("远程行复制的是连接名本身", () => {
        const items = createRemoteSuggestionItems(
            ["nita@100.110.167.25", "ubuntu@49.51.243.178"],
            "nita@100.110.167.25",
            new Map(),
            new Map()
        );
        expect(items.map((i) => i.copyText)).toEqual(["nita@100.110.167.25", "ubuntu@49.51.243.178"]);
    });

    it("wsl 行复制的是带前缀的完整连接名", () => {
        const items = createWslSuggestionItems(["Ubuntu-22.04"], "", new Map());
        expect(items[0].copyText).toBe("wsl://Ubuntu-22.04");
    });

    it("本机行不给复制（value 是空串，复制无意义）", () => {
        const items = createFilteredLocalSuggestionItem("chemclin@DESKTOP-36AHUML", "", "");
        expect(items).toHaveLength(1);
        expect(items[0].copyText).toBeUndefined();
    });

    it("Edit Connections 这类动作行不给复制", () => {
        const item = getConnectionsEditItem(jotai.atom(false), "");
        expect(item).not.toBeNull();
        expect(item.copyText).toBeUndefined();
    });
});

describe("sortConnSuggestionItems：使用次数优先", () => {
    function items(...names: string[]) {
        return names.map((name) => ({ value: name, label: name }) as any);
    }
    function order(config: Record<string, number>) {
        return {
            connections: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, { "display:order": v }])),
        } as any;
    }

    it("常用连接排到前面（即便 display:order 更低）", () => {
        const sorted = sortConnSuggestionItems(items("rare", "frequent", "sometimes"), FULL_CONFIG, {
            rare: 1,
            frequent: 9,
            sometimes: 3,
        });
        expect(sorted.map((i) => i.value)).toEqual(["frequent", "sometimes", "rare"]);
    });

    it("同次数时 display:order 仍然生效，再退回传入顺序（不重排同频项）", () => {
        const sorted = sortConnSuggestionItems(items("b", "a", "pinned"), order({ pinned: -5 }), {
            a: 2,
            b: 2,
            pinned: 2,
        });
        expect(sorted.map((i) => i.value)).toEqual(["pinned", "b", "a"]);
    });

    it("没有使用数据时行为与旧的 display:order 排序一致（不破坏既有偏好）", () => {
        const sorted = sortConnSuggestionItems(items("z", "first", "a"), order({ first: -10 }), {});
        expect(sorted.map((i) => i.value)).toEqual(["first", "z", "a"]);
    });
});

describe("计数写入点（源码断言）", () => {
    const source = readFileSync(path.join(__dirname, "conntypeahead.tsx"), "utf8");

    it("连接成功后调 recordConnUse，且读侧用 loadConnUsage", () => {
        expect(source).toContain("recordConnUse(");
        expect(source).toContain("loadConnUsage(");
    });

    it("排序调用把使用计数传进去（否则计数白记）", () => {
        expect(source).toMatch(/sortConnSuggestionItems\([^)]*connUsage/);
    });
});
