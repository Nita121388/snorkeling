// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// macOS bplist00 encoder for clipboard file lists.
// Uses system `plutil` to convert XML plist → binary plist reliably.
// NSFilenamesPboardType and public.file-url both require bplist00 format.

import { spawnSync } from "node:child_process";

export function encodeFilePathsBplist(filePaths: string[]): Buffer {
    const xml = encodeXmlPlist(filePaths);
    const result = spawnSync("/usr/bin/plutil", ["-convert", "binary1", "-o", "-", "-"], {
        input: xml,
    });
    if (result.status !== 0) {
        throw new Error(`plutil failed: ${result.stderr?.toString() ?? "unknown error"}`);
    }
    return result.stdout as Buffer;
}

export function encodeFileUrlsBplist(filePaths: string[]): Buffer {
    const urls = filePaths.map((p) => `file://${p.replace(/\\/g, "/").replace(/\/+/g, "/")}`);
    return encodeFilePathsBplist(urls);
}

// Generate a standard XML plist containing an NSArray of strings (or empty array).
function encodeXmlPlist(filePaths: string[]): string {
    const escaped = filePaths.map((p) =>
        p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    );
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<array>",
        ...escaped.map((s) => `  <string>${s}</string>`),
        "</array>",
        "</plist>",
    ].join("\n");
}