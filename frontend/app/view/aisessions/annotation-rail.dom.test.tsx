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
import { initI18n } from "@/i18n/config";
import type { AnnotationLike } from "./annotation-model";
import { AnnotationRail, type AnnotationGutterMarker } from "./annotation-rail";

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
            root.render(<AnnotationRail annotations={[makeAnnotation()]} onJump={vi.fn()} bottomInset={172} />);
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

describe("AnnotationRail Close fully dismisses card", () => {
    // 回归：钉住后点 ✕ 只清了 pinnedIndex，没清 openIndex，导致卡片不关、✕ 还消失。
    it("clicking Close fully closes the pinned card and clears open state", () => {
        render();
        clickTick();
        const close = container.querySelector('[aria-label="Close"]') as HTMLButtonElement;
        expect(close).toBeTruthy();
        act(() => {
            close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        // 卡片彻底关闭：没有 Accept 按钮，且 Close 也再消失。
        expect(findCardButton("Accept")).toBeUndefined();
        expect(container.querySelector('[aria-label="Close"]')).toBeNull();
    });
});

describe("AnnotationRail card placement (no clipping)", () => {
    // 回归：悬浮卡曾渲染在 bodyRef 滚动容器内、且在 dot 包裹层 transform 层叠上下文中，
    // 被 overflow 裁切 / 被聊天列盖住。现在卡片必须挂在 rail 根节点（bodyRef 之外）。
    it("pinned card is not rendered inside the scroll body", () => {
        render();
        clickTick();
        const card = container.querySelector('[data-row-action="true"]') as HTMLElement;
        expect(card).toBeTruthy();
        const body = container.querySelector('[data-testid="annotation-rail-body"]') as HTMLElement;
        expect(body).toBeTruthy();
        // 卡片不应是滚动 body 的后代——否则仍会被裁切。
        expect(card.closest('[data-testid="annotation-rail-body"]')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// v2 B1：行对齐 gutter（§4.2b）/ 状态矩阵 8 态 / 端帽三态 / 键盘 roving focus /
// scopeSeqs 收窄 / 类型过滤 / i18n key 锁定。
// 传 `markers` 即启用 gutter 路径（Step 7 由 session-detail 从 virtualizer 算好传入）。
// ─────────────────────────────────────────────────────────────────────────────

type RailProps = Partial<Parameters<typeof AnnotationRail>[0]>;

function makeGutterMarkers(annotations: AnnotationLike[]): AnnotationGutterMarker[] {
    return annotations.map((annotation, index) => ({ seq: annotation.seq, y: 40 + index * 80, items: [annotation] }));
}

function renderGutter(
    props: RailProps & { annotations?: AnnotationLike[]; markers?: AnnotationGutterMarker[] } = {}
) {
    const annotations = props.annotations ?? [
        makeAnnotation({ seq: 4, anchorKey: "a4" }),
        makeAnnotation({ id: 2, seq: 9, anchorKey: "a9" }),
    ];
    const markers = props.markers ?? makeGutterMarkers(annotations);
    const onJump = vi.fn();
    act(() => {
        root.render(<AnnotationRail annotations={annotations} onJump={onJump} markers={markers} {...props} />);
    });
    return { onJump, annotations, markers };
}

function byTestId(id: string): HTMLElement | null {
    return container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

function gutterMarkers(): HTMLElement[] {
    return Array.from(container.querySelectorAll('[data-testid="annotation-rail-marker"]')) as HTMLElement[];
}

function gutterMarkerButtons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll(".annotation-rail-marker-btn")) as HTMLButtonElement[];
}

function pressKey(target: Element, key: string) {
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

function clickEl(element: Element) {
    act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

describe("AnnotationRail v2 gutter — state matrix (8 states)", () => {
    beforeEach(() => {
        try {
            window.localStorage.setItem("aisessions.annotationRailCollapsed", "0");
        } catch {
            // ignore
        }
    });

    it("empty: 无批注 → 空态文案 + 生成入口，且不渲染标记", () => {
        renderGutter({ annotations: [], markers: [], onGenerateTimeline: vi.fn() });
        expect(byTestId("annotation-rail-empty")).toBeTruthy();
        expect(byTestId("annotation-rail-empty-text")!.textContent).toBe("No annotations");
        expect(container.querySelector(".annotation-rail-generate")).toBeTruthy();
        expect(gutterMarkers()).toHaveLength(0);
    });

    it("loading: 生成中且无条目 → 3 个 8px 骨架点", () => {
        renderGutter({ annotations: [], markers: [], generating: true });
        expect(container.querySelectorAll(".annotation-rail-skeleton")).toHaveLength(3);
        expect(byTestId("annotation-rail-empty-text")!.textContent).toBe("Generating");
    });

    it("error: 加载更早失败 → 端帽 ! 态，点击重试", () => {
        const onLoadOlder = vi.fn();
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], onLoadOlder, olderError: "boom", olderCount: 3 });
        const endcap = byTestId("annotation-rail-endcap")!;
        expect(endcap.className).toContain("is-error");
        expect(endcap.textContent).toBe("!");
        clickEl(endcap);
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
    });

    it("loaded: 有批注 → 每个可见行一个标记，类型色经 --ann-kind-color 注入", () => {
        renderGutter({
            annotations: [
                makeAnnotation({ seq: 4, anchorKey: "a4", kind: "note" }),
                makeAnnotation({ id: 2, seq: 9, anchorKey: "a9", kind: "milestone" }),
            ],
        });
        const list = gutterMarkers();
        expect(list).toHaveLength(2);
        expect(list[0].getAttribute("data-seq")).toBe("4");
        expect(list[0].getAttribute("data-shape")).toBe("dot");
        expect(list[0].style.getPropertyValue("--ann-kind-color")).toBe("var(--secondary-text-color)");
        expect(list[1].style.getPropertyValue("--ann-kind-color")).toBe("var(--accent-color)");
    });

    // Step 7b-1 接线契约：session-detail 的 markers 首帧是 `[]`（还没量到行位置）。
    // 此时有批注但无标记，rail 不得把这种情况误判成空态（否则每会话都闪一次
    // 「No annotations」）；读数仍是批注条数。
    it("markers 首帧未算完（[]）但已有批注：不出空态，读数照常", () => {
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], markers: [] });
        expect(byTestId("annotation-rail-empty")).toBeNull();
        expect(gutterMarkers()).toHaveLength(0);
        expect(byTestId("annotation-rail-count")!.textContent).toBe("1");
    });

    it("dense: 相邻标记 < MarkerMinGap 时向下推开 16px（不裁切）", () => {
        const annotations = [
            makeAnnotation({ seq: 4, anchorKey: "a4" }),
            makeAnnotation({ id: 2, seq: 9, anchorKey: "a9" }),
        ];
        renderGutter({
            annotations,
            markers: [
                { seq: 4, y: 40, items: [annotations[0]] },
                { seq: 9, y: 44, items: [annotations[1]] },
            ],
        });
        const list = gutterMarkers();
        expect(list[0].style.top).toBe("40px");
        expect(list[1].style.top).toBe("56px");
    });

    it("drafts: 存在草稿 → 草稿条 + 图标式批量动作", () => {
        renderGutter({
            annotations: [makeAnnotation({ seq: 4, status: "draft" })],
            onAcceptAllDrafts: vi.fn(),
            onDiscardAllDrafts: vi.fn(),
        });
        expect(byTestId("annotation-rail-drafts")).toBeTruthy();
        expect(byTestId("annotation-rail-drafts-count")!.textContent).toBe("1");
        expect(container.querySelector('button[aria-label="Accept all drafts"]')).toBeTruthy();
        expect(container.querySelector('button[aria-label="Discard all drafts"]')).toBeTruthy();
    });

    it("orphan: 孤儿锚点 → data-orphan（核色转 warning）", () => {
        renderGutter({ annotations: [makeAnnotation({ seq: 4, orphaned: true })] });
        expect(gutterMarkers()[0].getAttribute("data-orphan")).toBe("true");
    });

    it("collapsed: 折叠为 16px 轴 + 未读亮点；点击展开恢复标记", () => {
        try {
            window.localStorage.setItem("aisessions.annotationRailCollapsed", "1");
        } catch {
            // ignore
        }
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], pendingNewCount: 2 });
        const rail = byTestId("annotation-rail")!;
        expect(rail.className).toContain("is-collapsed");
        expect(rail.style.width).toBe("16px");
        expect(byTestId("annotation-rail-collapsed-dot")).toBeTruthy();
        expect(gutterMarkers()).toHaveLength(0);
        clickEl(rail);
        expect(byTestId("annotation-rail")!.className).not.toContain("is-collapsed");
        expect(gutterMarkers().length).toBeGreaterThan(0);
    });
});

describe("AnnotationRail v2 gutter — 视口裁剪 (§4.2b)", () => {
    it("y 为负或超出 body 高度的标记不渲染", () => {
        let roCallback: (() => void) | null = null;
        class MockResizeObserver {
            constructor(cb: () => void) {
                roCallback = cb;
            }
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        vi.stubGlobal("ResizeObserver", MockResizeObserver);
        try {
            const annotations = [
                makeAnnotation({ seq: 1, anchorKey: "a1" }),
                makeAnnotation({ id: 2, seq: 2, anchorKey: "a2" }),
                makeAnnotation({ id: 3, seq: 3, anchorKey: "a3" }),
            ];
            renderGutter({
                annotations,
                markers: [
                    { seq: 1, y: -40, items: [annotations[0]] },
                    { seq: 2, y: 200, items: [annotations[1]] },
                    { seq: 3, y: 900, items: [annotations[2]] },
                ],
            });
            const body = byTestId("annotation-rail-body")!;
            Object.defineProperty(body, "clientHeight", { configurable: true, get: () => 600 });
            act(() => {
                roCallback?.();
            });
            const list = gutterMarkers();
            expect(list).toHaveLength(1);
            expect(list[0].getAttribute("data-seq")).toBe("2");
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("AnnotationRail v2 gutter — 端帽三态 (§4.2b)", () => {
    it("↑N：还有更早条目 → 计数 + 点击加载", () => {
        const onLoadOlder = vi.fn();
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], olderCount: 5, onLoadOlder });
        const endcap = byTestId("annotation-rail-endcap")!;
        expect(endcap.textContent).toBe("↑5");
        expect(endcap.className).toContain("is-more");
        expect(endcap.getAttribute("aria-label")).toBe("5 older annotations");
        clickEl(endcap);
        expect(onLoadOlder).toHaveBeenCalledTimes(1);
    });

    it("…：加载中脉冲态且禁用（重复点击不重发）", () => {
        const onLoadOlder = vi.fn();
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], olderCount: 5, loadingOlder: true, onLoadOlder });
        const endcap = byTestId("annotation-rail-endcap") as HTMLButtonElement;
        expect(endcap.textContent).toBe("…");
        expect(endcap.className).toContain("is-loading");
        expect(endcap.disabled).toBe(true);
        expect(endcap.getAttribute("aria-label")).toBe("Loading older annotations…");
        clickEl(endcap);
        expect(onLoadOlder).not.toHaveBeenCalled();
    });

    it("非 all 模式（showLoadOlder=false）→ 不渲染端帽", () => {
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], olderCount: 5, showLoadOlder: false });
        expect(byTestId("annotation-rail-endcap")).toBeNull();
    });
});

describe("AnnotationRail v2 gutter — 键盘 roving focus (§4.4)", () => {
    const threeMarkers = [
        makeAnnotation({ seq: 1, anchorKey: "a1" }),
        makeAnnotation({ id: 2, seq: 2, anchorKey: "a2" }),
        makeAnnotation({ id: 3, seq: 3, anchorKey: "a3" }),
    ];

    it("rail 是 navigation，roving tabindex 只让一个标记可 Tab 到达", () => {
        renderGutter({ annotations: threeMarkers });
        const body = byTestId("annotation-rail-body")!;
        expect(body.getAttribute("role")).toBe("navigation");
        expect(body.getAttribute("aria-label")).toBe("Annotation timeline");
        const buttons = gutterMarkerButtons();
        expect(buttons).toHaveLength(3);
        expect(buttons[0].tabIndex).toBe(0);
        expect(buttons[1].tabIndex).toBe(-1);
        expect(buttons[2].tabIndex).toBe(-1);
    });

    it("↑/↓ 逐条移动 focus（不跳转），Home/End 首尾", () => {
        const { onJump } = renderGutter({ annotations: threeMarkers });
        const body = byTestId("annotation-rail-body")!;
        pressKey(body, "ArrowDown");
        let buttons = gutterMarkerButtons();
        expect(buttons[1].tabIndex).toBe(0);
        expect(document.activeElement).toBe(buttons[1]);
        pressKey(body, "End");
        buttons = gutterMarkerButtons();
        expect(buttons[2].tabIndex).toBe(0);
        expect(document.activeElement).toBe(buttons[2]);
        pressKey(body, "Home");
        expect(document.activeElement).toBe(gutterMarkerButtons()[0]);
        // 导航不触发跳转（§4.4：↑/↓ 不自动跳转）。
        expect(onJump).not.toHaveBeenCalled();
    });

    it("点击标记钉住卡片（Esc 关闭最上层）", () => {
        const { onJump } = renderGutter({ annotations: [makeAnnotation({ seq: 4 })] });
        clickEl(gutterMarkerButtons()[0]);
        expect(onJump).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-row-action="true"]')).toBeTruthy();
        pressKey(byTestId("annotation-rail")!, "Escape");
        expect(container.querySelector('[data-row-action="true"]')).toBeNull();
    });
});

describe("AnnotationRail v2 gutter — scopeSeqs 收窄 (§4.2c)", () => {
    it("作用域外条目不参与标记 / 读数 / 草稿条计数", () => {
        const inScope = makeAnnotation({ seq: 4, anchorKey: "a4", status: "draft" });
        const outScope = makeAnnotation({ id: 2, seq: 9, anchorKey: "a9", status: "draft" });
        renderGutter({
            annotations: [inScope, outScope],
            markers: [
                { seq: 4, y: 40, items: [inScope] },
                { seq: 9, y: 120, items: [outScope] },
            ],
            scopeSeqs: new Set([4]),
        });
        expect(gutterMarkers()).toHaveLength(1);
        expect(gutterMarkers()[0].getAttribute("data-seq")).toBe("4");
        expect(byTestId("annotation-rail-count")!.textContent).toBe("1");
        expect(byTestId("annotation-rail-drafts-count")!.textContent).toBe("1");
    });
});

describe("AnnotationRail v2 gutter — 类型过滤弹层 (§4.2b，5 类含 node)", () => {
    it("5 行类型；点行切换过滤，带计数与清除", () => {
        const note = makeAnnotation({ seq: 4, anchorKey: "a4", kind: "note" });
        const question = makeAnnotation({ id: 2, seq: 9, anchorKey: "a9", kind: "question" });
        renderGutter({ annotations: [note, question] });
        clickEl(container.querySelector('button[aria-label="Filter annotation types"]')!);
        const rows = Array.from(
            container.querySelectorAll('[data-testid="annotation-rail-filter-row"]')
        ) as HTMLElement[];
        expect(rows).toHaveLength(5);
        expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
            "note",
            "milestone",
            "decision",
            "question",
            "node",
        ]);
        expect(rows.every((row) => row.getAttribute("aria-pressed") === "true")).toBe(true);
        // 过滤掉 question → 只剩 note 标记，读数跟着收窄。
        const questionRow = rows.find((row) => row.getAttribute("data-kind") === "question")!;
        clickEl(questionRow);
        expect(gutterMarkers()).toHaveLength(1);
        expect(gutterMarkers()[0].getAttribute("data-seq")).toBe("4");
        expect(byTestId("annotation-rail-count")!.textContent).toBe("1");
        // 清除过滤 → 恢复全部。
        clickEl(container.querySelector(".annotation-rail-filter-clear")!);
        expect(gutterMarkers()).toHaveLength(2);
    });

    it("node kind 在 rail 上是菱形（data-shape=diamond）", () => {
        renderGutter({ annotations: [makeAnnotation({ seq: 4, kind: "node" })] });
        expect(gutterMarkers()[0].getAttribute("data-shape")).toBe("diamond");
    });
});

describe("AnnotationRail v2 gutter — 新批注 pill / i18n 文案", () => {
    it("pendingNewCount → pill 文案来自 i18n，点击才跳转（不自动跳）", () => {
        const onJumpToNew = vi.fn();
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], pendingNewCount: 2, onJumpToNew });
        const pill = byTestId("annotation-rail-newpill")!;
        expect(pill.getAttribute("aria-label")).toBe("Jump to new annotations");
        expect(pill.textContent).toContain("2 new annotations");
        clickEl(pill);
        expect(onJumpToNew).toHaveBeenCalledTimes(1);
    });

    it("标题 / 端帽 / rail aria-label 全部来自 i18n key", () => {
        renderGutter({ annotations: [makeAnnotation({ seq: 4 })], olderCount: 3 });
        expect(container.querySelector(".annotation-rail-title")!.textContent).toBe("Notes");
        expect(byTestId("annotation-rail-endcap")!.getAttribute("aria-label")).toBe("3 older annotations");
        expect(byTestId("annotation-rail-body")!.getAttribute("aria-label")).toBe("Annotation timeline");
    });
});
