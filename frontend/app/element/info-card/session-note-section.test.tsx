// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionNoteSection 写路径的 id 契约回归测试（jsdom）。
//
// 锁定的 bug（2026-11-09 用户反馈「agent 卡片上删标签后显示保存失败」）：
//   block 侧卡片把 **裸 sessionId**（meta `agent:sessionid`，如 `0e0b108c-…`）交给
//   useSessionNoteState，note-cache 按 (sessionId, connection) 建档；但卡片里的属性
//   写路径（标签增删 / 自定义属性 / 重命名 / 换类型 / 排序 / Undo）曾用 `summary.key`
//   这个**完整 stable key**（`pi:<id>:<path>`）调用 saveSessionNote / saveSessionProps。
//   getEntry 命不中 → `before == null` → 直接返回 "session summary not loaded"，
//   UI 显示「保存失败：session summary not loaded」，乐观更新随即回滚。
//
// 不变量：缓存型写路径必须与 hook 建档用同一个 id（`state.sessionId`）。
// 直接走 RPC 的路径（GenActionButton / AISessionNoteModal / AIPropertiesButton 的
// SetProps）用 summary.key 是合法的，不在本测试范围。

// @vitest-environment jsdom

import type { SessionNoteState } from "@/app/store/session-note-hook";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW_ID = "0e0b108c-3149-408c-805b-3493af6b2cdc";
const FULL_KEY = `pi:${RAW_ID}:/Users/nita/.pi/agent/sessions/x.jsonl`;

const h = vi.hoisted(() => ({
    listProps: null as any,
    useNoteUndoArgs: null as any[] | null,
    setSessionProperty: vi.fn(async (_args: any) => ({ ok: true })),
    patchSessionProperty: vi.fn(async (_args: any) => ({ ok: true })),
    saveSessionProps: vi.fn(async () => ({ status: "ok", summary: {} })),
    schemaBase: [] as any[],
    setPropertySchema: vi.fn(async () => undefined),
}));

vi.mock("@/app/view/aisessions/property/property-list", () => ({
    PropertyList: (props: any) => {
        h.listProps = props;
        return null;
    },
}));

vi.mock("@/app/view/aisessions/property/property-store", () => ({
    setSessionProperty: h.setSessionProperty,
    patchSessionProperty: h.patchSessionProperty,
}));

vi.mock("@/app/store/session-note-cache", () => ({
    saveSessionProps: h.saveSessionProps,
}));

vi.mock("@/app/view/aisessions/undo-toast", () => ({
    useNoteUndo: (...args: any[]) => {
        h.useNoteUndoArgs = args;
        return { pending: null, error: "", capture: vi.fn(), undo: vi.fn(), dismiss: vi.fn() };
    },
    UndoNoteBar: () => null,
}));

vi.mock("@/app/view/aisessions/property/property-schema", () => ({
    usePropertySchema: () => h.schemaBase,
    setPropertySchema: h.setPropertySchema,
    upsertSchemaDef: (schema: any[], def: any) => [...(schema ?? []), def],
}));

vi.mock("@/app/store/use-available-session-tags", () => ({
    useAvailableSessionTags: () => [],
}));

vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: { pushModal: vi.fn() },
}));

vi.mock("@/app/store/global", () => ({
    createBlock: vi.fn(async () => "block"),
}));

vi.mock("@/app/view/aisessions/gen-action-button", () => ({
    GenActionButton: () => null,
}));

vi.mock("@/app/view/aisessions/property/property-ai", () => ({
    AIPropertiesButton: () => null,
}));

vi.mock("@/app/view/aisessions/title-source-badge", () => ({
    TitleSourceBadge: () => null,
}));

vi.mock("./editable-title", () => ({
    EditableTitle: ({ title }: { title: string }) => <span>{title}</span>,
}));

vi.mock("./marquee", () => ({
    InfoCardMarquee: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
}));

vi.mock("./info-card", () => ({
    InfoCardHead: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
    InfoCardError: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
    InfoCardIcon: () => null,
    InfoCardInput: () => null,
    InfoCardSection: ({ children }: { children?: unknown }) => <div>{children as any}</div>,
}));

import { SessionNoteSection } from "./session-note-section";

const summary = {
    key: FULL_KEY,
    id: RAW_ID,
    source: "pi",
    title: "测试会话",
    note: "note body",
    tags: ["旧标签"],
    props: {},
    origin: "",
    titleSource: "first_user_message",
} as any;

function makeState(): SessionNoteState {
    return {
        sessionId: RAW_ID,
        connection: "",
        service: {},
        summary,
        noteDraft: "note body",
        dirty: false,
        setNoteDraft: () => undefined,
        isEditing: false,
        setIsEditing: () => undefined,
        saveStatus: "idle",
        error: "",
        inputRef: { current: null },
        finishEditing: () => undefined,
        flushSave: () => undefined,
        trimmedDraft: "note body",
        title: "测试会话",
        previewText: "note body",
        metadataStatus: "idle",
        metadataError: "",
        metadataNote: "",
        metadataTags: [],
        setMetadataNote: () => undefined,
        setMetadataStatus: () => undefined,
    } as unknown as SessionNoteState;
}

const tagsDef = {
    key: "tags",
    name: "Tags",
    type: "multi_select",
    order: 4,
    scope: "session",
    builtin: true,
} as any;

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<SessionNoteSection state={makeState()} canEditProperties />);
    });
}

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    h.listProps = null;
    h.useNoteUndoArgs = null;
    h.setSessionProperty.mockClear();
    h.patchSessionProperty.mockClear();
    h.saveSessionProps.mockClear();
    h.setPropertySchema.mockClear();
    h.schemaBase = [];
});

describe("SessionNoteSection 写路径 id 契约", () => {
    it("useNoteUndo 用 hook 建档的裸 sessionId，而不是 summary.key", () => {
        mount();
        expect(h.useNoteUndoArgs?.[1]).toBe(RAW_ID);
        expect(h.useNoteUndoArgs?.[1]).not.toBe(FULL_KEY);
    });

    it("删标签（PropertyList onChange → 内置 tags）用裸 sessionId 写入", () => {
        mount();
        act(() => {
            h.listProps.onChange("tags", [], tagsDef);
        });
        expect(h.setSessionProperty).toHaveBeenCalledTimes(1);
        const args = h.setSessionProperty.mock.calls[0][0] as any;
        expect(args.sessionId).toBe(RAW_ID);
        expect(args.sessionId).not.toBe(FULL_KEY);
        expect(args.def.key).toBe("tags");
    });

    it("addProperty 范围三选一：session 不写模板；agent 写 agent:pi；global 写空 scope", () => {
        mount();
        const onAdd = h.listProps.onAddProperty as (key: string, type: string, scope: string) => void;

        act(() => {
            onAdd("priority", "select", "session");
        });
        expect(h.setSessionProperty).toHaveBeenCalledTimes(1);
        expect(h.setPropertySchema).not.toHaveBeenCalled();

        act(() => {
            onAdd("risk", "status", "agent");
        });
        expect(h.setPropertySchema).toHaveBeenCalledTimes(1);
        const agentDefs = (h.setPropertySchema.mock.calls[0] as unknown[])[0] as any[];
        expect(agentDefs.at(-1)).toMatchObject({ key: "risk", scope: "agent:pi" });

        act(() => {
            onAdd("owner", "text", "global");
        });
        expect(h.setPropertySchema).toHaveBeenCalledTimes(2);
        const globalDefs = (h.setPropertySchema.mock.calls[1] as unknown[])[0] as any[];
        expect(globalDefs.at(-1)).toMatchObject({ key: "owner", scope: "" });
    });

    it("自定义属性重命名用裸 sessionId 写入", () => {
        mount();
        act(() => {
            h.listProps.onRenameProperty("priority", "Priority");
        });
        expect(h.patchSessionProperty).toHaveBeenCalledTimes(1);
        const args = h.patchSessionProperty.mock.calls[0][0] as any;
        expect(args.sessionId).toBe(RAW_ID);
        expect(args.sessionId).not.toBe(FULL_KEY);
    });
});
