// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { canPreviewFileInfo, openPreviewEntry } from "@/app/view/preview/preview-open";
import { describe, expect, it } from "vitest";

describe("canPreviewFileInfo", () => {
    it("allows source file text mimetypes", () => {
        const mimeTypes = ["text/x-vue", "text/x-svelte", "text/x-astro", "text/x-terraform"];

        for (const mimetype of mimeTypes) {
            expect(canPreviewFileInfo({ path: "Component.vue", mimetype, size: 128 })).toBe(true);
        }
    });

    it("allows extensionless text files", () => {
        expect(canPreviewFileInfo({ path: "/Users/nita/.ssh/config", mimetype: "", size: 128 })).toBe(true);
    });
});

describe("openPreviewEntry", () => {
    it("passes the directory path when opening a directory in preview", async () => {
        const model = {
            openPathWithTarget: async () => {},
        };
        const calls: unknown[][] = [];
        model.openPathWithTarget = async (...args: unknown[]) => {
            calls.push(args);
        };

        await openPreviewEntry(model as any, { path: "/tmp/project", mimetype: "directory", isdir: true }, "local");

        expect(calls).toEqual([["/tmp/project", { directoryPath: "/tmp/project", pathIsDir: true }]]);
    });

    it("does not mark regular files as directory navigation", async () => {
        const model = {
            openPathWithTarget: async () => {},
        };
        const calls: unknown[][] = [];
        model.openPathWithTarget = async (...args: unknown[]) => {
            calls.push(args);
        };

        await openPreviewEntry(model as any, { path: "/tmp/project/readme.md", mimetype: "text/markdown" }, "local");

        expect(calls).toEqual([["/tmp/project/readme.md", { directoryPath: undefined, pathIsDir: false }]]);
    });
});
