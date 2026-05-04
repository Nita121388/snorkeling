import { describe, expect, it } from "vitest";

import { isComposingEvent, isInputEvent } from "./keyutil";

describe("IME key events", () => {
    it("treats composition key events as input events", () => {
        const composingEvent = {
            key: "Enter",
            code: "Enter",
            nativeEvent: { isComposing: true },
        } as unknown as WaveKeyboardEvent;

        expect(isComposingEvent(composingEvent)).toBe(true);
        expect(isInputEvent(composingEvent)).toBe(true);
    });

    it("treats process and keyCode 229 events as input events", () => {
        const processEvent = {
            key: "Process",
            code: "KeyA",
        } as unknown as WaveKeyboardEvent;
        const keyCode229Event = {
            key: "Enter",
            code: "Enter",
            nativeEvent: { keyCode: 229 },
        } as unknown as WaveKeyboardEvent;

        expect(isInputEvent(processEvent)).toBe(true);
        expect(isInputEvent(keyCode229Event)).toBe(true);
    });

    it("treats unidentified IME keys as input events", () => {
        const unidentifiedEvent = {
            key: "Unidentified",
            code: "",
        } as unknown as WaveKeyboardEvent;

        expect(isInputEvent(unidentifiedEvent)).toBe(true);
    });
});
