import { describe, expect, it } from "vitest";
import { moveLiveTurn, reduceLiveTurn, reduceLiveTurns, type LiveTurn, type LiveTurns } from "./use-live-turn";

const initial: LiveTurn = { userText: "", text: "", thinking: false, tools: [] };

describe("reduceLiveTurn", () => {
    it("keeps ordered text and tool lifecycle updates", () => {
        let turn = reduceLiveTurn(initial, { type: "message_start", role: "user", text: "hello" });
        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "first " });
        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "second" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "search",
            toolStatus: "completed",
            detail: "done",
        });

        expect(turn).toEqual({
            userText: "hello",
            text: "first second",
            thinking: false,
            tools: [{ name: "search", status: "completed", detail: "done" }],
        });
    });

    it("updates the most recent matching tool", () => {
        let turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, { type: "tool_call_end", toolName: "search", toolStatus: "failed" });

        expect(turn.tools).toEqual([{ name: "search" }, { name: "search", status: "failed", detail: undefined }]);
    });

    it("keeps simultaneous session streams isolated", () => {
        let turns: LiveTurns = {};
        turns = reduceLiveTurns(turns, "session-a", { type: "assistant_delta", text: "A" });
        turns = reduceLiveTurns(turns, "session-b", { type: "assistant_delta", text: "B" });
        turns = reduceLiveTurns(turns, "session-a", { type: "assistant_delta", text: "1" });

        expect(turns).toEqual({
            "session-a": { userText: "", text: "A1", thinking: false, tools: [] },
            "session-b": { userText: "", text: "B", thinking: false, tools: [] },
        });
    });

    it("moves a new-chat stream to its server session id", () => {
        const turns: LiveTurns = {
            "__new-chat-live-turn__": { userText: "hello", text: "partial", thinking: false, tools: [] },
        };

        expect(moveLiveTurn(turns, "__new-chat-live-turn__", "session-a")).toEqual({
            "session-a": { userText: "hello", text: "partial", thinking: false, tools: [] },
        });
    });
});
