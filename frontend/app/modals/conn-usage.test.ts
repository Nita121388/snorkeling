// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 连接使用次数（纯前端偏好）的存储与排序契约。
//
// 回归背景：连接下拉原来只按 connections[name]["display:order"] 排，而它默认全 0，
// 等于「后端返回顺序」—— 常用的机器从来不上浮，每次都要在长列表里找。
// 这里把「计数怎么落」和「排序怎么判」钉成纯函数，避免以后改排序时把 tie-break 弄丢。
//
// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { ConnUsageStorageKey, loadConnUsage, recordConnUse, sortConnItemsByUsage } from "./conn-usage";

function stored(): unknown {
    return JSON.parse(localStorage.getItem(ConnUsageStorageKey) ?? "{}");
}

beforeEach(() => {
    localStorage.clear();
});

describe("conn-usage 存储", () => {
    it("空存储读出空表（不返回 null）", () => {
        expect(loadConnUsage()).toEqual({});
    });

    it("recordConnUse 累加并落盘", () => {
        recordConnUse("nita@100.110.167.25");
        recordConnUse("nita@100.110.167.25");
        recordConnUse("ubuntu@49.51.243.178");
        expect(loadConnUsage()).toEqual({ "nita@100.110.167.25": 2, "ubuntu@49.51.243.178": 1 });
        expect(stored()).toEqual({ "nita@100.110.167.25": 2, "ubuntu@49.51.243.178": 1 });
    });

    it("空名字不计数（Local 行的 value 是空串）", () => {
        recordConnUse("");
        recordConnUse(null);
        recordConnUse(undefined);
        expect(loadConnUsage()).toEqual({});
    });

    it("脏数据不炸：坏 JSON / 非数字值一律当 0", () => {
        localStorage.setItem(ConnUsageStorageKey, "{ not json");
        expect(loadConnUsage()).toEqual({});
        localStorage.setItem(ConnUsageStorageKey, JSON.stringify({ a: "3", b: 2, c: -1, d: null }));
        expect(loadConnUsage()).toEqual({ b: 2 });
    });
});

describe("conn-usage 排序", () => {
    const items = [{ value: "a" }, { value: "b" }, { value: "c" }];

    it("次数倒序：常用的在前", () => {
        const sorted = sortConnItemsByUsage(items, { a: 3, b: 0, c: 1 });
        expect(sorted.map((i) => i.value)).toEqual(["a", "c", "b"]);
    });

    it("同次数按 display:order 升序，再按传入顺序保稳定", () => {
        const orders = { a: 5, b: 1, c: 1 };
        const orderOf = (name: string) => orders[name] ?? 0;
        const sorted = sortConnItemsByUsage(
            [{ value: "zz" }, { value: "b" }, { value: "a" }, { value: "c" }],
            { zz: 2, b: 2, a: 2, c: 2 },
            orderOf
        );
        // zz 的 order 是 0（默认）排最前；b/c 都是 1 → 保传入顺序 b < c；a 是 5
        expect(sorted.map((i) => i.value)).toEqual(["zz", "b", "c", "a"]);
    });

    it("零数据时完全保序（不把后端 settings>sshconfig>history 的意图改成字母序）", () => {
        const input = [{ value: "z" }, { value: "first" }, { value: "a" }];
        expect(sortConnItemsByUsage(input, {}).map((i) => i.value)).toEqual(["z", "first", "a"]);
    });

    it("缺次数按 0 处理；不修改入参数组", () => {
        const input = [{ value: "x" }, { value: "y" }];
        const sorted = sortConnItemsByUsage(input, { y: 1 });
        expect(sorted.map((i) => i.value)).toEqual(["y", "x"]);
        expect(input.map((i) => i.value)).toEqual(["x", "y"]);
    });
});
