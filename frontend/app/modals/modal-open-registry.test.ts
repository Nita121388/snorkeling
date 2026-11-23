// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// modalOpen 仲裁契约测试（任务 11-23-commontext-modal-focus）。
//
// 锁定的回归点：
//  1. 单个来源 claim/release；重复 claim/release 幂等（不重复通知）。
//  2. 多来源共存：任一个仍开着就报 true；全部关闭才报 false（这是"栈清空抹掉直接渲染弹窗"的反例）。
//  3. sink 绑定晚于 claim 时立即回放当前状态。
//  4. sink 抛错不反噬调用方（不能因为写 atom 出错把弹窗渲染搞崩）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    bindModalOpenSink,
    modalOpenAny,
    modalOpenSourceKeys,
    resetModalOpenRegistryForTest,
    setModalOpenSource,
} from "./modal-open-registry";

describe("modal-open-registry", () => {
    beforeEach(() => {
        resetModalOpenRegistryForTest();
    });

    it("单来源开闭：claim 后为 true，release 后为 false", () => {
        expect(modalOpenAny()).toBe(false);
        setModalOpenSource("a", true);
        expect(modalOpenAny()).toBe(true);
        setModalOpenSource("a", false);
        expect(modalOpenAny()).toBe(false);
        expect(modalOpenSourceKeys()).toEqual([]);
    });

    it("幂等：重复 claim / 重复 release 都不重复通知 sink", () => {
        const sink = vi.fn();
        bindModalOpenSink(sink);
        sink.mockClear();

        setModalOpenSource("a", true);
        setModalOpenSource("a", true);
        expect(sink).toHaveBeenCalledTimes(1);
        expect(sink).toHaveBeenLastCalledWith(true);

        setModalOpenSource("a", false);
        setModalOpenSource("a", false);
        expect(sink).toHaveBeenCalledTimes(2);
        expect(sink).toHaveBeenLastCalledWith(false);
    });

    it("多来源共存：只关一个不报 false（modalsModel 栈 + 直接渲染的 <Modal>）", () => {
        const sink = vi.fn();
        bindModalOpenSink(sink);

        setModalOpenSource("modals-stack", true);
        setModalOpenSource("modal:shell-1", true);
        expect(modalOpenAny()).toBe(true);

        setModalOpenSource("modals-stack", false);
        expect(modalOpenAny()).toBe(true);
        expect(sink).toHaveBeenLastCalledWith(true);

        setModalOpenSource("modal:shell-1", false);
        expect(modalOpenAny()).toBe(false);
        expect(sink).toHaveBeenLastCalledWith(false);
    });

    it("sink 晚绑定：绑定即回放已有状态", () => {
        setModalOpenSource("a", true);
        const sink = vi.fn();
        bindModalOpenSink(sink);
        expect(sink).toHaveBeenCalledWith(true);
    });

    it("sink 解绑后不再收到通知，但来源状态保持", () => {
        const sink = vi.fn();
        bindModalOpenSink(sink);
        bindModalOpenSink(null);
        sink.mockClear();
        setModalOpenSource("a", true);
        expect(sink).not.toHaveBeenCalled();
        expect(modalOpenAny()).toBe(true);
    });

    it("sink 抛错不影响来源状态", () => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {});
        bindModalOpenSink(() => {
            throw new Error("boom");
        });
        expect(() => setModalOpenSource("a", true)).not.toThrow();
        expect(modalOpenAny()).toBe(true);
        spy.mockRestore();
    });
});
