// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentCardModal 整卡放大弹窗的 DOM 契约（11-25 R3：放大不降级）：
//   · 弹窗内补看板卡同款「会话方块条 + 度量轨」—— 必须是共用组件
//     （SessionMessageSquares / SessionMetrics），断言锚点就是它们的类名，不是复刻版；
//   · 有历史消息 → .session-overview-message-square ≥ 1 且 .session-metrics 存在；
//   · 溢出 → +n（.session-overview-more）；
//   · 无 sessionId / 无消息 → 两区块整块不渲染（不留空行）；
//   · 方块点击 → pushModal("AISessionDetailModal", …)（与 footer 按钮同一条链路）。

// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock 工厂会被提升到模块体之前执行，普通 let 会踩 TDZ —— 用 vi.hoisted 的可变容器
// 在用例间切换 summary（度量轨数据源）。
const noteStateHolder = vi.hoisted(() => {
    const summary: SessionSummary | null = {
        key: "sess-1",
        id: "sess-1",
        source: "wave",
        messageCount: 12,
        size: 4096,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_600,
    };
    return { summary };
});

vi.mock("@/app/agent-status/agent-status-ack", () => ({
    ackAgentStatus: vi.fn(),
}));
vi.mock("@/app/block/block-info-card-meta", () => ({
    resolveBlockSessionId: vi.fn((meta: Record<string, unknown>) =>
        typeof meta["agent:sessionid"] === "string" ? meta["agent:sessionid"] : ""
    ),
}));
vi.mock("@/app/element/info-card/editable-title", () => ({
    EditableTitle: () => <span data-testid="editable-title" />,
}));
vi.mock("@/app/modals/modal", () => ({
    Modal: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
        <div className="modal">
            <div className="modal-body">{children}</div>
            <div className="modal-footer">{footer}</div>
        </div>
    ),
}));
vi.mock("@/app/view/term/agent-hover-card", () => ({
    AgentHoverCard: () => <div className="agent-hover-card" />,
}));
vi.mock("@/app/session-overview/session-overview-model", () => ({
    jumpToOverviewBlock: vi.fn(),
}));
vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { pushModal: vi.fn(), popModal: vi.fn() },
}));
vi.mock("@/app/store/session-note-hook", () => ({
    useAgentStatusForCard: vi.fn(() => null),
    useSessionNoteState: vi.fn(() => ({
        title: "pi agent",
        summary: noteStateHolder.summary,
        dirty: false,
        isEditing: false,
        noteDraft: "",
        status: "saved",
        marked: false,
        renameTitle: vi.fn(async () => null),
        toggleMarked: vi.fn(async () => null),
        saveNote: vi.fn(async () => null),
    })),
}));

const getCachedSessionDetail = vi.fn<(sessionId: string) => SessionDetail | null>(() => null);
const loadCachedSessionDetail = vi.fn<
    (service: unknown, sessionId: string, opts?: { forceRefresh?: boolean; tail?: number }) => Promise<SessionDetail>
>(() => Promise.reject(new Error("no session")));
vi.mock("@/app/session-overview/session-overview-session-cache", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/session-overview/session-overview-session-cache")>();
    return {
        ...actual,
        getCachedSessionDetail: (...args: Parameters<typeof actual.getCachedSessionDetail>) =>
            getCachedSessionDetail(...args),
        loadCachedSessionDetail: (...args: Parameters<typeof actual.loadCachedSessionDetail>) =>
            loadCachedSessionDetail(...args),
    };
});

import { modalsModel } from "@/app/store/modalmodel";
import { AgentCardModal } from "./agentcardmodal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function msg(seq: number, role: string, text: string): Message {
    return { seq, role, text, charCount: text.length };
}

function makeDetail(messages: Message[]): SessionDetail {
    return {
        summary: { key: "sess-1", id: "sess-1", source: "wave", messageCount: messages.length },
        messages,
        hasMore: false,
    };
}

function makeBlock(sessionId: string, connection = ""): Block {
    return {
        blockId: "block-1",
        tabId: "tab-1",
        view: "agent",
        meta: {
            "agent:sessionid": sessionId,
            ...(connection !== "" ? { connection } : {}),
        },
    } as unknown as Block;
}

type Mounted = { container: HTMLDivElement; root: Root };
const mounted: Mounted[] = [];

afterEach(() => {
    for (const { container, root } of mounted.splice(0)) {
        act(() => root.unmount());
        container.remove();
    }
    vi.clearAllMocks();
});

beforeEach(() => {
    getCachedSessionDetail.mockReset().mockReturnValue(null);
    loadCachedSessionDetail.mockReset().mockImplementation(() => Promise.reject(new Error("no session")));
    noteStateHolder.summary = {
        key: "sess-1",
        id: "sess-1",
        source: "wave",
        messageCount: 12,
        size: 4096,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_600,
    };
});

function mountModal(block: Block): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    act(() => {
        root.render(<AgentCardModal blockId="block-1" blockData={block} tabId="tab-1" />);
    });
    return container;
}

async function flushAsync(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

describe("AgentCardModal 放大不降级（11-25 R3）", () => {
    it("有历史消息 → 渲染共用方块条（.session-overview-message-square）+ 度量轨（.session-metrics）", async () => {
        getCachedSessionDetail.mockReturnValue(makeDetail([msg(1, "user", "hello"), msg(2, "assistant", "world")]));
        const container = mountModal(makeBlock("sess-1"));
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(2);
        expect(container.querySelector(".session-metrics")).not.toBeNull();
        expect(container.querySelector(".agent-card-modal-sections")).not.toBeNull();
        // modal surface 不挂 board 探针锚点（data-board-message-square 只属于看板）
        expect(container.querySelectorAll("[data-board-message-square]")).toHaveLength(0);
    });

    it("缓存 miss → loadCachedSessionDetail 拉取后渲染", async () => {
        getCachedSessionDetail.mockReturnValue(null);
        loadCachedSessionDetail.mockResolvedValue(makeDetail([msg(1, "user", "hello")]));
        const container = mountModal(makeBlock("sess-1"));
        // 初值（缓存 miss）：先无方块
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(0);
        await flushAsync();
        await flushAsync();
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(1);
        expect(loadCachedSessionDetail).toHaveBeenCalledWith(expect.anything(), "sess-1", { tail: 100 });
    });

    it("溢出 → +n 计数", async () => {
        const messages = Array.from({ length: 13 }, (_, i) => msg(i + 1, "user", `m${i + 1}`));
        getCachedSessionDetail.mockReturnValue(makeDetail(messages));
        const container = mountModal(makeBlock("sess-1"));
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(10);
        expect(container.querySelector(".session-overview-more")?.textContent).toBe("+3");
    });

    it("度量数据全空 → 度量轨自身返回 null（不留空行）", () => {
        noteStateHolder.summary = null;
        getCachedSessionDetail.mockReturnValue(makeDetail([msg(1, "user", "hello")]));
        const container = mountModal(makeBlock("sess-1"));
        // 方块条还在（有消息）
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(1);
        // 度量轨自身 null
        expect(container.querySelector(".session-metrics")).toBeNull();
    });

    it("无 sessionId → 两区块整块不渲染", () => {
        const container = mountModal(makeBlock(""));
        expect(container.querySelector(".agent-card-modal-sections")).toBeNull();
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(0);
        expect(container.querySelector(".session-metrics")).toBeNull();
        expect(getCachedSessionDetail).not.toHaveBeenCalled();
    });

    it("无消息 → 不渲染方块行（不留空行）", async () => {
        getCachedSessionDetail.mockReturnValue(makeDetail([msg(1, "tool", "[Tool: bash]"), msg(2, "assistant", "")]));
        const container = mountModal(makeBlock("sess-1"));
        await flushAsync();
        expect(container.querySelectorAll(".session-overview-message-square")).toHaveLength(0);
        expect(container.querySelector(".session-overview-message-strip")).toBeNull();
    });

    it("点击方块 → push AISessionDetailModal（与 footer「打开会话详情」同一条链路）", async () => {
        getCachedSessionDetail.mockReturnValue(makeDetail([msg(1, "user", "hello")]));
        const container = mountModal(makeBlock("sess-1", "remote-1"));
        act(() => {
            container
                .querySelector<HTMLElement>(".session-overview-message-square")!
                .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(modalsModel.pushModal).toHaveBeenCalledTimes(1);
        expect(modalsModel.pushModal).toHaveBeenCalledWith("AISessionDetailModal", {
            sessionId: "sess-1",
            connection: "remote-1",
        });
    });

    it("footer「打开会话详情」仍是同一条链路（回归锚点）", async () => {
        getCachedSessionDetail.mockReturnValue(makeDetail([msg(1, "user", "hello")]));
        const container = mountModal(makeBlock("sess-1", "remote-1"));
        act(() => {
            container
                .querySelector<HTMLElement>("[data-agent-card-detail]")!
                .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(modalsModel.pushModal).toHaveBeenCalledWith("AISessionDetailModal", {
            sessionId: "sess-1",
            connection: "remote-1",
        });
    });
});
