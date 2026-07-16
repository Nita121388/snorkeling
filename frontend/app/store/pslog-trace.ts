// Copyright 2026, Command Phase Inc.
// SPDX-License-Identifier: Apache-2.0

// pslog-trace: the single FE entry-point for the cross-process trace facility
// shared with the backend (see pkg/pslog/pslog.go). Every FE trace site calls
// pslogTrace() here instead of hand-writing console.log + POST /wave/pslog +
// localStorage buffer.
//
// Gate: `debug:pslog` setting, injected by global.ts init via
// setPslogEnabledFn. Until injected, pslogEnabled() returns false (matches
// the setting default; traces stay off). pslog-trace *owns* the gate state so
// wos.ts and any future caller share one source of truth.

import { getWebServerEndpoint } from "@/util/endpoints";
import { fireAndForget } from "@/util/util";

let pslogEnabledFn: (() => boolean) | null = null;

export function setPslogEnabledFn(fn: () => boolean) {
    pslogEnabledFn = fn;
}

export function pslogEnabled(): boolean {
    try {
        return pslogEnabledFn?.() === true;
    } catch {
        return false;
    }
}

type PslogTraceOpts = {
    // When set, the trace line is also appended to localStorage[bufKey]
    // (cap 500) and mirrored to window[bufKey] so a crashed tab can be
    // inspected post-mortem. ps-init deliberately omits this (one-shot IIFE).
    bufferKey?: string;
    // When set, ` trace=<tid>` is appended to the line before emission, so
    // the same trace id that the backend emits via pslog.AppendWithTrace shows
    // up in the FE trace too. Cross-process grep: `grep "trace=<tid>"`.
    tid?: string;
};

// pslogTrace writes one trace line with tag `tag` and pre-formatted `line`
// (the line should already include the leading `[<tag>] ...` token — the
// server-side handler wraps it as `client <line>` via AppendRaw).
//
// Behavior contract (mirrors the previous inline sites in wos.ts):
//   1. console.log(line)                     — always, when enabled
//   2. POST /wave/pslog  body="tag=<tag> <line>"  — fire-and-forget, errors swallowed
//   3. localStorage buffer (only when opts.bufferKey given) — JSON string[],
//      capped at 500, mirrored to window[opts.bufferKey]
// All three are wrapped in a single try/catch; the gate short-circuits the
// whole function when pslogEnabled() is false.
//
// opts.tid (if given) is appended to the line as ` trace=<tid>` BEFORE the
// 3 emission channels run — so it lands in all three (console, pslog file,
// localStorage). This mirrors pkg/pslog.AppendWithTrace's `trace=` suffix.
export function pslogTrace(tag: string, line: string, opts?: PslogTraceOpts): void {
    if (!pslogEnabled()) {
        return;
    }
    try {
        let fullLine = line;
        if (opts?.tid) {
            fullLine = `${line} trace=${opts.tid}`;
        }
        console.log(fullLine);
        const url = getWebServerEndpoint() + "/wave/pslog";
        fireAndForget(() => fetch(url, { method: "POST", body: "tag=" + tag + " " + fullLine }).catch(() => {}));
        if (opts?.bufferKey) {
            const bufKey = opts.bufferKey;
            const MAX = 500;
            let buf: string[] = [];
            const raw = (window as any).localStorage?.getItem(bufKey);
            if (raw) {
                try {
                    buf = JSON.parse(raw) as string[];
                } catch {
                    buf = [];
                }
            }
            buf.push(`${new Date().toISOString()} ${fullLine}`);
            if (buf.length > MAX) {
                buf = buf.length - MAX > 0 ? buf.slice(buf.length - MAX) : buf;
            }
            (window as any).localStorage?.setItem(bufKey, JSON.stringify(buf));
            (window as any)[bufKey] = buf;
        }
    } catch {}
}

// genFrontendTraceId: mints a FE-side trace id to pass as opts.tid to pslogTrace.
// Format `fe-<counter>` so a FE-emitted id is distinguishable from backend
// `pslog.NewTraceId()` (`<pid>-<counter>`) when grepping cross-process logs.
let feTraceCounter = 0;
export function genFrontendTraceId(): string {
    // Avoid Math.random (banned in some envs); a strict-increasing counter
    // disambiguates within a single tab session.
    feTraceCounter += 1;
    return `fe-${feTraceCounter}`;
}
