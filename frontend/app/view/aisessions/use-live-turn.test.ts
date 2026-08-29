import { describe, expect, it } from "vitest";
import { moveLiveTurn, reduceLiveTurn, reduceLiveTurns, type LiveTurn, type LiveTurns } from "./use-live-turn";

const initial: LiveTurn = { userText: "", userMessageSeqFloor: 0, text: "", thinkingText: "", tools: [] };

describe("reduceLiveTurn", () => {
    it("keeps ordered text and tool lifecycle updates", () => {
        let turn = reduceLiveTurn(initial, { type: "message_start", role: "user", text: "hello" });
        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "first " });
        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "second" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "search", toolCallId: "s1" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_update",
            toolName: "search",
            toolCallId: "s1",
            detail: "partial",
        });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "search",
            toolStatus: "completed",
            detail: "done",
        });

        expect(turn).toEqual({
            userText: "hello",
            userMessageSeqFloor: 0,
            text: "first second",
            thinkingText: "",
            tools: [{ id: "s1", name: "search", status: "completed", detail: "done" }],
        });
    });

    it("updates the most recent matching tool", () => {
        let turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, { type: "tool_call_end", toolName: "search", toolStatus: "failed" });

        expect(turn.tools).toEqual([{ name: "search" }, { name: "search", status: "failed", detail: undefined }]);
    });

    it("keeps thinking visible after tool calls and assistant text start", () => {
        let turn = reduceLiveTurn(initial, { type: "thinking_delta", text: "checking " });
        turn = reduceLiveTurn(turn, { type: "thinking_delta", text: "files" });
        expect(turn.thinkingText).toBe("checking files");

        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "read" });
        expect(turn.thinkingText).toBe("checking files");

        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "answer" });
        expect(turn.thinkingText).toBe("checking files");
    });

    it("uses tool ids when same-named tools overlap", () => {
        let turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "search", toolCallId: "a" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "search", toolCallId: "b" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "search",
            toolCallId: "a",
            toolStatus: "completed",
        });
        expect(turn.tools).toEqual([
            { id: "a", name: "search", status: "completed", detail: undefined },
            { id: "b", name: "search" },
        ]);
    });

    it("keeps simultaneous session streams isolated", () => {
        let turns: LiveTurns = {};
        turns = reduceLiveTurns(turns, "session-a", { type: "assistant_delta", text: "A" });
        turns = reduceLiveTurns(turns, "session-b", { type: "assistant_delta", text: "B" });
        turns = reduceLiveTurns(turns, "session-a", { type: "assistant_delta", text: "1" });

        expect(turns).toEqual({
            "session-a": { userText: "", userMessageSeqFloor: 0, text: "A1", thinkingText: "", tools: [] },
            "session-b": { userText: "", userMessageSeqFloor: 0, text: "B", thinkingText: "", tools: [] },
        });
    });

    it("moves a new-chat stream to its server session id", () => {
        const turns: LiveTurns = {
            "__new-chat-live-turn__": {
                userText: "hello",
                userMessageSeqFloor: 0,
                text: "partial",
                thinkingText: "",
                tools: [],
            },
        };

        expect(moveLiveTurn(turns, "__new-chat-live-turn__", "session-a")).toEqual({
            "session-a": {
                userText: "hello",
                userMessageSeqFloor: 0,
                text: "partial",
                thinkingText: "",
                tools: [],
            },
        });
    });
});
