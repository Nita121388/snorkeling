// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useSessionNoteState 行为测试。
//
// 锁定本任务修掉的两个 bug：
//  1. summary 晚到时**不得**自动保存（旧实现会把空草稿写回后端，清空真实备注）；
//  2. 预览优先取 summary.note，不显示 "Click to add a note..." 而丢掉已有备注。
//
// 说明：仓库没有 @testing-library，这里沿用 inlinetab-dropdown.test.tsx 的
// createRoot + 探针组件写法。
//
// Run: npx vitest run frontend/app/store/session-note-hook.test.tsx
//
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionNoteState, type SessionNoteState } from "./session-note-hook";
import { resetSessionNoteCache } from "./session-note-cache";
import { AiSessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import { AISessionsServiceType } from "@/app/store/services";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSummary(key: string, note: string, tags: string[] = []): SessionSummary {
    return { key, id: key, source: "test", note, tags };
}

let current: SessionNoteState | null = null;

function Probe({ sessionId, connection }: { sessionId: string; connection: string }) {
    const state = useSessionNoteState(sessionId, connection);
    current = state;
    return null;
}

function mount(sessionId: string, connection = ""): { unmount: () => void } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<Probe sessionId={sessionId} connection={connection} />);
    });
    return {
        unmount: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

/** 冲刷 promise 微任务 + 让 React 提交更新。 */
async function flush(times = 3): Promise<void> {
    for (let i = 0; i < times; i++) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1500): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await flush(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timeout waiting for ${label}`);
}

describe("useSessionNoteState", () => {
    beforeEach(() => {
        current = null;
        resetSessionNoteCache();
    });

    afterEach(() => {
        resetSessionNoteCache();
        vi.restoreAllMocks();
    });

    it("does not save when the summary arrives late (no empty-note wipe)", async () => {
        const key = "late-session";
        let release: (() => void) | null = null;
        const summaryFn = vi.fn(
            () =>
                new Promise<SessionSummary>((resolve) => {
                    release = () => resolve(makeSummary(key, "real note from backend"));
                })
        );
        const noteFn = vi.fn();
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(summaryFn as never);
        vi.spyOn(AISessionsServiceType.prototype, "NoteAndTags").mockImplementation(noteFn as never);

        const h = mount(key);
        expect(current?.summary).toBeNull();
        expect(current?.dirty).toBe(false);

        // 旧实现会在这里把空草稿排进 3s 防抖；新实现 dirty=false 绝不排队。
        await new Promise((resolve) => setTimeout(resolve, 50));
        await flush();
        expect(noteFn).not.toHaveBeenCalled();

        release?.();
        await waitFor(() => current?.summary?.note === "real note from backend", "summary load");

        await new Promise((resolve) => setTimeout(resolve, 50));
        await flush();
        expect(noteFn).not.toHaveBeenCalled();
        expect(current?.dirty).toBe(false);
        expect(current?.noteDraft).toBe("real note from backend");
        h.unmount();
    });

    it("prefers the summary note over an empty draft in the preview", async () => {
        const key = "preview-session";
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "backend note")) as never
        );

        const h = mount(key);
        await waitFor(() => current?.summary?.note === "backend note", "summary load");
        expect(current?.previewText).toBe("backend note");
        h.unmount();
    });

    it("autosaves after the user edits (dirty)", async () => {
        const key = "edit-session";
        const noteFn = vi.fn(async () => makeSummary(key, "typed note"));
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "backend note")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "NoteAndTags").mockImplementation(noteFn as never);

        const h = mount(key);
        await waitFor(() => current?.summary?.note === "backend note", "summary load");

        act(() => {
            current!.setNoteDraft("typed note");
        });
        expect(current?.dirty).toBe(true);

        await waitFor(() => noteFn.mock.calls.length > 0, "autosave RPC", 4500);
        await flush(4);
        expect(noteFn).toHaveBeenCalledTimes(1);
        expect(current?.saveStatus).toBe("saved");
        expect(current?.dirty).toBe(false);
        h.unmount();
    });

    it("autosaves while the user is editing (debounce without blur)", async () => {
        const key = "editing-autosave-session";
        const noteFn = vi.fn(async () => makeSummary(key, "typed while editing"));
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "backend note")) as never
        );
        vi.spyOn(AISessionsServiceType.prototype, "NoteAndTags").mockImplementation(noteFn as never);

        const h = mount(key);
        await waitFor(() => current?.summary?.note === "backend note", "summary load");

        act(() => {
            current!.setIsEditing(true);
        });
        act(() => {
            current!.setNoteDraft("typed while editing");
        });
        expect(current?.dirty).toBe(true);

        // 编辑态下停顿也要保存（与列表行 / Note 弹窗的防抖行为一致）。
        await waitFor(() => noteFn.mock.calls.length > 0, "autosave RPC", 4500);
        await flush(4);
        expect(noteFn).toHaveBeenCalledTimes(1);
        expect(current?.saveStatus).toBe("saved");
        expect(current?.dirty).toBe(false);
        h.unmount();
    });

    it("does not overwrite the user's draft when a remote event arrives mid-edit", async () => {
        const key = "editing-session";
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "backend note")) as never
        );

        const h = mount(key);
        await waitFor(() => current?.summary?.note === "backend note", "summary load");

        act(() => {
            current!.setNoteDraft("user typing");
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(AiSessionNoteUpdatedEvent, {
                    detail: { summary: makeSummary(key, "someone else wrote this") },
                })
            );
        });
        await flush();

        expect(current?.noteDraft).toBe("user typing");
        h.unmount();
    });

    it("syncs the draft from a remote event when the user is not editing", async () => {
        const key = "remote-session";
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "v1")) as never
        );

        const h = mount(key);
        await waitFor(() => current?.summary?.note === "v1", "summary load");

        act(() => {
            window.dispatchEvent(
                new CustomEvent(AiSessionNoteUpdatedEvent, {
                    detail: { summary: makeSummary(key, "v2 from global list") },
                })
            );
        });
        await flush();

        expect(current?.noteDraft).toBe("v2 from global list");
        expect(current?.previewText).toBe("v2 from global list");
        h.unmount();
    });
});
// The AI title flow needs a usable model; the real resolver reads global config
// that this test does not boot. Mock it so the test focuses on proposal/apply.
vi.mock("@/app/view/term/agent-ai-config", () => ({
    resolveMetadataAIMode: () => ({ available: true, mode: "waveai@quick" }),
}));

describe("useSessionNoteState — AI title suggestion", () => {
    beforeEach(() => {
        current = null;
        resetSessionNoteCache();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("proposes a title and only writes it after apply", async () => {
        const key = "title-session";
        vi.spyOn(AISessionsServiceType.prototype, "Summary").mockImplementation(
            (async () => makeSummary(key, "note")) as never
        );
        const generateFn = vi
            .spyOn(AISessionsServiceType.prototype, "GenerateTitle")
            .mockImplementation((async () => ({
                summary: makeSummary(key, "note"),
                suggestion: { title: "Fix the title flow", confidence: 0.8 },
            })) as never);
        const titleFn = vi
            .spyOn(AISessionsServiceType.prototype, "Title")
            .mockImplementation((async () => ({ ...makeSummary(key, "note"), title: "Fix the title flow" })) as never);

        const h = mount(key);
        await waitFor(() => current?.summary != null, "summary load");

        await act(async () => {
            await current!.generateTitle();
        });
        expect(generateFn).toHaveBeenCalledTimes(1);
        expect(current?.titleSuggestion).toBe("Fix the title flow");
        expect(current?.titleStatus).toBe("ready");
        expect(titleFn).not.toHaveBeenCalled();

        await act(async () => {
            await current!.applyTitle();
        });
        expect(titleFn).toHaveBeenCalledWith(key, "Fix the title flow");
        expect(current?.titleStatus).toBe("idle");
        expect(current?.titleSuggestion).toBe("");

        h.unmount();
    });
});
