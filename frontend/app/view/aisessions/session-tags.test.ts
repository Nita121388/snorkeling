// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    normalizeSessionTags,
    removeSessionTagFromNote,
    sessionTagsLabel,
} from "./session-tags";

describe("session-tags", () => {
    it("extracts #tag and Chinese tags from notes", () => {
        expect(extractSessionTagsFromNote("Follow #todo and #研究")).toEqual({
            note: "Follow #todo and #研究",
            tags: ["todo", "研究"],
        });
    });

    it("treats tags case-insensitively: normalizes to lowercase and de-dupes", () => {
        expect(normalizeSessionTags(["#Bug", "bug", "#BUG"])).toEqual(["bug"]);
        expect(extractSessionTagsFromNote("#Mix #MIX mix").tags).toEqual(["mix"]);
    });

    it("does not treat legacy plus syntax or URL fragments as tags", () => {
        expect(extractSessionTagsFromNote("Keep #+todo and https://example.test/a#section")).toEqual({
            note: "Keep #+todo and https://example.test/a#section",
            tags: [],
        });
    });

    it("normalizes and labels tags consistently", () => {
        expect(normalizeSessionTags(["#Review", "review", "#研究", "+legacy", "bad tag"])).toEqual([
            "review",
            "研究",
        ]);
        expect(mergeSessionTags(["review"], ["#urgent", "Review"])).toEqual(["review", "urgent"]);
        expect(sessionTagsLabel(["review", "研究"])).toBe("#review #研究");
    });

    it("removes a tag token from note text without touching URL fragments", () => {
        expect(removeSessionTagFromNote("Follow #todo and https://example.test/a#todo #研究", "todo")).toBe(
            "Follow and https://example.test/a#todo #研究"
        );
    });
});
