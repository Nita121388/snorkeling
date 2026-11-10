// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy for Agent 契约（jsdom）：
//
//   1. buildAgentPayload 固定三段式（### Context / ### Task / ### Output contract），
//      缺 task / outputContract 直接 throw —— 不产出没契约的文本。
//   2. <CopyForAgent> 只进剪贴板；成功后才给 copied 反馈，失败/空 payload 不假报成功；
//      函数形态是懒取（点击前不调用数据源）。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DIAGNOSIS_BRIEF,
    FIX_COMMAND_ONLY,
    MERGED_CONTENT_ONLY,
    buildAgentPayload,
    CopyForAgent,
} from "./copy-for-agent";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("buildAgentPayload", () => {
    it("assembles the three sections in order", () => {
        const out = buildAgentPayload({
            context: "- id: `item-1`\n- transport: folder",
            task: "Merge both versions into one.",
            outputContract: MERGED_CONTENT_ONLY,
        });

        const contextIdx = out.indexOf("### Context");
        const taskIdx = out.indexOf("### Task");
        const outputIdx = out.indexOf("### Output contract");
        expect(contextIdx).toBeGreaterThanOrEqual(0);
        expect(taskIdx).toBeGreaterThan(contextIdx);
        expect(outputIdx).toBeGreaterThan(taskIdx);
        // 各段内容都保留
        expect(out).toContain("item-1");
        expect(out).toContain("Merge both versions into one.");
        expect(out).toContain(MERGED_CONTENT_ONLY);
    });

    it("throws when task is missing", () => {
        expect(() => buildAgentPayload({ context: "- x: 1", task: "  ", outputContract: MERGED_CONTENT_ONLY })).toThrow(
            /task is required/
        );
    });

    it("throws when outputContract is missing", () => {
        expect(() => buildAgentPayload({ context: "- x: 1", task: "Fix it", outputContract: "" })).toThrow(
            /outputContract is required/
        );
    });

    it("ships the three output-contract presets with their fixed wording", () => {
        // 预设措辞是「agent 不写论文」的关键，被改动应当是刻意行为
        expect(MERGED_CONTENT_ONLY).toContain("Reply with the merged content only");
        expect(FIX_COMMAND_ONLY).toContain("exact command(s) to run");
        expect(DIAGNOSIS_BRIEF).toContain("short diagnosis");

        const out = buildAgentPayload({ context: "- x: 1", task: "Diagnose.", outputContract: DIAGNOSIS_BRIEF });
        expect(out).toContain("### Output contract");
        expect(out).toContain(DIAGNOSIS_BRIEF);
    });
});

describe("CopyForAgent", () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let writeText: ReturnType<typeof vi.fn>;

    function render(node: React.ReactNode): void {
        act(() => {
            root.render(node);
        });
    }

    function button(): HTMLButtonElement {
        const el = container.querySelector("button");
        if (el == null) {
            throw new Error("copy-for-agent button not rendered");
        }
        return el as HTMLButtonElement;
    }

    function isCopied(): boolean {
        return button().classList.contains("copied");
    }

    async function click(): Promise<void> {
        await act(async () => {
            button().click();
        });
    }

    beforeEach(() => {
        vi.useFakeTimers();
        writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
        vi.useRealTimers();
    });

    it("renders a labeled text button with the required title", () => {
        render(<CopyForAgent title="Copy all 3 conflicts for an AI to merge" text="payload" />);

        const btn = button();
        expect(btn.textContent).toContain("Copy for agent");
        expect(btn.getAttribute("title")).toBe("Copy all 3 conflicts for an AI to merge");
        expect(typeof btn.querySelector("i")?.className).toBe("string");
    });

    it("writes the payload to the clipboard and only then marks copied", async () => {
        let resolveWrite: (value: unknown) => void = () => {};
        writeText = vi.fn(
            () =>
                new Promise((resolve) => {
                    resolveWrite = resolve;
                })
        );
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });

        render(<CopyForAgent title="Copy for agent" text="payload-text" />);
        expect(isCopied()).toBe(false);

        await click();
        expect(writeText).toHaveBeenCalledWith("payload-text");
        // 写入还在飞：不能提前报成功
        expect(isCopied()).toBe(false);

        await act(async () => {
            resolveWrite(true);
        });
        expect(isCopied()).toBe(true);
    });

    it("keeps the function form lazy — source is not touched before the click", async () => {
        const load = vi.fn(async () => "lazy-payload");

        render(<CopyForAgent title="Copy for agent" text={load} />);
        expect(load).not.toHaveBeenCalled();

        await click();
        expect(load).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith("lazy-payload");
        expect(isCopied()).toBe(true);
    });

    it("does not claim success when the clipboard write fails", async () => {
        writeText = vi.fn(() => Promise.reject(new Error("clipboard denied")));
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });

        render(<CopyForAgent title="Copy for agent" text="payload" />);
        await click();

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(isCopied()).toBe(false);
    });

    it("refuses an empty payload instead of copying nothing", async () => {
        render(<CopyForAgent title="Copy for agent" text="   " />);
        await click();

        expect(writeText).not.toHaveBeenCalled();
        expect(isCopied()).toBe(false);
    });
});
