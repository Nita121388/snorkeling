// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Self-check for the Blocks-group "+" menu pure helpers + launch-popup-bus roundtrip.
// Run: npx vitest run frontend/app/block/inlinetab-addmenu.test.ts

import { assert, describe, expect, test } from "vitest";
import { buildFilesBlockDef, pickGroupAddableWidgets } from "./inlinetab-addmenu";
import { requestLaunchPopup, subscribeLaunchPopup } from "@/app/workspace/launch-popup-bus";

function makeWidget(overrides: Partial<WidgetConfigType>): WidgetConfigType {
    return { blockdef: { meta: {} }, ...overrides };
}

describe("pickGroupAddableWidgets", () => {
    const wmap = {
        terminal: makeWidget({ "display:order": -5, label: "terminal" }),
        agent: makeWidget({ "display:order": -4, label: "agent" }),
        hidden: makeWidget({ "display:order": -3.5, label: "hidden", "display:hidden": true }),
        actionOnly: makeWidget({ "display:order": -3.4, label: "action-only", action: "noop", blockdef: undefined }),
        files: makeWidget({ "display:order": -3, label: "files" }),
        workspaceLocked: makeWidget({ "display:order": 9, label: "locked", workspaces: ["other-ws"] }),
    };

    test("sorts by display:order and drops hidden / action-only / other-workspace widgets", () => {
        const picked = pickGroupAddableWidgets(wmap, "ws-1");
        assert.deepEqual(
            picked.map((w) => w.id),
            ["terminal", "agent", "files"]
        );
    });

    test("keeps workspace-agnostic widgets when workspaceId is undefined", () => {
        const picked = pickGroupAddableWidgets({ files: wmap.files }, undefined);
        assert.equal(picked.length, 1);
    });

    test("empty/missing map yields empty list", () => {
        assert.deepEqual(pickGroupAddableWidgets(undefined as never, "ws"), []);
        assert.deepEqual(pickGroupAddableWidgets({}, "ws"), []);
    });
});

describe("buildFilesBlockDef", () => {
    const base: BlockDef = { meta: { view: "preview", file: "~" } };

    test("inherits cwd + connection from an active terminal block", () => {
        const active = { meta: { view: "term", connection: "hostA", "cmd:cwd": "/work/dir" } } as unknown as Block;
        const out = buildFilesBlockDef(base, active);
        assert.equal(out.meta["view"], "preview");
        assert.equal(out.meta["file"], "/work/dir");
        assert.equal(out.meta["connection"], "hostA");
    });

    test("falls back to widget default (~) when active block has no terminal context", () => {
        const active = { meta: { view: "preview", file: "/elsewhere" } } as unknown as Block;
        const out = buildFilesBlockDef(base, active);
        assert.equal(out.meta["file"], "~");
    });

    test("handles missing active block", () => {
        const out = buildFilesBlockDef(base, null);
        assert.equal(out.meta["file"], "~");
    });
});

describe("launch-popup-bus", () => {
    test("request reaches subscriber; unsubscribe stops delivery", () => {
        const seen: unknown[] = [];
        const unsub = subscribeLaunchPopup((req) => seen.push(req));
        const req = { mode: "terminal" as const, anchorEl: null as unknown as HTMLElement, nodeId: "node-1" };
        requestLaunchPopup(req);
        unsub();
        requestLaunchPopup({ ...req, nodeId: "node-2" });
        expect(seen).toHaveLength(1);
        expect((seen[0] as { nodeId: string }).nodeId).toBe("node-1");
    });
});
