// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { OpenCommonTextSearchEvent } from "@/app/commontext/commontext-events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runWidgetAction } from "./widget-actions";

describe("widget actions", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("opens Common Text search for commontext:search", () => {
        const eventTarget = new EventTarget();
        const listener = vi.fn();
        vi.stubGlobal("window", eventTarget);
        eventTarget.addEventListener(OpenCommonTextSearchEvent, listener);
        try {
            expect(runWidgetAction("commontext:search")).toBe(true);
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            eventTarget.removeEventListener(OpenCommonTextSearchEvent, listener);
        }
    });

    it("ignores empty and unknown actions", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(runWidgetAction()).toBe(false);
        expect(runWidgetAction("")).toBe(false);
        expect(runWidgetAction("unknown")).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith("Unknown widget action: unknown");
    });
});
