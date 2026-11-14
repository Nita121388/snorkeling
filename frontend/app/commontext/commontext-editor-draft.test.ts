// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorDraftKey, clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./commontext-editor-draft";

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    localStorage.clear();
});

describe("commontext-editor-draft", () => {
    it("round-trips a draft through localStorage", () => {
        expect(loadEditorDraft()).toBeNull();
        saveEditorDraft({ text: "line one\nline two", caret: 9, insertedIds: ["ct-a", "ct-b"] });
        const draft = loadEditorDraft();
        expect(draft).not.toBeNull();
        expect(draft!.text).toBe("line one\nline two");
        expect(draft!.caret).toBe(9);
        expect(draft!.insertedIds).toEqual(["ct-a", "ct-b"]);
        expect(typeof draft!.savedat).toBe("number");
    });

    it("clears the persisted key when saving an empty draft", () => {
        saveEditorDraft({ text: "keep me", caret: 0, insertedIds: [] });
        expect(localStorage.getItem(EditorDraftKey)).not.toBeNull();
        saveEditorDraft({ text: "", caret: 0, insertedIds: [] });
        expect(localStorage.getItem(EditorDraftKey)).toBeNull();
        expect(loadEditorDraft()).toBeNull();
    });

    it("clearEditorDraft removes the key", () => {
        saveEditorDraft({ text: "temp", caret: 0, insertedIds: [] });
        clearEditorDraft();
        expect(localStorage.getItem(EditorDraftKey)).toBeNull();
    });

    it("silently drops corrupt JSON and clears it", () => {
        localStorage.setItem(EditorDraftKey, "{not json");
        expect(loadEditorDraft()).toBeNull();
        // 坏数据顺手清掉：下次 load 不再反复解析失败
        expect(localStorage.getItem(EditorDraftKey)).toBeNull();
    });

    it("rejects wrong-schema payloads (missing/typed fields, wrong version)", () => {
        const cases: unknown[] = [
            { v: 2, text: "x", caret: 0, insertedIds: [], savedat: 1 },
            { v: 1, caret: 0, insertedIds: [], savedat: 1 },
            { v: 1, text: "x", caret: -1, insertedIds: [], savedat: 1 },
            { v: 1, text: "x", caret: 0, insertedIds: ["ok", 42], savedat: 1 },
            { v: 1, text: "x", caret: 0, insertedIds: [], savedat: "yesterday" },
            null,
            "string",
        ];
        for (const payload of cases) {
            localStorage.setItem(EditorDraftKey, JSON.stringify(payload));
            expect(loadEditorDraft()).toBeNull();
        }
        localStorage.setItem(EditorDraftKey, JSON.stringify({ v: 1, text: "x", caret: 0, insertedIds: [] }));
        expect(loadEditorDraft()).toBeNull();
    });
});
