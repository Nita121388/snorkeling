// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `overview-card-send` 的锁：把一次 AgentSendCommand 的结果映射成卡片行程状态。
//
// 为什么值得锁：这是"发一句话给 agent"的唯一入口，映射顺序错一位就会把
//   · 等回复超时显示成"发送失败"（用户会重发，重复投递），
//   · 或者把"未确认提交"显示成"已提交"（用户以为对方收到了，其实文本卡在输入框）。
// 后端 `AgentSendResult` 已经把 injected/submitted/submitconfirmed/replied/warnings
// 都给了，客户端只允许按 design §3 的固定顺序判定。

import { describe, expect, it } from "vitest";
import { buildCardSendRequest, cardSendRpcTimeoutMs, outcomeFromSend } from "./overview-card-send";

function rtn(over: Record<string, any> = {}) {
    return {
        version: 1,
        ok: true,
        blockid: "b1",
        view: "term",
        injected: true,
        submitted: true,
        waitedms: 120,
        quietms: 400,
        submitdelayms: 150,
        submitconfirmed: true,
        ...over,
    } as any;
}

describe("outcomeFromSend", () => {
    it("ok + submitconfirmed → submitted", () => {
        const r = outcomeFromSend(rtn());
        expect(r.phase).toBe("submitted");
        expect(r.errorCode).toBeNull();
    });

    it("ok 但 submitconfirmed=false → unconfirmed（不许谎报已提交）", () => {
        const r = outcomeFromSend(rtn({ submitconfirmed: false }));
        expect(r.phase).toBe("unconfirmed");
    });

    it("replied=true 优先于 submitted", () => {
        const r = outcomeFromSend(rtn({ replied: true, turn: 7, replytext: "CARD_OK" }));
        expect(r.phase).toBe("replied");
        expect(r.replyText).toBe("CARD_OK");
        expect(r.turn).toBe(7);
    });

    it("warnings 含 reply-timeout → timeout，且不是 failed", () => {
        const r = outcomeFromSend(rtn({ warnings: ["reply-timeout"] }));
        expect(r.phase).toBe("timeout");
        expect(r.warnings).toContain("reply-timeout");
    });

    it("warnings 含 reply-rpc-deadline → timeout", () => {
        expect(outcomeFromSend(rtn({ warnings: ["reply-rpc-deadline"] })).phase).toBe("timeout");
    });

    it("抛错 → failed，并取出 E_ 码", () => {
        const r = outcomeFromSend(null, new Error("E_AGENT_NOT_READY: agent not ready (blockid=b1)"));
        expect(r.phase).toBe("failed");
        expect(r.errorCode).toBe("E_AGENT_NOT_READY");
        expect(r.errorMessage).toContain("agent not ready");
    });

    it("抛错但没有 E_ 码 → failed 且 code=null", () => {
        const r = outcomeFromSend(null, new Error("network down"));
        expect(r.phase).toBe("failed");
        expect(r.errorCode).toBeNull();
    });
});

describe("outcomeFromSend — 客户端超时不谎报失败（R8 假失败修复）", () => {
    it("EC-TIME timeout → unknown（不是 failed，请求可能已生效）", () => {
        const r = outcomeFromSend(null, new Error("EC-TIME: timeout waiting for response"));
        expect(r.phase).toBe("unknown");
        expect(r.errorCode).toBeNull();
    });

    it("其它客户端超时/取消（context deadline / EC-CTXT / EC-CANCEL）→ unknown", () => {
        expect(outcomeFromSend(null, new Error("context deadline exceeded")).phase).toBe("unknown");
        expect(outcomeFromSend(null, new Error("EC-CTXT: cancelled")).phase).toBe("unknown");
        expect(outcomeFromSend(null, new Error("EC-CANCEL: aborted")).phase).toBe("unknown");
    });

    it("明确的注入前错误（E_BLOCK_NOT_READY）→ failed 且保留错误码", () => {
        const r = outcomeFromSend(null, new Error("E_BLOCK_NOT_READY: block is not ready"));
        expect(r.phase).toBe("failed");
        expect(r.errorCode).toBe("E_BLOCK_NOT_READY");
    });
});

describe("cardSendRpcTimeoutMs — 覆盖服务端最坏预算（R8）", () => {
    it("等回复 60s → 290000（30s 安静等待 + 180s 提交确认 + 60s 等回复 + 20s 余量）", () => {
        expect(cardSendRpcTimeoutMs(60000, true)).toBe(290000);
    });

    it("不等回复 → 230000（不再硬编码 60s 假杀提交确认）", () => {
        expect(cardSendRpcTimeoutMs(undefined, false)).toBe(230000);
    });

    it("等回复窗口夹取 [5000, 300000] 且总预算不超过 360000", () => {
        expect(cardSendRpcTimeoutMs(1000, true)).toBe(235000);
        expect(cardSendRpcTimeoutMs(900000, true)).toBe(360000);
    });
});

describe("buildCardSendRequest", () => {
    it("空文本（含纯空白）→ 拒绝", () => {
        expect(buildCardSendRequest({ blockId: "b1", text: "   \n ", waitReply: false }).ok).toBe(false);
    });

    it("默认走 text64，不传裸 text", () => {
        const r = buildCardSendRequest({ blockId: "b1", text: "你好\nworld", waitReply: false });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.req.text).toBeUndefined();
        expect(typeof r.req.text64).toBe("string");
        expect(Buffer.from(r.req.text64!, "base64").toString("utf8")).toBe("你好\nworld");
        expect(r.req.waitreply).not.toBe(true);
        expect(r.req.async).not.toBe(true);
    });

    it("waitReply=true 时绝不带 async（服务端会 E_USAGE）", () => {
        const r = buildCardSendRequest({ blockId: "b1", text: "hi", waitReply: true });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.req.waitreply).toBe(true);
        expect(r.req.async).toBeUndefined();
    });

    it("waitms 夹取到 [5000, 300000]", () => {
        const hi = buildCardSendRequest({ blockId: "b1", text: "hi", waitReply: true, replyWaitMs: 900000 });
        const lo = buildCardSendRequest({ blockId: "b1", text: "hi", waitReply: true, replyWaitMs: 10 });
        if (!hi.ok || !lo.ok) throw new Error("should be ok");
        expect(hi.req.replywaitms).toBe(300000);
        expect(lo.req.replywaitms).toBe(5000);
    });

    it("chars 夹取到 [200, 8000]", () => {
        const lo = buildCardSendRequest({ blockId: "b1", text: "hi", waitReply: true, replyChars: 50 });
        const hi = buildCardSendRequest({ blockId: "b1", text: "hi", waitReply: true, replyChars: 99999 });
        if (!lo.ok || !hi.ok) throw new Error("should be ok");
        expect(lo.req.replychars).toBe(200);
        expect(hi.req.replychars).toBe(8000);
    });
});
