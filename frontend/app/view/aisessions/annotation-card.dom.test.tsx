// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// NODE 空地可编辑：卡片展示锚点节点原文，用户应能就地改一份副本。
// 覆盖语义：annotation.nodeText 非空 = 用户覆盖（显示 "edited" + Reset）；
// 空串 = 回落活节点文本（nodePreview）。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCard } from "./annotation-card";
import type { AnnotationLike, AnnotationRailCluster } from "./annotation-model";

function makeAnnotation(overrides: Partial<AnnotationLike> = {}): AnnotationLike {
    return {
        id: 1,
        sessionKey: "s1",
        anchorKey: "e1:t0",
        seq: 7,
        kind: "note",
        title: "t",
        body: "b",
        tags: [],
        status: "accepted",
        source: "user",
        ...overrides,
    };
}

function makeCluster(annotation: AnnotationLike): AnnotationRailCluster {
    return {
        key: annotation.anchorKey,
        seq: annotation.seq,
        items: [{ key: annotation.anchorKey, anchorKey: annotation.anchorKey, seq: annotation.seq, annotations: [annotation] }],
        hasAccepted: true,
        hasDraft: false,
        hasOrphan: false,
    } as unknown as AnnotationRailCluster;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function setTextareaValue(el: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find(
        (button) => (button.textContent ?? "").trim() === text
    ) as HTMLButtonElement | undefined;
}

function render(annotation: AnnotationLike, nodePreview = "live node text", onNodeTextSave = vi.fn()) {
    act(() => {
        root.render(
            <AnnotationCard
                cluster={makeCluster(annotation)}
                nodePreview={nodePreview}
                onJump={vi.fn()}
                onNodeTextSave={onNodeTextSave}
                onClose={vi.fn()}
            />
        );
    });
    return { onNodeTextSave };
}

describe("AnnotationCard node text editing", () => {
    it("shows the live node text and an Edit affordance", () => {
        render(makeAnnotation());
        expect(container.textContent).toContain("live node text");
        expect(container.querySelector('button[aria-label="Edit node text"]')).toBeTruthy();
    });

    it("saves the edited node text", () => {
        const { onNodeTextSave } = render(makeAnnotation());
        const edit = container.querySelector('button[aria-label="Edit node text"]') as HTMLButtonElement;
        act(() => {
            edit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();
        act(() => setTextareaValue(textarea, "cleaned node text"));
        const save = buttonByText("Save");
        expect(save).toBeTruthy();
        act(() => {
            save!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onNodeTextSave).toHaveBeenCalledTimes(1);
        const [annotation, nodeText] = onNodeTextSave.mock.calls[0];
        expect((annotation as AnnotationLike).id).toBe(1);
        expect(nodeText).toBe("cleaned node text");
    });

    it("marks an override as edited and resets it back to the live text", () => {
        const { onNodeTextSave } = render(makeAnnotation({ nodeText: "my copy" }));
        expect(container.textContent).toContain("my copy");
        expect(container.textContent).toContain("edited");
        const reset = buttonByText("Reset");
        expect(reset).toBeTruthy();
        act(() => {
            reset!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onNodeTextSave).toHaveBeenCalledTimes(1);
        expect(onNodeTextSave.mock.calls[0][1]).toBe("");
    });

    it("hides the edit affordance when the caller cannot save", () => {
        act(() => {
            root.render(<AnnotationCard cluster={makeCluster(makeAnnotation())} nodePreview="live node text" onJump={vi.fn()} />);
        });
        expect(container.querySelector('button[aria-label="Edit node text"]')).toBeNull();
    });
});
