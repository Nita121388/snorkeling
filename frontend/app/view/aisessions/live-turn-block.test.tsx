// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveTurnBlock, reduceLiveTurn, type LiveTurn } from "./use-live-turn";

// WaveStreamdown 依赖 app theme store，无法 SSR；测试只关心文本到达顺序，用纯文本替身。
vi.mock("@/app/element/streamdown", () => ({
    WaveStreamdown: ({ text }: { text: string }) => <span data-testid="md">{text}</span>,
}));

const initial: LiveTurn = { userText: "", userMessageSeqFloor: 0, items: [] };

describe("LiveTurnBlock", () => {
    it("shows a spinner while a tool is freshly started (status absent)", () => {
        const turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "bash" });
        const html = renderToStaticMarkup(<LiveTurnBlock turn={turn} />);
        expect(html).toContain("fa-spinner");
    });

    it("keeps the spinner after tool_call_update marks status=running", () => {
        // 回归：后端 tool_call_update 带 status="running"，旧代码只把
        // status==null 当运行中，update 一到就误判完成，spinner 从不出现。
        let turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "bash" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_update",
            toolName: "bash",
            toolStatus: "running",
            detail: '{"content":[]}',
        });
        const html = renderToStaticMarkup(<LiveTurnBlock turn={turn} />);
        expect(html).toContain("fa-spinner");
        // 行预览展示调用参数而不是结果
    });

    it("swaps the spinner for a status dot once the tool ends", () => {
        let turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "bash" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "bash",
            toolStatus: "completed",
            detail: '{"content":[{"text":"done"}]}',
        });
        const html = renderToStaticMarkup(<LiveTurnBlock turn={turn} />);
        expect(html).not.toContain("fa-spinner");
    });

    it("renders tool args (not result) as the row preview", () => {
        let turn = reduceLiveTurn(initial, {
            type: "tool_call_start",
            toolName: "bash",
            detail: 'args {"command":"sleep 2 && echo hi"}',
        });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "bash",
            toolStatus: "completed",
            detail: '{"content":[{"text":"hi"}]}',
        });
        const html = renderToStaticMarkup(<LiveTurnBlock turn={turn} />);
        expect(html).toContain("sleep 2 &amp;&amp; echo hi");
        // 默认折叠时结果不出现在任何位置（展开区未渲染）
        expect(html).not.toContain('"text":"hi"');
    });

    it("renders items in real arrival order (text, tool, text)", () => {
        let turn = reduceLiveTurn(initial, { type: "assistant_delta", text: "before" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "bash", toolCallId: "b1" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "bash",
            toolCallId: "b1",
            toolStatus: "completed",
        });
        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "after" });
        const html = renderToStaticMarkup(<LiveTurnBlock turn={turn} />);
        const idxBefore = html.indexOf("before");
        const idxTool = html.indexOf(">bash<");
        const idxAfter = html.indexOf("after");
        expect(idxBefore).toBeGreaterThan(-1);
        expect(idxTool).toBeGreaterThan(idxBefore);
        expect(idxAfter).toBeGreaterThan(idxTool);
    });
});
