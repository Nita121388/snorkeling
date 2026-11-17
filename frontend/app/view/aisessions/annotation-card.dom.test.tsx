// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// NODE 空地可编辑：卡片展示锚点节点原文，用户应能就地改一份副本。
// 覆盖语义：annotation.nodeText 非空 = 用户覆盖（显示 "edited" + Reset）；
// 空串 = 回落活节点文本（nodePreview）。
//
// v2（B1）追加覆盖（主文档 §4.5 / §4.4 / §5.4）：
//  - 来源徽章三档（You / ✨ AI（草稿小字）/ 🤖 agent 桩）
//  - 上下条导航 `‹ 1 / 3 ›` 的首/末边界禁用
//  - 卡片内 ←/→ 切换上下条、不移动焦点；`e` 打开编辑器（只读条目禁用）
//  - aria 契约：role=dialog / aria-modal=false / aria-label

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import { AnnotationCard, isAnnotationReadOnly } from "./annotation-card";
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

/** B2 字段（author）还没进 AnnotationLike：测试里用断言构造，模拟 B2 接线后的数据。 */
function withAuthor(annotation: AnnotationLike, author: string): AnnotationLike {
    return { ...annotation, author } as AnnotationLike;
}

function makeCluster(annotation: AnnotationLike | AnnotationLike[]): AnnotationRailCluster {
    const annotations = Array.isArray(annotation) ? annotation : [annotation];
    const first = annotations[0];
    return {
        key: first.anchorKey,
        seq: first.seq,
        items: [
            {
                key: first.anchorKey,
                anchorKey: first.anchorKey,
                seq: first.seq,
                annotations,
            },
        ],
        hasAccepted: true,
        hasDraft: false,
        hasOrphan: false,
    } as unknown as AnnotationRailCluster;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
    await initI18n("en");
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

type RenderOptions = {
    nodePreview?: string;
    onNodeTextSave?: (annotation: AnnotationLike, nodeText: string) => void;
    navIndex?: number;
    navTotal?: number;
    onNavigate?: (delta: number) => void;
    onEditAnnotation?: (annotation: AnnotationLike) => void;
};

function render(annotation: AnnotationLike | AnnotationLike[] = makeAnnotation(), options: RenderOptions = {}) {
    act(() => {
        root.render(
            <AnnotationCard
                cluster={makeCluster(annotation)}
                nodePreview={options.nodePreview ?? "live node text"}
                onJump={vi.fn()}
                onNodeTextSave={options.onNodeTextSave ?? vi.fn()}
                onClose={vi.fn()}
                navIndex={options.navIndex}
                navTotal={options.navTotal}
                onNavigate={options.onNavigate}
                onEditAnnotation={options.onEditAnnotation}
            />
        );
    });
    return { onNodeTextSave: options.onNodeTextSave ?? vi.fn() };
}

function cardRoot(): HTMLElement {
    return container.querySelector('[role="dialog"]') as HTMLElement;
}

function press(el: Element | null, key: string) {
    act(() => {
        el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

function click(el: Element | null) {
    act(() => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

describe("AnnotationCard node text editing", () => {
    it("shows the live node text and an Edit affordance", () => {
        render(makeAnnotation());
        expect(container.textContent).toContain("live node text");
        expect(container.querySelector('button[aria-label="Edit node text"]')).toBeTruthy();
    });

    it("saves the edited node text", () => {
        const onNodeTextSave = vi.fn();
        render(makeAnnotation(), { onNodeTextSave });
        const edit = container.querySelector('button[aria-label="Edit node text"]') as HTMLButtonElement;
        click(edit);
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();
        act(() => setTextareaValue(textarea, "cleaned node text"));
        const save = buttonByText("Save");
        expect(save).toBeTruthy();
        click(save);
        expect(onNodeTextSave).toHaveBeenCalledTimes(1);
        const [annotation, nodeText] = onNodeTextSave.mock.calls[0];
        expect((annotation as AnnotationLike).id).toBe(1);
        expect(nodeText).toBe("cleaned node text");
    });

    it("marks an override as edited and resets it back to the live text", () => {
        const onNodeTextSave = vi.fn();
        render(makeAnnotation({ nodeText: "my copy" }), { onNodeTextSave });
        expect(container.textContent).toContain("my copy");
        expect(container.textContent).toContain("edited");
        const reset = buttonByText("Reset");
        expect(reset).toBeTruthy();
        click(reset);
        expect(onNodeTextSave).toHaveBeenCalledTimes(1);
        expect(onNodeTextSave.mock.calls[0][1]).toBe("");
    });

    it("hides the edit affordance when the caller cannot save", () => {
        act(() => {
            root.render(
                <AnnotationCard cluster={makeCluster(makeAnnotation())} nodePreview="live node text" onJump={vi.fn()} />
            );
        });
        expect(container.querySelector('button[aria-label="Edit node text"]')).toBeNull();
    });
});

describe("AnnotationCard source badge", () => {
    it("renders a neutral You badge for user annotations", () => {
        render(makeAnnotation());
        const badge = container.querySelector('[data-annotation-source="user"]');
        expect(badge).toBeTruthy();
        expect(badge!.textContent?.trim()).toBe("You");
    });

    it("renders the ✨ AI badge, with the draft suffix only on drafts", () => {
        render(makeAnnotation({ id: 2, source: "ai", status: "accepted" }));
        const accepted = container.querySelector('[data-annotation-source="ai"]');
        expect(accepted).toBeTruthy();
        expect(accepted!.textContent).toContain("✨ AI");
        expect(accepted!.textContent).not.toContain("draft");

        act(() => root.unmount());
        root = createRoot(container);
        render(makeAnnotation({ id: 2, source: "ai", status: "draft" }));
        const draft = container.querySelector('[data-annotation-source="ai"]');
        expect(draft).toBeTruthy();
        expect(draft!.textContent).toContain("✨ AI");
        expect(draft!.textContent).toContain("draft");
    });

    it("keeps the 🤖 agent badge out of B1 data (no author field yet)", () => {
        render([
            makeAnnotation({ id: 1, source: "user" }),
            makeAnnotation({ id: 2, source: "ai", status: "draft" }),
        ]);
        expect(container.querySelector('[data-annotation-source="agent"]')).toBeNull();
        expect(container.querySelectorAll('[data-annotation-source]').length).toBe(2);
    });

    it("shows the 🤖 agent badge once the B2 author field lands", () => {
        render(withAuthor(makeAnnotation({ source: "user" }), "pi"));
        const badge = container.querySelector('[data-annotation-source="agent"]');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toContain("pi");
        expect(badge!.getAttribute("title")).toBe("via wsh annotation add");
    });
});

describe("isAnnotationReadOnly", () => {
    it("only treats external writes as read-only", () => {
        expect(isAnnotationReadOnly(makeAnnotation({ source: "user" }))).toBe(false);
        expect(isAnnotationReadOnly(makeAnnotation({ source: "ai", status: "draft" }))).toBe(false);
        expect(isAnnotationReadOnly(makeAnnotation({ source: "agent" }))).toBe(true);
        expect(isAnnotationReadOnly(withAuthor(makeAnnotation({ source: "user" }), "pi"))).toBe(true);
        expect(isAnnotationReadOnly(withAuthor(makeAnnotation({ source: "user" }), "   "))).toBe(false);
    });
});

describe("AnnotationCard navigation", () => {
    it("renders ‹ 1 / 3 › with Previous disabled on the first annotation", () => {
        render(makeAnnotation(), { navIndex: 0, navTotal: 3, onNavigate: vi.fn() });
        expect(container.querySelector('[data-annotation-nav="true"]')).toBeTruthy();
        expect(container.querySelector('[data-annotation-nav="true"]')!.textContent).toContain("1 / 3");
        const prev = container.querySelector("[data-annotation-nav-prev]") as HTMLButtonElement;
        const next = container.querySelector("[data-annotation-nav-next]") as HTMLButtonElement;
        expect(prev.disabled).toBe(true);
        expect(next.disabled).toBe(false);
    });

    it("disables Next on the last annotation", () => {
        render(makeAnnotation(), { navIndex: 2, navTotal: 3, onNavigate: vi.fn() });
        const prev = container.querySelector("[data-annotation-nav-prev]") as HTMLButtonElement;
        const next = container.querySelector("[data-annotation-nav-next]") as HTMLButtonElement;
        expect(prev.disabled).toBe(false);
        expect(next.disabled).toBe(true);
        expect(container.querySelector('[data-annotation-nav="true"]')!.textContent).toContain("3 / 3");
    });

    it("omits the nav row for a single annotation", () => {
        render(makeAnnotation(), { navIndex: 0, navTotal: 1, onNavigate: vi.fn() });
        expect(container.querySelector('[data-annotation-nav="true"]')).toBeNull();
    });

    it("steps with the nav buttons", () => {
        const onNavigate = vi.fn();
        render(makeAnnotation(), { navIndex: 1, navTotal: 3, onNavigate });
        click(container.querySelector("[data-annotation-nav-prev]"));
        click(container.querySelector("[data-annotation-nav-next]"));
        expect(onNavigate.mock.calls.map((call) => call[0])).toEqual([-1, 1]);
    });

    it("switches with ←/→ without moving focus", () => {
        const onNavigate = vi.fn();
        render(makeAnnotation(), { navIndex: 1, navTotal: 3, onNavigate });
        const next = container.querySelector("[data-annotation-nav-next]") as HTMLElement;
        next.focus();
        press(cardRoot(), "ArrowRight");
        press(next, "ArrowLeft");
        expect(onNavigate.mock.calls.map((call) => call[0])).toEqual([1, -1]);
        expect(document.activeElement).toBe(next);
    });

    it("ignores ←/→ at the boundaries", () => {
        const onNavigate = vi.fn();
        render(makeAnnotation(), { navIndex: 0, navTotal: 3, onNavigate });
        press(cardRoot(), "ArrowLeft");
        expect(onNavigate).not.toHaveBeenCalled();

        act(() => root.unmount());
        root = createRoot(container);
        render(makeAnnotation(), { navIndex: 2, navTotal: 3, onNavigate });
        press(cardRoot(), "ArrowRight");
        expect(onNavigate).not.toHaveBeenCalled();
    });

    it("does not steal arrow keys from the node textarea", () => {
        const onNavigate = vi.fn();
        render(makeAnnotation(), { navIndex: 1, navTotal: 3, onNavigate });
        click(container.querySelector('button[aria-label="Edit node text"]'));
        const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
        expect(textarea).toBeTruthy();
        press(textarea, "ArrowLeft");
        press(textarea, "ArrowRight");
        expect(onNavigate).not.toHaveBeenCalled();
    });
});

describe("AnnotationCard edit entry", () => {
    it("opens the editor for editable annotations", () => {
        const onEditAnnotation = vi.fn();
        render(makeAnnotation({ id: 5 }), { onEditAnnotation });
        const edit = container.querySelector('[data-annotation-edit="true"]') as HTMLButtonElement;
        expect(edit).toBeTruthy();
        expect(edit.disabled).toBe(false);
        click(edit);
        expect(onEditAnnotation).toHaveBeenCalledTimes(1);
        expect((onEditAnnotation.mock.calls[0][0] as AnnotationLike).id).toBe(5);
    });

    it("disables Edit with a read-only title for external annotations", () => {
        const onEditAnnotation = vi.fn();
        render(makeAnnotation({ source: "agent" }), { onEditAnnotation });
        const edit = container.querySelector('[data-annotation-edit="readonly"]') as HTMLButtonElement;
        expect(edit).toBeTruthy();
        expect(edit.disabled).toBe(true);
        expect(edit.getAttribute("title")).toBe("Written by an external agent — read only");
        expect(container.querySelector('[data-annotation-edit="true"]')).toBeNull();
        click(edit);
        expect(onEditAnnotation).not.toHaveBeenCalled();
    });

    it("honours the e shortcut only for editable annotations", () => {
        const onEditAnnotation = vi.fn();
        render(makeAnnotation({ id: 9 }), { onEditAnnotation });
        press(cardRoot(), "e");
        expect(onEditAnnotation).toHaveBeenCalledTimes(1);
        expect((onEditAnnotation.mock.calls[0][0] as AnnotationLike).id).toBe(9);

        act(() => root.unmount());
        root = createRoot(container);
        onEditAnnotation.mockClear();
        render(makeAnnotation({ id: 9, source: "agent" }), { onEditAnnotation });
        press(cardRoot(), "e");
        expect(onEditAnnotation).not.toHaveBeenCalled();
    });

    it("omits the edit entry when the caller cannot edit", () => {
        render(makeAnnotation());
        expect(container.querySelector("[data-annotation-edit]")).toBeNull();
    });
});

describe("AnnotationCard aria contract", () => {
    it("is a non-modal dialog labelled with the node seq", () => {
        render(makeAnnotation({ seq: 41 }));
        const card = cardRoot();
        expect(card).toBeTruthy();
        expect(card.getAttribute("aria-modal")).toBe("false");
        expect(card.getAttribute("aria-label")).toBe("Annotations for node #41");
        expect(card.getAttribute("data-annotation-card")).toBe("true");
    });
});
