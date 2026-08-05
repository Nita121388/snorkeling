// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

describe("block registry", () => {
    it("loads without evaluating circular view dependencies", async () => {
        const registry = await import("./blockregistry");

        expect(registry.makeViewModel).toBeTypeOf("function");
    });
});
