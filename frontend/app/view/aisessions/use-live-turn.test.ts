import { describe, expect, it } from "vitest";
import { moveLiveTurn, reduceLiveTurn, reduceLiveTurns, type LiveTurn, type LiveTurns } from "./use-live-turn";

const initial: LiveTurn = { userText: "", userMessageSeqFloor: 0, items: [] };

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
            items: [
                { kind: "text", text: "first second" },
                { kind: "tool", tool: { id: "s1", name: "search", status: "completed", result: "done" } },
            ],
        });
    });

    it("preserves real arrival order when tools interleave with text", () => {
        let turn = reduceLiveTurn(initial, { type: "assistant_delta", text: "before" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "bash", toolCallId: "b1" });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "bash",
            toolCallId: "b1",
            toolStatus: "completed",
        });
        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "after" });

        expect(turn.items.map((item) => item.kind)).toEqual(["text", "tool", "text"]);
    });

    it("captures tool args from start and result from end separately", () => {
        let turn = reduceLiveTurn(initial, {
            type: "tool_call_start",
            toolName: "bash",
            detail: 'args {"command":"sleep 2"}',
        });
        turn = reduceLiveTurn(turn, {
            type: "tool_call_end",
            toolName: "bash",
            toolStatus: "completed",
            detail: '{"content":[]}',
        });

        expect(turn.items).toEqual([
            {
                kind: "tool",
                tool: { name: "bash", args: '{"command":"sleep 2"}', status: "completed", result: '{"content":[]}' },
            },
        ]);
    });

    it("updates the most recent matching tool", () => {
        let turn = reduceLiveTurn(initial, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "search" });
        turn = reduceLiveTurn(turn, { type: "tool_call_end", toolName: "search", toolStatus: "failed" });

        expect(turn.items).toEqual([
            { kind: "tool", tool: { name: "search" } },
            { kind: "tool", tool: { name: "search", status: "failed" } },
        ]);
    });

    it("keeps thinking segments stable after tool calls and assistant text start", () => {
        let turn = reduceLiveTurn(initial, { type: "thinking_delta", text: "checking " });
        turn = reduceLiveTurn(turn, { type: "thinking_delta", text: "files" });
        expect(turn.items).toEqual([{ kind: "thinking", text: "checking files" }]);

        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "read" });
        expect(turn.items[0]).toEqual({ kind: "thinking", text: "checking files" });

        turn = reduceLiveTurn(turn, { type: "assistant_delta", text: "answer" });
        expect(turn.items[0]).toEqual({ kind: "thinking", text: "checking files" });
        expect(turn.items.map((item) => item.kind)).toEqual(["thinking", "tool", "text"]);
    });

    it("splits thinking into separate segments across tool boundaries", () => {
        let turn = reduceLiveTurn(initial, { type: "thinking_delta", text: "plan" });
        turn = reduceLiveTurn(turn, { type: "tool_call_start", toolName: "read" });
        turn = reduceLiveTurn(turn, { type: "thinking_delta", text: "reflect" });

        expect(turn.items.map((item) => item.kind)).toEqual(["thinking", "tool", "thinking"]);
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
        expect(turn.items).toEqual([
            { kind: "tool", tool: { id: "a", name: "search", status: "completed" } },
            { kind: "tool", tool: { id: "b", name: "search" } },
        ]);
    });

    it("keeps simultaneous session streams isolated", () => {
        let turns: LiveTurns = {};
        turns = reduceLiveTurns(turns, "session-a", { type: "assistant_delta", text: "A" });
        turns = reduceLiveTurns(turns, "session-b", { type: "assistant_delta", text: "B" });
        turns = reduceLiveTurns(turns, "session-a", { type: "assistant_delta", text: "1" });

        expect(turns).toEqual({
            "session-a": { userText: "", userMessageSeqFloor: 0, items: [{ kind: "text", text: "A1" }] },
            "session-b": { userText: "", userMessageSeqFloor: 0, items: [{ kind: "text", text: "B" }] },
        });
    });

    it("moves a new-chat stream to its server session id", () => {
        const turns: LiveTurns = {
            "__new-chat-live-turn__": {
                userText: "hello",
                userMessageSeqFloor: 0,
                items: [{ kind: "text", text: "partial" }],
            },
        };

        expect(moveLiveTurn(turns, "__new-chat-live-turn__", "session-a")).toEqual({
            "session-a": {
                userText: "hello",
                userMessageSeqFloor: 0,
                items: [{ kind: "text", text: "partial" }],
            },
        });
    });
});

import { liveTurnToTimelineItems } from "./use-live-turn";

describe("liveTurnToTimelineItems", () => {
    it("renders live turn as history-style message/tool timeline items", () => {
        const turn: LiveTurn = {
            userText: "build it",
            userMessageSeqFloor: 0,
            items: [
                { kind: "thinking", text: "planning" },
                { kind: "text", text: "Let me " },
                { kind: "text", text: "check." },
                { kind: "tool", tool: { name: "bash", args: "ls", status: "running" } },
                { kind: "text", text: "Done." },
            ],
        };
        const items = liveTurnToTimelineItems(turn, false);
        expect(items[0]).toMatchObject({ kind: "message", message: { role: "user", text: "build it" } });
        // thinking + 连续 text 合并为一条 assistant 消息
        const assistant = items.find((i) => i.kind === "message" && i.message.role === "assistant" && i.message.text === "Let me \ncheck.");
        expect(assistant).toBeTruthy();
        if (assistant && assistant.kind === "message") {
            expect(assistant.message.thinking).toBe("planning");
        }
        // 工具转成带 running liveStatus 的 tool 项
        const tool = items.find((i) => i.kind === "tool");
        expect(tool).toMatchObject({ kind: "tool", liveStatus: "running" });
        if (tool && tool.kind === "tool") {
            expect(tool.toolCall.name).toBe("bash");
            expect(tool.toolCall.summary).toBe("ls");
        }
        // 用户消息已落盘时不再重复渲染 user echo
        const persistedItems = liveTurnToTimelineItems(turn, true);
        expect(persistedItems[0]).not.toMatchObject({ kind: "message", message: { role: "user" } });
    });

    it("marks failed tool liveStatus", () => {
        const turn: LiveTurn = {
            userText: "",
            userMessageSeqFloor: 0,
            items: [{ kind: "tool", tool: { name: "bash", status: "failed", result: "boom" } }],
        };
        const tool = liveTurnToTimelineItems(turn, true).find((i) => i.kind === "tool");
        expect(tool).toMatchObject({ kind: "tool", liveStatus: "failed" });
    });
});
