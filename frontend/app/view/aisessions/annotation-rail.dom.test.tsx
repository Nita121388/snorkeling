// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Regression: clicking a rail tick used to only open the hover card, which
// closed the instant the mouse moved toward the card — so Accept/Discard were
// unreachable. Clicking a tick must PIN the card (cardIndex = pinnedIndex) so
// it stays open until the tick is clicked again or Close is pressed.
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationLike } from "./annotation-model";
import { AnnotationRail } from "./annotation-rail";

function makeAnnotation(overrides: Partial<AnnotationLike> = {}): AnnotationLike {
    return {
        id: 1,
        sessionKey: "s1",
        anchorKey: "a1",
        seq: 1,
        kind: "note",
        title: "t",
        body: "b",
        tags: [],
        status: "draft",
        source: "ai",
        orphaned: false,
        ...overrides,
    };
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

function render(props: Partial<Parameters<typeof AnnotationRail>[0]> = {}) {
    const annotations: AnnotationLike[] = props.annotations ?? [makeAnnotation()];
    const onAccept = vi.fn();
    const onDiscard = vi.fn();
    const onJump = vi.fn();
    act(() => {
        root.render(
            <AnnotationRail
                annotations={annotations}
                onJump={onJump}
                onAccept={onAccept}
                onDiscard={onDiscard}
                {...props}
            />
        );
    });
    return { onAccept, onDiscard, onJump };
}

function queryButtons() {
    return Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
}

function clickTick() {
    // 刻度按钮 = 带 "Jump to annotation" aria-label 的那个。
    const tick = queryButtons().find((button) =>
        (button.getAttribute("aria-label") ?? "").startsWith("Jump to annotation")
    ) as HTMLButtonElement;
    expect(tick).toBeTruthy();
    act(() => {
        tick.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return tick;
}

function findCardButton(label: string): HTMLButtonElement | undefined {
    return queryButtons().find((button) => button.textContent?.trim() === label);
}

describe("AnnotationRail pinned card", () => {
    it("clicking a tick pins the card so Accept stays reachable", () => {
        render();
        clickTick();
        const accept = findCardButton("Accept");
        expect(accept).toBeTruthy();
    });

    it("Accept is actually clickable after pinning (mouse-leave does not close it)", () => {
        const { onAccept } = render();
        clickTick();
        // 模拟从卡片移开鼠标——钉住时不应关闭。
        const card = container.querySelector('[data-row-action="true"]') as HTMLElement;
        expect(card).toBeTruthy();
        act(() => {
            card.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        });
        const accept = findCardButton("Accept");
        expect(accept).toBeTruthy();
        // 点击 Accept，应触发 onAccept 且卡片仍存在。
        act(() => {
            accept!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onAccept).toHaveBeenCalledTimes(1);
        expect(findCardButton("Accept")).toBeTruthy();
    });

    it("clicking the tick again fully closes the pinned card", () => {
        render();
        clickTick();
        expect(findCardButton("Accept")).toBeTruthy();
        clickTick();
        // 卡片应消失：没有 Accept 按钮。
        expect(findCardButton("Accept")).toBeUndefined();
    });

    it("Close button exists only while pinned", () => {
        render();
        // 未钉住时没有 Close（onClose 不传）。
        expect(container.querySelector('[aria-label="Close"]')).toBeNull();
        clickTick();
        expect(container.querySelector('[aria-label="Close"]')).toBeTruthy();
    });
});

describe("AnnotationRail draft bulk bar (44px rail)", () => {
    // 回归：drafts 条曾用文字按钮 "Discard / Accept" 横排，min-content 宽度约 84px，
    // 溢出 44px 的 rail 后被右侧聊天列（DOM 在后、绘制在上）盖住，实际点不到。
    // 现在必须是图标按钮，文字标签只出现在钉住的批注卡里。
    it("bulk actions are icon buttons, so no text label overflows the rail", () => {
        const onAcceptAllDrafts = vi.fn();
        const onDiscardAllDrafts = vi.fn();
        act(() => {
            root.render(
                <AnnotationRail
                    annotations={[makeAnnotation()]}
                    onJump={vi.fn()}
                    onAcceptAllDrafts={onAcceptAllDrafts}
                    onDiscardAllDrafts={onDiscardAllDrafts}
                />
            );
        });
        const accept = container.querySelector('button[aria-label="Accept all drafts"]') as HTMLButtonElement;
        const discard = container.querySelector('button[aria-label="Discard all drafts"]') as HTMLButtonElement;
        expect(accept).toBeTruthy();
        expect(discard).toBeTruthy();
        // 未打开卡片前，不该存在文字式的 Accept / Discard。
        expect(findCardButton("Accept")).toBeUndefined();
        expect(findCardButton("Discard")).toBeUndefined();
        act(() => {
            accept.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onAcceptAllDrafts).toHaveBeenCalledTimes(1);
        act(() => {
            discard.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onDiscardAllDrafts).toHaveBeenCalledTimes(1);
    });
});

describe("AnnotationRail bottom inset", () => {
    // 回归：rail 与「滚动区 + composer」同级 stretch，曾一路铺到 block 底部、
    // 竖轴和圆点压到输入框上。bottomInset 必须转成 marginBottom 让位。
    it("reserves composer height at the bottom via marginBottom", () => {
        act(() => {
            root.render(
                <AnnotationRail annotations={[makeAnnotation()]} onJump={vi.fn()} bottomInset={172} />
            );
        });
        const railRoot = container.firstElementChild as HTMLElement;
        expect(railRoot.style.marginBottom).toBe("172px");
    });
});

describe("AnnotationRail dot states (2026-10-26 视觉重构)", () => {
    function dotClass(annotation: AnnotationLike): string {
        render({ annotations: [annotation] });
        const dot = container.querySelector('button[aria-label^="Jump to annotation"] span');
        expect(dot).toBeTruthy();
        return dot!.getAttribute("class") ?? "";
    }

    it("accepted node renders a solid primary dot", () => {
        const cls = dotClass(makeAnnotation({ status: "accepted" }));
        expect(cls).toContain("bg-primary");
    });

    it("draft node renders a hollow accent ring, not a solid pill", () => {
        const cls = dotClass(makeAnnotation({ status: "draft" }));
        expect(cls).toContain("border-accent");
        expect(cls).toContain("bg-transparent");
    });

    it("orphan node renders a warning dot", () => {
        const cls = dotClass(makeAnnotation({ status: "draft", orphaned: true }));
        expect(cls).toContain("bg-warning");
    });

    it("node mark is a round dot, not the old horizontal pill", () => {
        const cls = dotClass(makeAnnotation({ status: "accepted" }));
        expect(cls).toContain("rounded-full");
        expect(cls).not.toContain("rounded-md");
    });
});
