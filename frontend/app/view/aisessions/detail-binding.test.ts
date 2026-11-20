// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { detailBelongsToSelection, detailFallbackDecision, shouldCommitDetailLoad } from "./detail-binding";

describe("detailFallbackDecision", () => {
    it("未绑定的纯列表块：解析失败仍自动选最新一行（不回归既有行为）", () => {
        const plan = detailFallbackDecision({
            blockBound: false,
            loadByIdFailed: true,
            sessionNotFound: false,
            newChat: false,
        });
        expect(plan).toEqual({ kind: "first-session" });
    });

    it("未绑定的 newchat 块：仍自动起新会话", () => {
        const plan = detailFallbackDecision({
            blockBound: false,
            loadByIdFailed: true,
            sessionNotFound: false,
            newChat: true,
        });
        expect(plan).toEqual({ kind: "newchat" });
    });

    it("红证：绑定块 Detail 请求瞬时报错，绝不改绑列表第一行", () => {
        const plan = detailFallbackDecision({
            blockBound: true,
            loadByIdFailed: true,
            sessionNotFound: false,
            newChat: false,
        });
        expect(plan.kind).not.toBe("first-session");
        expect(plan).toEqual({ kind: "keep" });
    });

    it("红证：绑定块 session not found（会话被删），清绑后也不自动切到别的会话", () => {
        const plan = detailFallbackDecision({
            blockBound: true,
            loadByIdFailed: true,
            sessionNotFound: true,
            newChat: false,
        });
        expect(plan.kind).not.toBe("first-session");
        expect(plan).toEqual({ kind: "keep" });
    });

    it("绑定块解析成功路径的兜底也是 keep（成功时调用方应已提前 return）", () => {
        const plan = detailFallbackDecision({
            blockBound: true,
            loadByIdFailed: false,
            sessionNotFound: false,
            newChat: false,
        });
        expect(plan).toEqual({ kind: "keep" });
    });
});

describe("shouldCommitDetailLoad", () => {
    it("最新响应且选中未变：提交", () => {
        expect(shouldCommitDetailLoad({ loadSeq: 3, latestSeq: 3, selectedKey: "pi:abc", targetKey: "pi:abc" })).toBe(
            true
        );
    });

    it("红证：期间又发起了新请求（seq 过期）：不提交，防止旧响应覆盖新选中", () => {
        expect(shouldCommitDetailLoad({ loadSeq: 3, latestSeq: 4, selectedKey: "pi:def", targetKey: "pi:abc" })).toBe(
            false
        );
    });

    it("红证：响应回来时用户已点了另一行：不提交", () => {
        expect(shouldCommitDetailLoad({ loadSeq: 3, latestSeq: 3, selectedKey: "pi:def", targetKey: "pi:abc" })).toBe(
            false
        );
    });

    it("空 targetKey 恒不提交", () => {
        expect(shouldCommitDetailLoad({ loadSeq: 1, latestSeq: 1, selectedKey: "", targetKey: " " })).toBe(false);
    });
});

describe("detailBelongsToSelection", () => {
    const detailOf = (key: string, id = "raw-id") => ({ summary: { key, id } });

    it("key 相同：属于", () => {
        expect(detailBelongsToSelection(detailOf("pi:abc"), "pi:abc")).toBe(true);
    });

    it("裸 id 相同（绑定块 selectedKey 暂存裸 id）：属于", () => {
        expect(detailBelongsToSelection(detailOf("pi:abc", "raw-id"), "raw-id")).toBe(true);
    });

    it("红证：detail 属于别的会话：不属于，面板不得拿旧正文冒充当前选中", () => {
        expect(detailBelongsToSelection(detailOf("pi:old"), "pi:new")).toBe(false);
    });

    it("detail 为空或选中为空：不属于", () => {
        expect(detailBelongsToSelection(null, "pi:abc")).toBe(false);
        expect(detailBelongsToSelection(detailOf("pi:abc"), "")).toBe(false);
    });
});

// 「旧逻辑红证」：把修前 aisessions.tsx 的回落规则原样写在这里（绑定会话解析失败
// → 取列表第一行），断言它违反不变式。任何把这个规则搬回来的改动都会让下面这条
// 用例继续"通过"，但 detailFallbackDecision 的用例会红 —— 两者一起锁住行为。
describe("修前回落规则（红证对照）", () => {
    const oldFallback = (boundFound: boolean, firstSessionKey: string): string =>
        boundFound ? "bound" : firstSessionKey;

    it("旧规则在绑定解析失败时会返回列表第一行（这就是粘死错绑的来源）", () => {
        expect(oldFallback(false, "pi:list-first")).toBe("pi:list-first");
        expect(
            detailFallbackDecision({
                blockBound: true,
                loadByIdFailed: true,
                sessionNotFound: false,
                newChat: false,
            })
        ).not.toEqual({ kind: "first-session" });
    });
});
