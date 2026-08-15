// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    getAllPreviewPlugins,
    getPreviewPluginById,
    PreviewMatchContext,
    PreviewPlugin,
    registerPreviewPlugin,
    resolvePreviewPlugin,
    shouldPreviewPluginTakeOver,
    unregisterPreviewPlugin,
} from "@/app/view/preview/preview-plugin-registry";
import { beforeEach, describe, expect, it } from "vitest";

// FileInfo 为全局类型（frontend/types/gotypes.d.ts，declare global），无需 import。

const fileInfo = (path: string, name: string, mimetype: string): FileInfo => ({
    path,
    name,
    mimetype,
});

const baseCtx = (overrides: Partial<PreviewMatchContext> = {}): PreviewMatchContext => ({
    fileInfo: fileInfo("/tmp/note.md", "note.md", "text/markdown"),
    mimeType: "text/markdown",
    fileName: "note.md",
    filePath: "/tmp/note.md",
    editMode: false,
    ...overrides,
});

const makePlugin = (id: string, match: PreviewPlugin["match"]): PreviewPlugin => ({
    id,
    displayName: id,
    match,
    render: () => null,
});

describe("preview plugin registry", () => {
    beforeEach(() => {
        // 注册表是模块级单例：每个用例前清空，避免跨用例污染。
        for (const plugin of getAllPreviewPlugins()) {
            unregisterPreviewPlugin(plugin.id);
        }
    });

    it("resolvePreviewPlugin returns null when no plugin matches", () => {
        registerPreviewPlugin(makePlugin("p1", () => false));
        expect(resolvePreviewPlugin(baseCtx())).toBeNull();
    });

    it("resolvePreviewPlugin returns the matching plugin", () => {
        registerPreviewPlugin(
            makePlugin("p-base", (ctx) => ctx.fileName.endsWith(".base"))
        );
        const ctx = baseCtx({ fileName: "view.base", filePath: "/tmp/view.base" });
        const plugin = resolvePreviewPlugin(ctx);
        expect(plugin).not.toBeNull();
        expect(plugin!.id).toBe("p-base");
    });

    it("resolvePreviewPlugin prefers higher priority when multiple match", () => {
        registerPreviewPlugin({
            ...makePlugin("low", () => true),
            priority: 1,
        });
        registerPreviewPlugin({
            ...makePlugin("high", () => true),
            priority: 10,
        });
        const plugin = resolvePreviewPlugin(baseCtx());
        expect(plugin!.id).toBe("high");
    });

    it("registering same id replaces the previous plugin (HMR-safe)", () => {
        registerPreviewPlugin(makePlugin("dup", () => true));
        registerPreviewPlugin(makePlugin("dup", () => false));
        expect(getAllPreviewPlugins().filter((p) => p.id === "dup")).toHaveLength(1);
        expect(resolvePreviewPlugin(baseCtx())).toBeNull();
    });

    it("getPreviewPluginById finds by id", () => {
        registerPreviewPlugin(makePlugin("known", () => false));
        expect(getPreviewPluginById("known")?.id).toBe("known");
        expect(getPreviewPluginById("unknown")).toBeNull();
    });

    it("unrelated files fall back to null (no plugin takeover)", () => {
        registerPreviewPlugin(makePlugin("p-base", (ctx) => ctx.fileName.endsWith(".base")));
        expect(resolvePreviewPlugin(baseCtx())).toBeNull();
    });

    it("shouldPreviewPluginTakeOver returns true for editable-capable or no cap", () => {
        const noCap = makePlugin("no-cap", () => true);
        const editable = { ...makePlugin("editable", () => true), canEdit: () => true };
        const ctx = baseCtx({ editMode: true });
        expect(shouldPreviewPluginTakeOver(noCap, ctx)).toBe(true); // 无 canEdit → 允许接管
        expect(shouldPreviewPluginTakeOver(editable, ctx)).toBe(true); // canEdit true → 允许
    });

    it("shouldPreviewPluginTakeOver returns false for readonly plugins in editMode", () => {
        const readonly = { ...makePlugin("readonly", () => true), canEdit: () => false };
        // 编辑态 + 只读 → 不接管
        expect(shouldPreviewPluginTakeOver(readonly, baseCtx({ editMode: true }))).toBe(false);
        // 只读态阅读 → 接管
        expect(shouldPreviewPluginTakeOver(readonly, baseCtx({ editMode: false }))).toBe(true);
    });
});
