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

export type PslogEventInput = {
    event: string;
    stage?: string;
    traceid?: string;
    blockid?: string;
    sessionref?: string;
    durationms?: number;
    outcome?: string;
    reason?: string;
};

export type PslogEventRecord = {
    v: 1;
    ts: string;
    event: string;
    stage?: string;
    traceid?: string;
    blockid?: string;
    sessionref?: string;
    durationms?: number;
    outcome?: string;
    reason?: string;
};

export type PslogEventOpts = {
    bufferKey?: string;
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

function optionalEventString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }
    const normalized = value.trim();
    return normalized === "" ? undefined : normalized;
}

function optionalSessionRef(value: unknown): string | undefined {
    const normalized = optionalEventString(value);
    return normalized != null && /^fnv1a64:[0-9a-f]{16}$/.test(normalized) ? normalized : undefined;
}

export function pslogEvent(input: PslogEventInput, opts?: PslogEventOpts): void {
    if (input == null || typeof input.event !== "string") {
        return;
    }
    const event = input.event.trim();
    if (event === "") {
        return;
    }
    const record: PslogEventRecord = {
        v: 1,
        ts: new Date().toISOString(),
        event,
    };
    const stage = optionalEventString(input.stage);
    const traceid = optionalEventString(input.traceid);
    const blockid = optionalEventString(input.blockid);
    const sessionref = optionalSessionRef(input.sessionref);
    const outcome = optionalEventString(input.outcome);
    const reason = optionalEventString(input.reason);
    if (stage != null) record.stage = stage;
    if (traceid != null) record.traceid = traceid;
    if (blockid != null) record.blockid = blockid;
    if (sessionref != null) record.sessionref = sessionref;
    if (Number.isInteger(input.durationms) && input.durationms > 0) record.durationms = input.durationms;
    if (outcome != null) record.outcome = outcome;
    if (reason != null) record.reason = reason;
    // Keep structured records on the existing transport while intentionally omitting tid:
    // adding a text suffix would make the body invalid JSON for the server parser.
    pslogTrace(event, JSON.stringify(record), { bufferKey: opts?.bufferKey });
}

export function makePslogSessionRef(sessionId: string): string {
    if (typeof sessionId !== "string" || sessionId === "") {
        return "";
    }
    const BigIntFn = (globalThis as any).BigInt;
    if (typeof BigIntFn !== "function") {
        throw new Error("BigInt is required for pslog session references");
    }
    const offset = BigIntFn("14695981039346656037");
    const prime = BigIntFn("1099511628211");
    const mask = BigIntFn("18446744073709551615");
    let hash = offset;
    for (const byte of new TextEncoder().encode(sessionId)) {
        hash = ((hash ^ BigIntFn(byte)) * prime) & mask;
    }
    return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export function makeAgentTraceId(blockId: string, sessionId: string): string {
    if (typeof blockId !== "string" || blockId === "") {
        return "";
    }
    return `agent:${blockId}:${makePslogSessionRef(sessionId)}`;
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
