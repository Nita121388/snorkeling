// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { canPreviewFileInfo } from "@/app/view/preview/preview-open";
import { describe, expect, it } from "vitest";

describe("canPreviewFileInfo", () => {
    it("allows source file text mimetypes", () => {
        const mimeTypes = ["text/x-vue", "text/x-svelte", "text/x-astro", "text/x-terraform"];

        for (const mimetype of mimeTypes) {
            expect(canPreviewFileInfo({ path: "Component.vue", mimetype, size: 128 })).toBe(true);
        }
    });
});
