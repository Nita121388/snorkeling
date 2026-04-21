// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { applyExplorerRootForDirectoryNavigation } from "@/app/view/preview/preview-navigation";
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
});
