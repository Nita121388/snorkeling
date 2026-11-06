// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// property-store 的内置属性写入契约。
//
// 锁定的回归点（用户实际报过的 bug）：
//   删标签时如果只改 tags 数组、不清 note 正文里的 `#tag`，后端
//   `SetNoteAndTags` 的 `MergeSessionTags(tags, ExtractSessionTagsFromNote(note))`
//   会把这些标签**合并回来** —— 用户看到的是「删了但没保存 / 删了又回来了」。
//
//   其它入口（session-detail / session-row / commontext）早就都调
//   `removeSessionTagFromNote` 了，卡片浮层这条路径曾经漏掉。

import { beforeEach, describe, expect, it, vi } from "vitest";

const saveSessionNote = vi.fn();
const saveSessionProps = vi.fn();

vi.mock("@/app/store/session-note-cache", () => ({
    saveSessionNote: (...args: unknown[]) => saveSessionNote(...args),
    saveSessionProps: (...args: unknown[]) => saveSessionProps(...args),
}));

vi.mock("../session-note-events", () => ({
    dispatchAISessionNoteUpdated: vi.fn(),
}));

import { BUILTIN_PROP_KEYS, type PropertyDef } from "./property-model";
import { setSessionProperty } from "./property-store";

const tagsDef: PropertyDef = {
    key: BUILTIN_PROP_KEYS.tags,
    name: "Tags",
    type: "multi_select",
    order: 4,
    scope: "session",
    builtin: true,
};

function summaryWith(note: string, tags: string[]): SessionSummary {
    return { key: "codex:abc:/tmp/a.jsonl", id: "abc", source: "codex", note, tags } as SessionSummary;
}

function callArgs(summary: SessionSummary, value: unknown) {
    return {
        service: {} as never,
        sessionId: "abc",
        connection: "",
        summary,
        def: tagsDef,
        value: value as never,
    };
}

describe("setSessionProperty — 内置 tags", () => {
    beforeEach(() => {
        saveSessionNote.mockReset();
        saveSessionProps.mockReset();
        saveSessionNote.mockResolvedValue({ status: "ok", summary: {} });
    });

    it("删除标签时同步从 note 里移除对应的 #tag（否则后端会把它合并回来）", async () => {
        const summary = summaryWith("排查登录问题 #fix #ui", ["fix", "ui"]);

        await setSessionProperty(callArgs(summary, ["ui"]));

        expect(saveSessionNote).toHaveBeenCalledTimes(1);
        const [, , , note, tags] = saveSessionNote.mock.calls[0];
        // 关键断言：note 里的 `#fix` 被清掉了
        expect(note).not.toContain("#fix");
        expect(note).toContain("排查登录问题");
        expect(note).toContain("#ui");
        expect(tags).toEqual(["ui"]);
    });

    it("删除多个标签时逐个清理", async () => {
        const summary = summaryWith("A #one B #two C #three", ["one", "two", "three"]);

        await setSessionProperty(callArgs(summary, ["two"]));

        const [, , , note, tags] = saveSessionNote.mock.calls[0];
        expect(note).not.toContain("#one");
        expect(note).not.toContain("#three");
        expect(note).toContain("#two");
        expect(tags).toEqual(["two"]);
    });

    it("新增标签不动 note（只有删除才需要清理）", async () => {
        const summary = summaryWith("排查登录问题 #fix", ["fix"]);

        await setSessionProperty(callArgs(summary, ["fix", "ui"]));

        const [, , , note, tags] = saveSessionNote.mock.calls[0];
        expect(note).toBe("排查登录问题 #fix");
        expect(tags).toEqual(["fix", "ui"]);
    });

    it("删光所有标签时 note 里的 #tag 全部清掉", async () => {
        const summary = summaryWith("只有标签 #fix #ui", ["fix", "ui"]);

        await setSessionProperty(callArgs(summary, []));

        const [, , , note, tags] = saveSessionNote.mock.calls[0];
        expect(note).not.toContain("#fix");
        expect(note).not.toContain("#ui");
        expect(tags).toEqual([]);
    });

    it("note 里的标签写法与 tags 数组不同大小写也能清掉", async () => {
        const summary = summaryWith("排查 #Fix", ["fix"]);

        await setSessionProperty(callArgs(summary, []));

        const [, , , note] = saveSessionNote.mock.calls[0];
        expect(note.toLowerCase()).not.toContain("#fix");
    });

    it("保存失败时把错误回传给调用方（不能静默）", async () => {
        saveSessionNote.mockResolvedValue({ status: "error", error: "rpc down" });
        const summary = summaryWith("note #fix", ["fix"]);

        const result = await setSessionProperty(callArgs(summary, []));

        expect(result).toEqual({ ok: false, error: "rpc down" });
    });
});
