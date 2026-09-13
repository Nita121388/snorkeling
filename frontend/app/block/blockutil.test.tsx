import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { blockViewToIcon, blockViewToName, makeMagnifyButtonDecl } from "./blockutil";

describe("blockViewToIcon / blockViewToName canonical map", () => {
    // Mirrors the built-in view types registered in builtinviews.ts. Importing that
    // module directly pulls in every view model (too heavy for a unit test), so the
    // list is kept here as a regression guard: if a built-in view is missing from the
    // canonical ViewMetaMap it would resolve to the "square" fallback, silently
    // dropping the block icon in the BlockBar.
    const builtinViewTypes = [
        "term",
        "preview",
        "web",
        "waveai",
        "cpuplot",
        "sysinfo",
        "vdom",
        "tips",
        "help",
        "launcher",
        "tsunami",
        "aifilediff",
        "waveconfig",
        "scheduledtasks",
        "processviewer",
        "aisessions",
        "agent",
        "sessionoverview",
        "vcs",
        "vcscommits",
        "vcsdiff",
        "vcshistory",
    ];

    it("covers every built-in view so minimized BlockBar blocks keep a real icon", () => {
        for (const viewType of builtinViewTypes) {
            expect(blockViewToIcon(viewType), `blockViewToIcon("${viewType}")`).not.toBe("square");
            const name = blockViewToName(viewType);
            expect(name, `blockViewToName("${viewType}")`).toBeTruthy();
            expect(name, `blockViewToName("${viewType}")`).not.toBe(viewType);
        }
    });

    it("resolves the previously-missing scheduledtasks block to its clock icon", () => {
        expect(blockViewToIcon("scheduledtasks")).toBe("clock");
        expect(blockViewToName("scheduledtasks")).toBe("Scheduled Tasks");
    });
});

describe("makeMagnifyButtonDecl", () => {
    it("uses the minimize icon direction when the action collapses a popup back to the tab", () => {
        const decl = makeMagnifyButtonDecl({
            magnified: true,
            toggleMagnify: vi.fn(),
            disabled: false,
            title: "Collapse to Tab",
        });

        expect(decl.title).toBe("Collapse to Tab");
        expect(isValidElement<{ enabled: boolean }>(decl.icon)).toBe(true);
        if (!isValidElement<{ enabled: boolean }>(decl.icon)) return;
        expect(decl.icon.props.enabled).toBe(true);
    });
});
