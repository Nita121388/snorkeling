// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CommonTextTagChip } from "./commontext-tags";

describe("CommonTextTagChip", () => {
    test("matches AI Session tag geometry while preserving selected and unselected states", () => {
        const unselected = renderToStaticMarkup(<CommonTextTagChip tag="plain" />);
        const selected = renderToStaticMarkup(<CommonTextTagChip tag="active" selected />);

        expect(unselected).toContain("py-0.5");
        expect(unselected).toContain("border");
        expect(unselected).toContain("rounded-md");
        expect(unselected).toContain("border-border bg-surface-soft text-secondary");
        expect(selected).toContain("border-transparent bg-accent/10 text-accent");
    });
});
