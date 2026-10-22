// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createHoverIntentController } from "@/app/treeview/use-hover-intent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DelayMs = 700;
const CloseDelayMs = 140;

function makeOptions() {
    return {
        delayMs: DelayMs,
        closeDelayMs: CloseDelayMs,
        onOpen: vi.fn(),
        onClose: vi.fn(),
        onUnmount: vi.fn(),
    };
}

describe("createHoverIntentController", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not open before the hover delay elapses", () => {
        const options = makeOptions();
        const controller = createHoverIntentController(options);

        controller.pointerEnter();
        vi.advanceTimersByTime(DelayMs - 1);
        expect(options.onOpen).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(options.onOpen).toHaveBeenCalledTimes(1);
    });

    it("cancels the pending open when the pointer leaves early", () => {
        const options = makeOptions();
        const controller = createHoverIntentController(options);

        controller.pointerEnter();
        vi.advanceTimersByTime(DelayMs / 2);
        controller.pointerLeave();
        vi.advanceTimersByTime(DelayMs);

        expect(options.onOpen).not.toHaveBeenCalled();
        expect(options.onClose).toHaveBeenCalledTimes(1);
    });

    it("closes immediately on leave but unmounts only after the close delay", () => {
        const options = makeOptions();
        const controller = createHoverIntentController(options);

        controller.pointerEnter();
        vi.advanceTimersByTime(DelayMs);
        expect(options.onOpen).toHaveBeenCalledTimes(1);

        controller.pointerLeave();
        expect(options.onClose).toHaveBeenCalledTimes(1);
        expect(options.onUnmount).not.toHaveBeenCalled();

        vi.advanceTimersByTime(CloseDelayMs - 1);
        expect(options.onUnmount).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(options.onUnmount).toHaveBeenCalledTimes(1);
    });

    it("keeps a single shared timer when the pointer moves between rows", () => {
        const options = makeOptions();
        const controller = createHoverIntentController(options);

        // row A
        controller.pointerEnter();
        vi.advanceTimersByTime(DelayMs - 100);
        // 移到 row B：leave(A) + enter(B) 连续发生
        controller.pointerLeave();
        controller.pointerEnter();
        vi.advanceTimersByTime(DelayMs);

        // 只会打开一次（打开的是最后停留的那一行），且不会误卸载
        expect(options.onOpen).toHaveBeenCalledTimes(1);
        expect(options.onUnmount).not.toHaveBeenCalled();
    });

    it("does not fire timers after dispose", () => {
        const options = makeOptions();
        const controller = createHoverIntentController(options);

        controller.pointerEnter();
        controller.dispose();
        vi.advanceTimersByTime(DelayMs * 2);

        expect(options.onOpen).not.toHaveBeenCalled();
    });

    it("does not fire the close timer after dispose", () => {
        const options = makeOptions();
        const controller = createHoverIntentController(options);

        controller.pointerEnter();
        vi.advanceTimersByTime(DelayMs);
        controller.pointerLeave();
        controller.dispose();
        vi.advanceTimersByTime(CloseDelayMs * 2);

        expect(options.onClose).toHaveBeenCalledTimes(1);
        expect(options.onUnmount).not.toHaveBeenCalled();
    });
});
