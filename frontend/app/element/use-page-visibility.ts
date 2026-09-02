// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";

/**
 * Shared hook that tracks whether the current page/document is visible.
 * Returns `true` when visible, `false` when hidden.
 * Updates in real time via `visibilitychange` event.
 */
export function usePageVisible(): boolean {
    const [visible, setVisible] = useState(() => {
        if (typeof document === "undefined") return true;
        return document.visibilityState !== "hidden";
    });

    useEffect(() => {
        const onVisibilityChange = () => {
            setVisible(document.visibilityState !== "hidden");
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, []);

    return visible;
}
