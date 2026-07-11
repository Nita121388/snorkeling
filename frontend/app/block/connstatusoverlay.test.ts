// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveWshRecoveryActions } from "./connstatusoverlay";

describe("wsh recovery actions", () => {
    it("shows only manual recovery for a failed install that requires manual installation", () => {
        expect(resolveWshRecoveryActions("failed", false, "wsh-manual-install-required")).toEqual({
            showActions: true,
            showAutoRetry: false,
        });
    });

    it("keeps automatic retry for ordinary failed installs", () => {
        expect(resolveWshRecoveryActions("failed", false, "install-error")).toEqual({
            showActions: true,
            showAutoRetry: true,
        });
    });

    it("does not expose recovery actions while an upload is in progress", () => {
        expect(resolveWshRecoveryActions("uploading", false, "wsh-manual-install-required")).toEqual({
            showActions: false,
            showAutoRetry: false,
        });
    });
});
