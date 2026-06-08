// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    resolveFixedLeftBlockInsertionAnchor,
    SnorkelingBlockKindNote,
    SnorkelingBlockKindOverview,
} from "./toggle-block";

describe("fixed left block insertion order", () => {
    it("places Overview before an existing Note", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor(SnorkelingBlockKindOverview, [
                { blockId: "block:note", kind: SnorkelingBlockKindNote },
                { blockId: "block:term", kind: null },
            ])
        ).toEqual({ blockId: "block:note", position: "before" });
    });

    it("places Note after an existing Overview", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor(SnorkelingBlockKindNote, [
                { blockId: "block:overview", kind: SnorkelingBlockKindOverview },
                { blockId: "block:term", kind: null },
            ])
        ).toEqual({ blockId: "block:overview", position: "after" });
    });

    it("places fixed blocks before normal blocks when no fixed block exists", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor(SnorkelingBlockKindNote, [
                { blockId: "block:term", kind: null },
                { blockId: "block:preview", kind: null },
            ])
        ).toEqual({ blockId: "block:term", position: "before" });
    });

    it("does not follow a Note that was moved out of the left fixed group", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor(SnorkelingBlockKindOverview, [
                { blockId: "block:term", kind: null },
                { blockId: "block:note", kind: SnorkelingBlockKindNote },
            ])
        ).toEqual({ blockId: "block:term", position: "before" });
    });

    it("does not follow an Overview that was moved out of the left fixed group", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor(SnorkelingBlockKindNote, [
                { blockId: "block:term", kind: null },
                { blockId: "block:overview", kind: SnorkelingBlockKindOverview },
            ])
        ).toEqual({ blockId: "block:term", position: "before" });
    });

    it("keeps Note after Overview when Overview is still in the left fixed group", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor(SnorkelingBlockKindNote, [
                { blockId: "block:overview", kind: SnorkelingBlockKindOverview },
                { blockId: "block:term", kind: null },
                { blockId: "block:note", kind: SnorkelingBlockKindNote },
            ])
        ).toEqual({ blockId: "block:overview", position: "after" });
    });

    it("does not force non-fixed block kinds into the left fixed group", () => {
        expect(
            resolveFixedLeftBlockInsertionAnchor("custom", [
                { blockId: "block:overview", kind: SnorkelingBlockKindOverview },
            ])
        ).toBeNull();
    });
});
