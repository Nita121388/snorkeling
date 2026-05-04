// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    applyExplorerRootForDirectoryNavigation,
    resolveExplorerRootPathForOpenInCurrentBlock,
} from "@/app/view/preview/preview-navigation";
import { describe, expect, it } from "vitest";

describe("preview explorer root sync", () => {
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
