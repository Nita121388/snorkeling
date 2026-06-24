// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    applyDirectoryNavigationMeta,
    applyExplorerRootForDirectoryNavigation,
    normalizePreviewDirectoryDisplayMode,
    normalizePreviewOpenTargetDirection,
    resolveExplorerRootPathForOpenInCurrentBlock,
    resolvePreviewDirectoryDisplayMode,
    resolvePreviewOpenTargetDirection,
    resolvePreviewOpenTargetDirectionForBlock,
} from "@/app/view/preview/preview-navigation";
import { describe, expect, it } from "vitest";

describe("preview explorer root sync", () => {
    it("clears file-only preview state when navigating to a directory", () => {
        const meta = applyDirectoryNavigationMeta(
            {
                file: "/tmp/current.md",
                edit: true,
                "preview:searchline": 12,
                "preview:directory-display": "tree",
                "preview:explorer-root": "/tmp/current",
            },
            "tree",
            "/tmp"
        );

        expect(meta.edit).toBe(false);
        expect(meta["preview:searchline"]).toBeNull();
        expect(meta["preview:explorer-root"]).toBe("/tmp");
        expect(meta["preview:pathisdir"]).toBe(true);
    });

    it("leaves file-only preview state alone when the target is not known to be a directory", () => {
        const meta = applyDirectoryNavigationMeta(
            {
                file: "/tmp/current.md",
                edit: true,
                "preview:searchline": 12,
            },
            "tree",
            null
        );

        expect(meta.edit).toBe(true);
        expect(meta["preview:searchline"]).toBe(12);
        expect(meta["preview:pathisdir"]).toBeNull();
    });

    it("updates the explorer root for directory navigation in tree mode", () => {
        const meta = applyExplorerRootForDirectoryNavigation(
            {
                file: "/tmp/current",
                "preview:directory-display": "tree",
                "preview:explorer-root": "/tmp/current",
            },
            "tree",
            "/tmp"
        );

        expect(meta["preview:explorer-root"]).toBe("/tmp");
    });

    it("leaves the explorer root unchanged outside tree mode", () => {
        const meta = applyExplorerRootForDirectoryNavigation(
            {
                file: "/tmp/current",
                "preview:directory-display": "list",
                "preview:explorer-root": "/tmp/current",
            },
            "list",
            "/tmp"
        );

        expect(meta["preview:explorer-root"]).toBe("/tmp/current");
    });

    it("uses the directory path as the explorer root when opening a directory in the current block", () => {
        expect(
            resolveExplorerRootPathForOpenInCurrentBlock({
                path: "/tmp/project/src",
                dir: "/tmp/project",
                isdir: true,
            })
        ).toBe("/tmp/project/src");
    });

    it("uses the parent directory as the explorer root when opening a file in the current block", () => {
        expect(
            resolveExplorerRootPathForOpenInCurrentBlock({
                path: "/tmp/project/src/index.ts",
                dir: "/tmp/project/src",
                isdir: false,
            })
        ).toBe("/tmp/project/src");
    });
});

describe("preview default setting normalization", () => {
    it("accepts valid directory display modes and falls back for invalid values", () => {
        expect(normalizePreviewDirectoryDisplayMode("list", "tree")).toBe("list");
        expect(normalizePreviewDirectoryDisplayMode("tree", "list")).toBe("tree");
        expect(normalizePreviewDirectoryDisplayMode("invalid", "list")).toBe("list");
    });

    it("accepts valid open target directions and falls back for invalid values", () => {
        expect(normalizePreviewOpenTargetDirection("right", "off")).toBe("right");
        expect(normalizePreviewOpenTargetDirection("off", "right")).toBe("off");
        expect(normalizePreviewOpenTargetDirection("invalid", "right")).toBe("right");
    });

    it("uses settings defaults unless block metadata overrides them", () => {
        expect(resolvePreviewDirectoryDisplayMode(undefined, "tree")).toBe("tree");
        expect(resolvePreviewOpenTargetDirection(undefined, "right")).toBe("right");
        expect(resolvePreviewDirectoryDisplayMode("list", "tree")).toBe("list");
        expect(resolvePreviewOpenTargetDirection("off", "right")).toBe("off");
    });

    it("defaults Note blocks to current block unless the block has an explicit target", () => {
        expect(resolvePreviewOpenTargetDirectionForBlock(undefined, "right", "right", "note")).toBe("off");
        expect(resolvePreviewOpenTargetDirectionForBlock("right", "off", "right", "note")).toBe("right");
    });

    it("keeps regular Files blocks on the configured default target", () => {
        expect(resolvePreviewOpenTargetDirectionForBlock(undefined, "right", "right", undefined)).toBe("right");
        expect(resolvePreviewOpenTargetDirectionForBlock(undefined, "off", "right", undefined)).toBe("off");
    });
});
