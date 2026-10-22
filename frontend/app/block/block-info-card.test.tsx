// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// BlockInfoCard 分派顺序测试。
//
// 只断言「分派到哪个组件」，不渲染卡片（卡片内部依赖 RPC / 全局 store）。
// 顺序契约：Note → Preview → SessionDetail → Chat → Agent → null。
//
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BlockInfoCard, NoteInfoCard, PreviewInfoCard } from "./block-info-card";
import { SessionDetailInfoCard } from "./session-detail-info-card";
import { AgentHoverCard } from "@/app/view/term/agent-hover-card";
import { SnorkelingBlockKindMetaKey, SnorkelingBlockKindNote } from "@/app/workspace/toggle-block";
import type * as React from "react";

function block(meta: Record<string, unknown>): Block {
    return { oid: "block-1", meta } as unknown as Block;
}

function dispatchedType(meta: Record<string, unknown>): unknown {
    const node = BlockInfoCard({ blockId: "block-1", blockData: block(meta) }) as React.ReactElement | null;
    return node?.type ?? null;
}

describe("BlockInfoCard dispatch", () => {
    it("dispatches Note blocks to NoteInfoCard", () => {
        expect(dispatchedType({ [SnorkelingBlockKindMetaKey]: SnorkelingBlockKindNote, file: "a.md" })).toBe(
            NoteInfoCard
        );
    });

    it("dispatches preview blocks to PreviewInfoCard", () => {
        expect(dispatchedType({ view: "preview", file: "a.md" })).toBe(PreviewInfoCard);
    });

    it("dispatches session detail blocks to SessionDetailInfoCard", () => {
        expect(dispatchedType({ view: "aisessions", "aisessions:sessionid": "id-1" })).toBe(
            SessionDetailInfoCard
        );
    });

    it("dispatches GUI chat blocks (newchat placeholder) to SessionDetailInfoCard", () => {
        expect(dispatchedType({ view: "aisessions", "aisessions:newchat": true })).toBe(
            SessionDetailInfoCard
        );
    });

    it("dispatches term agent blocks to AgentHoverCard", () => {
        expect(
            dispatchedType({ view: "term", "agent:sessionid": "sid", "agent:provider": "codex" })
        ).toBe(AgentHoverCard);
    });

    it("prefers SessionDetail over Agent when both meta shapes exist", () => {
        expect(
            dispatchedType({
                view: "aisessions",
                "aisessions:sessionid": "chat-id",
                "agent:sessionid": "tui-id",
                "agent:provider": "pi",
            })
        ).toBe(SessionDetailInfoCard);
    });

    it("prefers Note over every other shape", () => {
        expect(
            dispatchedType({
                [SnorkelingBlockKindMetaKey]: SnorkelingBlockKindNote,
                view: "aisessions",
                "aisessions:sessionid": "id-1",
            })
        ).toBe(NoteInfoCard);
    });

    it("returns null for unrelated blocks", () => {
        expect(dispatchedType({ view: "term" })).toBeNull();
        expect(dispatchedType({ view: "aisessions" })).toBeNull();
    });
});