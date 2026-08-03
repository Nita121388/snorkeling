// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { resolveWshRecoveryActions } from "./connstatusoverlay";

describe("wsh recovery actions", () => {
    it("shows only manual recovery for a failed install that requires manual installation", () => {
        expect(resolveWshRecoveryActions("failed", false, "wsh-manual-install-required")).toEqual({
            showActions: true,
            showAutoRetry: false,
            showCancel: false,
        });
    });

    it("keeps automatic retry for ordinary failed installs", () => {
        expect(resolveWshRecoveryActions("failed", false, "install-error")).toEqual({
            showActions: true,
            showAutoRetry: true,
            showCancel: false,
        });
    });

    it("shows cancel while an upload is in progress", () => {
        expect(resolveWshRecoveryActions("uploading", false, "wsh-manual-install-required")).toEqual({
            showActions: false,
            showAutoRetry: false,
            showCancel: true,
        });
    });

    it("shows cancel for every active install phase", () => {
        for (const status of [
            "checking",
            "detecting-platform",
            "finding-binary",
            "uploading",
            "verifying",
            "restarting-server",
        ]) {
            expect(resolveWshRecoveryActions(status, false, "")).toEqual({
                showActions: false,
                showAutoRetry: false,
                showCancel: true,
            });
        }
    });
});
