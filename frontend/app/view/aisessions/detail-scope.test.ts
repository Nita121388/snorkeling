// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话详情的查询范围（scope）必须一路带下去：
//   1. 详情块 meta 要带 origin（靠 OriginMetaKey 让新块恢复 origin，否则回落本机 manager）。
//   2. 详情弹窗的 Detail/DetailDelta/DetailTools 请求要带 connection 与 origin。
// 两条都是「Header 与正文对不上」的直接成因：Header 用会话自己的 origin，正文却落到
// local manager。
//
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store/global", () => ({
    atoms: { staticTabId: {} },
    createBlock: vi.fn(),
    createBlockSplitHorizontally: vi.fn(),
    globalStore: { get: () => null },
    refocusNode: vi.fn(),
    WOS: { getWaveObjectAtom: vi.fn(), makeORef: vi.fn() },
}));
vi.mock("@/store/services", () => ({
    ObjectService: { CreateBlock: vi.fn() },
    AISessionsServiceType: vi.fn(),
}));
vi.mock("@/layout/lib/layoutModelHooks", () => ({ getLayoutModelForStaticTab: vi.fn() }));
vi.mock("@/app/store/modalmodel", () => ({ modalsModel: { popModal: vi.fn() } }));
vi.mock("@/app/store/services", () => ({ AISessionsServiceType: vi.fn() }));
vi.mock("@/app/view/aisessions/session-detail", () => ({
    SessionDetailController: undefined,
    SessionDetailPane: () => null,
}));

import { sessionDetailBlockMeta } from "./session-detail-block";
import { detailRequestScope } from "@/app/modals/aisessiondetailmodal";
import { OriginMetaKey } from "./origin-state";

describe("sessionDetailBlockMeta", () => {
    it("stamps the origin meta so the block restores the external origin", () => {
        const meta = sessionDetailBlockMeta({
            sessionId: "claude:abc:/dumps/x.jsonl",
            connection: "my-remote",
            cwd: "/dumps",
            origin: "dump-abc123",
        });
        expect(meta["aisessions:sessionid"]).toBe("claude:abc:/dumps/x.jsonl");
        expect(meta["connection"]).toBe("my-remote");
        expect(meta["cmd:cwd"]).toBe("/dumps");
        expect(meta[OriginMetaKey]).toBe(JSON.stringify({ id: "dump-abc123" }));
    });

    it("omits origin meta for the local origin", () => {
        expect(sessionDetailBlockMeta({ sessionId: "s1", origin: "" })[OriginMetaKey]).toBeUndefined();
        expect(sessionDetailBlockMeta({ sessionId: "s1", origin: "local" })[OriginMetaKey]).toBeUndefined();
        expect(sessionDetailBlockMeta({ sessionId: "s1" })[OriginMetaKey]).toBeUndefined();
    });
});

describe("detailRequestScope", () => {
    const localSummary = { key: "claude:abc:/local/x.jsonl", id: "abc", source: "claude" } as SessionSummary;

    it("uses the loaded summary origin once the detail is open", () => {
        const summary = { ...localSummary, origin: "dump-abc123" } as SessionSummary;
        expect(detailRequestScope(summary)).toMatchObject({
            id: "claude:abc:/local/x.jsonl",
            origin: "dump-abc123",
        });
    });

    it("falls back to the opener scope while the summary has no origin tag", () => {
        expect(detailRequestScope(localSummary, { connection: "remote-1", origin: "dump-abc123" })).toMatchObject({
            id: "claude:abc:/local/x.jsonl",
            connection: "remote-1",
            origin: "dump-abc123",
        });
    });

    it("treats a local-tagged summary as the local origin", () => {
        const summary = { ...localSummary, origin: "local" } as SessionSummary;
        const scope = detailRequestScope(summary, { origin: "dump-abc123" });
        expect(scope.origin).toBeUndefined();
    });
});
