// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import { resolveAgentOsNotifySettings } from "./agentnotifysettings";

// The Go settings fields are *bool / *int64. "unset" and "false"/"0" are different things, and the
// whole denoise design depends on it: an unset key means "use the default", an explicitly stored
// false/0 means "the user asked for it". The panel must therefore show — and write back — the
// stored value, never the default, when a value is present.
describe("resolveAgentOsNotifySettings", () => {
    it("falls back to the documented defaults when nothing is stored", () => {
        const effective = resolveAgentOsNotifySettings({});
        expect(effective.masterEnabled).toBe(true);
        expect(effective.doneEnabled).toBe(true);
        expect(effective.blockedEnabled).toBe(true);
        expect(effective.notifyWhenFocused).toBe(false);
        expect(effective.blockedMinIntervalMs).toBe(0);
        expect(effective.idleMinMs).toBe(30000);
        expect(effective.cooldownMs).toBe(60000);
    });

    it("keeps an explicitly stored false instead of the default", () => {
        const effective = resolveAgentOsNotifySettings({
            "agentstatus:osnotify": false,
            "agentstatus:osnotifydone": false,
            "agentstatus:osnotifyblocked": false,
            "agentstatus:osnotifywhenfocused": true,
        });
        expect(effective.masterEnabled).toBe(false);
        expect(effective.doneEnabled).toBe(false);
        expect(effective.blockedEnabled).toBe(false);
        expect(effective.notifyWhenFocused).toBe(true);
    });

    it("keeps an explicitly stored zero instead of the default", () => {
        const effective = resolveAgentOsNotifySettings({
            "agentstatus:osnotifyidleminms": 0,
            "agentstatus:osnotifycooldownms": 0,
        });
        expect(effective.idleMinMs).toBe(0);
        expect(effective.cooldownMs).toBe(0);
    });

    it("reads the stored values when they differ from the defaults", () => {
        const effective = resolveAgentOsNotifySettings({
            "agentstatus:osnotifyidleminms": 5000,
            "agentstatus:osnotifycooldownms": 120000,
        });
        expect(effective.idleMinMs).toBe(5000);
        expect(effective.cooldownMs).toBe(120000);
    });
});
