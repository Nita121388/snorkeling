// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Regression: useBatchGenCounts must return a stable snapshot.
//
// 0.0.104 shipped a version that returned a fresh object from
// useSyncExternalStore's getSnapshot on every call, which made React think the
// store changed forever and crashed the sessions list with "Maximum update
// depth exceeded" (React #185). This test renders the hook and fails (infinite
// loop / timeout) if the snapshot is unstable.
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useBatchGenCounts } from "./aisession-gen-store";

function Probe() {
    const counts = useBatchGenCounts("", ["s1", "s2"], "title");
    return <div data-testid="counts">{`${counts.total}:${counts.done}:${counts.failed}`}</div>;
}

describe("useBatchGenCounts", () => {
    it("renders without an infinite update loop", () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => {
            root.render(<Probe />);
        });
        expect(container.textContent).toBe("0:0:0");
        act(() => root.unmount());
        container.remove();
    });
});
