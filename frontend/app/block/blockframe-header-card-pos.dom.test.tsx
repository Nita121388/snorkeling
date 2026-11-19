// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// BlockFrame_Header 的 agent hover 卡定位测试（jsdom DOM 层）。
//
// 锁定的回归点（11-06-tab-hover-clip 复发报告）：
//  agent 卡容器曾写死 position:absolute; top:100%; left:0，无视口钳位 ——
//  block 靠右 / 靠下时整卡被窗口裁掉。修复后卡片 portal 到 body（fixed 像素坐标），
// 坐标 = computeCardPos({ rect: header矩形, card: 卡片实测尺寸, viewport, placement: "bottom" })。
//
// 判据（验收规约）：
//  1. header 靠视口右缘 → 卡片渲染后 right ≤ viewport.width（且 left 被向内钳位）。
//  2. header 靠视口下缘（下方放不下）→ 卡片翻到上方 / 被钳位，bottom ≤ viewport.height。
//  3. 窗口 resize 时卡片还开着 → 重算坐标，仍整卡在视口内。
//  4. 卡片必须挂在 document.body（portal），class 保留 info-card-portal。
//  5. 交互红线不回归：点击卡片外侧关闭、点击卡片内部不关闭、焦点钉住后移开不关。
//
// 手法（参照 info-card-hover.dom.test.tsx）：真实挂载组件 + 重写 getBoundingClientRect
// 喂几何夹具（jsdom 原始实现全返回 0，必须靠 mock 才能让钳位判据见到真实数字）。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { atom } from "jotai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeCardPos } from "@/app/element/info-card/info-card-pos";
import { initI18n } from "@/i18n/config";
import { BlockFrame_Header } from "./blockframe-header";
import type { NodeModel } from "@/layout/index";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── 重型依赖置空（参照 blockframe-header.menu.test.ts 的 mock 基建；另补渲染路径需要的）──
vi.mock("@/app/block/blockutil", () => ({
    blockViewToIcon: () => null,
    blockViewToName: () => "term",
    getViewIconElem: () => null,
    renderHeaderElements: () => [],
    OptMagnifyButton: () => null,
}));
vi.mock("@/app/block/connectionbutton", () => ({ ConnectionButton: () => null }));
vi.mock("@/app/block/durable-session-flyover", () => ({ DurableSessionFlyover: () => null }));
vi.mock("@/app/block/block-info-card", async () => {
    // 不能在 factory 里写 JSX：hoist 后的 jsx-runtime 引用会死锁 vitest（实测），用 createElement。
    // 卡片内容只需一个可聚焦元素（焦点钉住用例）与一个可点元素（点击外侧用例）。
    const { createElement } = await import("react");
    return {
        BlockInfoCard: () =>
            createElement("button", { type: "button", "data-testid": "card-content" }, "card content"),
    };
});
vi.mock("@/app/store/badge", async () => {
    const { atom } = await import("jotai");
    // factory 只执行一次：闭包里缓存首个 atom，保证多次 render 拿到同一实例（避免重订阅循环）。
    let badgeAtom: unknown = null;
    return {
        getBlockBadgeAtom: () => {
            if (badgeAtom == null) {
                badgeAtom = atom(null);
            }
            return badgeAtom as ReturnType<typeof atom>;
        },
    };
});
vi.mock("@/app/store/global", () => ({
    createBlockSplitHorizontally: () => {},
    createBlockSplitVertically: () => {},
    globalStore: { get: () => undefined, set: () => {} },
    recordTEvent: () => {},
    refocusNode: () => {},
    WOS: { makeORef: (otype: string, oid: string) => `${otype}:${oid}` },
}));
vi.mock("@/app/store/jotaiStore", () => ({ globalStore: { get: () => undefined, set: () => {} } }));
vi.mock("@/app/store/keymodel", () => ({ uxCloseBlock: async () => {} }));
vi.mock("@/app/store/tab-model", () => ({ useTabModel: () => ({ tabId: "t1" }) }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/app/store/wos", () => ({
    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
    getWaveObjectAtom: () => null,
}));
vi.mock("@/app/element/iconbutton", () => ({ IconButton: () => null }));
vi.mock("@/layout/index", () => ({ getLayoutModelForTabById: () => null }));
vi.mock("@/layout/lib/inlineTabs", () => ({ getLayoutDataBlockIds: () => [] }));
vi.mock("@/app/tab/tab-target-modal", () => ({ TabTargetModal: () => null }));
vi.mock("@/app/view/hero/hero-create-wizard", () => ({ openHeroCreateWizard: async () => {} }));
vi.mock("@/app/view/term/agent-folder", () => ({
    canOpenAgentFolder: () => false,
    openAgentFolderInCurrentTab: () => {},
}));
vi.mock("@/app/view/term/agent-session", () => ({
    resolveAgentSessionIdFromMeta: () => "",
    resolveAgentSessionId: () => ({ sessionId: "" }),
}));
vi.mock("@/app/workspace/toggle-block", () => ({
    insertBlockAtFixedLeftOrder: () => {},
    SnorkelingBlockKindMetaKey: "snorkeling:blockkind",
    SnorkelingBlockKindNote: "note",
}));
vi.mock("@/app/block/block-minimize", () => ({
    minimizeBlockToFloat: () => {},
    restoreMinimizedBlockToLayout: () => null,
}));

// ── waveEnv：getBlockMetaKeyAtom/getSettingsKeyAtom/wos 全换成稳定 atom，避免重渲染循环 ──
vi.mock("@/app/waveenv/waveenv", async () => {
    const { atom } = await import("jotai");
    const keyAtoms = new Map<string, ReturnType<typeof atom>>();
    const waveEnv = {
        getBlockMetaKeyAtom: (blockId: string, key: string) => {
            const k = `meta:${key}`;
            if (!keyAtoms.has(k)) {
                keyAtoms.set(k, atom(key === "view" ? "term" : null));
            }
            return keyAtoms.get(k)!;
        },
        getSettingsKeyAtom: (key: string) => {
            const k = `set:${key}`;
            if (!keyAtoms.has(k)) {
                keyAtoms.set(k, atom(true));
            }
            return keyAtoms.get(k)!;
        },
        wos: {
            getWaveObjectAtom: () => {
                const k = "wos:block";
                if (!keyAtoms.has(k)) {
                    // agent:sessionid 让 isAgentCardMeta 命中 → 卡片渲染分支开启
                    keyAtoms.set(k, atom({ oid: "block-1", meta: { view: "term", "agent:sessionid": "sid-1" } }));
                }
                return keyAtoms.get(k)!;
            },
        },
        atoms: { workspace: atom({ tabids: ["t1"] }) },
        rpc: { ActivityCommand: () => {} },
        electron: { setActiveTab: () => {} },
        services: { object: {} },
    };
    return { useWaveEnv: () => waveEnv };
});

type RectLike = {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
};

function fullRect(partial: { top: number; bottom: number; left: number; right: number }): RectLike {
    return {
        ...partial,
        width: partial.right - partial.left,
        height: partial.bottom - partial.top,
    };
}

const originalGetRect = Element.prototype.getBoundingClientRect;

/** 把一个几何夹具安装进 Element.prototype：header 与 info-card-portal 分别喂假矩形。 */
function installRects(headerRect: { top: number; bottom: number; left: number; right: number }, cardSize: { width: number; height: number }) {
    Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.getAttribute("data-role") === "block-header") {
            return fullRect(headerRect) as DOMRect;
        }
        if (this.classList.contains("info-card-portal")) {
            return {
                top: 0,
                bottom: cardSize.height,
                left: 0,
                right: cardSize.width,
                width: cardSize.width,
                height: cardSize.height,
            } as DOMRect;
        }
        return originalGetRect.call(this);
    };
}

function restoreRects() {
    Element.prototype.getBoundingClientRect = originalGetRect;
}

// ── 挂载基建 ──
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const headerEl = () => document.querySelector<HTMLElement>('[data-role="block-header"]');
const cardEl = () => document.querySelector<HTMLDivElement>(".info-card-portal");

function makeNodeModel(): NodeModel {
    return {
        blockId: "block-1",
        dragHandleRef: null,
        isMagnified: atom(false),
        layoutData: atom(undefined),
        additionalProps: atom(undefined),
        isEphemeral: atom(false),
        isMinimizedPreview: atom(false),
        numLeafs: atom(1),
        toggleMagnify: () => {},
        onClose: () => {},
        addEphemeralNodeToLayout: () => {},
    } as unknown as NodeModel;
}

function setViewport(width: number, height: number) {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
}

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const changeConnModalAtom = atom(false);
    act(() => {
        root.render(
            <BlockFrame_Header
                preview={false}
                nodeModel={makeNodeModel()}
                viewModel={null as unknown as ViewModel}
                changeConnModalAtom={changeConnModalAtom}
                error={undefined}
            />
        );
    });
    expect(headerEl()).not.toBeNull();
}

/** 打开卡片：pointerover 进 header（React 的 onPointerEnter 由 pointerover 模拟 enter）。 */
function openCard() {
    act(() => {
        headerEl()!.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: null }));
    });
}

function clickOutside() {
    act(() => {
        document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
}

function leaveCard() {
    act(() => {
        cardEl()!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });
}

const CARD_SIZE = { width: 300, height: 400 };

describe("BlockFrame_Header agent hover card 定位（钳位）", () => {
    beforeAll(async () => {
        await initI18n("en");
    });

    beforeEach(() => {
        setViewport(800, 600);
    });

    afterEach(() => {
        restoreRects();
        act(() => root.unmount());
        container.remove();
    });

    it("header 靠视口右缘：卡片 left 被向内钳位，right ≤ viewport.width", () => {
        // header 右缘顶到视口右缘（left=500, right=800），卡片宽 300 → 需要钳位 92px。
        const headerRect = { top: 100, bottom: 140, left: 500, right: 800 };
        mount();
        installRects(headerRect, CARD_SIZE);
        openCard();

        const el = cardEl();
        expect(el).not.toBeNull();
        expect(el!.parentNode).toBe(document.body); // portal 锚点
        expect(el!.classList.contains("info-card-portal")).toBe(true); // 选择器锚点不丢
        expect(el!.style.position).toBe("fixed");

        const expected = computeCardPos({
            rect: headerRect,
            card: CARD_SIZE,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            placement: "bottom",
        });
        expect(el!.style.left).toBe(`${expected.left}px`);
        expect(el!.style.top).toBe(`${expected.top}px`);

        const right = expected.left + CARD_SIZE.width;
        expect(right).toBeLessThanOrEqual(window.innerWidth);
        // 必须真的发生了向内钳位（left < header.left），而不是原封不动输出
        expect(expected.left).toBeLessThan(headerRect.left);
    });

    it("header 靠视口下缘：卡片翻到上方，bottom ≤ viewport.height", () => {
        // header 底缘顶到视口底缘（top=560, bottom=600），卡片高 400 → 下方放不下，翻到上方。
        const headerRect = { top: 560, bottom: 600, left: 50, right: 350 };
        mount();
        installRects(headerRect, CARD_SIZE);
        openCard();

        const el = cardEl();
        expect(el).not.toBeNull();
        const expected = computeCardPos({
            rect: headerRect,
            card: CARD_SIZE,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            placement: "bottom",
        });
        expect(el!.style.top).toBe(`${expected.top}px`);

        // 上方放得下 → 必须真的翻了（top < header.top），而不是留在下方被裁剪
        expect(expected.top).toBeLessThan(headerRect.top);
        expect(expected.top + CARD_SIZE.height).toBeLessThanOrEqual(window.innerHeight);
    });

    it("窗口 resize 时卡片还开着：重算坐标，仍整卡在视口内", () => {
        const headerRect = { top: 100, bottom: 140, left: 500, right: 800 };
        mount();
        installRects(headerRect, CARD_SIZE);
        openCard();

        let el = cardEl()!;
        expect(parseInt(el.style.left, 10) + CARD_SIZE.width).toBeLessThanOrEqual(window.innerWidth);

        // 窗口收窄到 400：maxLeft=400-8-300=92，卡片必须被挤进新视口。
        setViewport(400, 600);
        act(() => {
            window.dispatchEvent(new Event("resize"));
        });

        el = cardEl()!;
        expect(el).not.toBeNull(); // resize 不关卡
        const expected = computeCardPos({
            rect: headerRect,
            card: CARD_SIZE,
            viewport: { width: 400, height: 600 },
            placement: "bottom",
        });
        expect(el.style.left).toBe(`${expected.left}px`);
        expect(expected.left + CARD_SIZE.width).toBeLessThanOrEqual(400);
    });

    it("点击卡片外侧立即关闭（portal 后 DOM 包含判定仍正确）", () => {
        mount();
        installRects({ top: 100, bottom: 140, left: 50, right: 350 }, CARD_SIZE);
        openCard();
        expect(cardEl()).not.toBeNull();
        clickOutside();
        expect(cardEl()).toBeNull();
    });

    it("点击卡片内部不关闭（portal 后 cardElRef 包含判定仍正确）", () => {
        mount();
        installRects({ top: 100, bottom: 140, left: 50, right: 350 }, CARD_SIZE);
        openCard();
        const btn = cardEl()!.querySelector<HTMLButtonElement>('[data-testid="card-content"]')!;
        act(() => {
            btn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
        });
        expect(cardEl()).not.toBeNull();
    });

    it("焦点钉住：卡片内聚焦后指针移开不关闭；点击外侧才关闭", () => {
        mount();
        installRects({ top: 100, bottom: 140, left: 50, right: 350 }, CARD_SIZE);
        openCard();
        const btn = cardEl()!.querySelector<HTMLButtonElement>('[data-testid="card-content"]')!;
        act(() => {
            btn.focus();
        });
        leaveCard();
        expect(cardEl()).not.toBeNull(); // 焦点钉住，mouseleave 不关
        clickOutside();
        expect(cardEl()).toBeNull(); // 只剩点击外侧能关
    });
});