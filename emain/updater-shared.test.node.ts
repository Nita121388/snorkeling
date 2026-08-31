// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `node --test` against the TS source directly — the module is pure and has no
// Electron imports, so the type-stripping loader can run it in place.
import assert from "node:assert/strict";
import test from "node:test";
import { isOfflineError } from "./updater-shared.ts";

test("isOfflineError recognises Chromium network errors", () => {
    assert.ok(isOfflineError(new Error("net::ERR_INTERNET_DISCONNECTED")));
    assert.ok(isOfflineError(new Error("net::ERR_NAME_NOT_RESOLVED")));
    assert.ok(isOfflineError(new Error("net::ERR_CONNECTION_TIMED_OUT")));
    assert.ok(isOfflineError(new Error("net::ERR_TIMED_OUT")));
});

test("isOfflineError recognises Node DNS/socket errors", () => {
    assert.ok(isOfflineError(new Error("getaddrinfo ENOTFOUND api.github.com")));
    assert.ok(isOfflineError(new Error("read ECONNRESET")));
    assert.ok(isOfflineError(new Error("connect ETIMEDOUT 140.82.112.3:443")));
    assert.ok(isOfflineError(new Error("send ENETUNREACH 255.255.255.255:443")));
});

test("isOfflineError does not match real updater failures", () => {
    assert.ok(!isOfflineError(new Error("Cannot parse update info: Unexpected token < in JSON")));
    assert.ok(!isOfflineError(new Error("no published versions on GitHub")));
    assert.ok(!isOfflineError(new Error("sha512 checksum mismatch")));
    assert.ok(!isOfflineError("plain string failure"));
});
