#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DefaultLimit = 200;

function usage() {
  return `Usage: node scripts/pslog-query.mjs [options]

Options:
  --file <path>       Read one log file (repeatable)
  --dir <path>        Read a pslog directory or Wave data directory
  --block <id>        Filter by block id
  --trace <id>        Filter by trace id
  --event <name>      Filter by event name (exact or prefix)
  --since <duration>  Only include recent entries (for example 30s, 10m, 2h)
  --limit <count>     Maximum entries to print (default: ${DefaultLimit})
  --diagnose          Run Agent top-chain checks instead of only listing entries
  --json              Print machine-readable JSON
  --help              Show this help
`;
}

function parseArgs(argv) {
  const options = { files: [], limit: DefaultLimit, json: false, diagnose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--diagnose") {
      options.diagnose = true;
      continue;
    }
    const key = arg.startsWith("--") ? arg.slice(2) : "";
    if (["file", "dir", "block", "trace", "event", "since", "limit"].includes(key)) {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      i += 1;
      if (key === "file") options.files.push(value);
      else if (key === "limit") options.limit = parseLimit(value);
      else options[key] = value;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function parseLimit(value) {
  const limit = Number.parseInt(value, 10);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid --limit: ${value}`);
  }
  return limit;
}

function parseDuration(value) {
  if (value == null || value === "") return null;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i.exec(value.trim());
  if (match == null) throw new Error(`Invalid --since duration: ${value}`);
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()];
  return amount * multiplier;
}

function normalizeId(value) {
  if (value == null) return "";
  const text = String(value).trim();
  return text.startsWith("block:") ? text.slice("block:".length) : text;
}

function parseKeyValues(text) {
  const fields = {};
  const pattern = /([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g;
  for (const match of text.matchAll(pattern)) {
    fields[match[1].toLowerCase()] = match[2];
  }
  return fields;
}

const LegacyEventNames = {
  "ps-agent-top": "agent.top",
  "ps-agent-note": "agent.note",
  "ps-agent-outline": "agent.outline",
  "ps-persist": "agent.session",
  "ps-capture": "agent.session",
  "ps-publish": "agent.pubsub",
  "ps-route": "agent.pubsub",
  "ps-recv": "agent.pubsub",
  "ps-set": "agent.pubsub",
  "ps-use": "agent.pubsub",
};

function normalizeSessionRef(value) {
  return typeof value === "string" && /^fnv1a64:[0-9a-f]{16}$/.test(value) ? value : null;
}

function parseLegacyLine(line, source, lineNumber) {
  const match = /^(\S+) \[([^\]]+)\](?:\s+(.*))?$/.exec(line.trim());
  if (match == null) return null;
  const fields = parseKeyValues(match[3] ?? "");
  const timestamp = Date.parse(match[1]);
  const sourceEvent = match[2];
  const event = LegacyEventNames[sourceEvent] ?? sourceEvent;
  let stage = fields.stage ?? null;
  const originalStage = stage;
  let outcome = fields.outcome ?? null;
  let reason = fields.reason ?? null;
  if (sourceEvent === "ps-persist") {
    stage = stage === "enter" ? "persist-request" : stage === "sent" ? "persist-result" : stage;
    outcome = originalStage === "sent" ? "ok" : originalStage === "fail" ? "error" : outcome;
  } else if (sourceEvent === "ps-capture") {
    stage = stage === "enter" ? "capture-request" : stage === "giveup" ? "capture-result" : stage;
    outcome = stage === "capture-result" ? "error" : outcome;
  } else if (["ps-publish", "ps-route", "ps-recv", "ps-set", "ps-use"].includes(sourceEvent)) {
    stage = sourceEvent.slice(3);
    outcome = fields.willskip === "true" ? "skipped" : (outcome ?? "ok");
    reason = fields.reason ?? (fields.willskip === "true" ? "stale-version" : null);
  }
  if (outcome == null && fields.visible != null) outcome = fields.visible === "true" ? "visible" : "hidden";
  if (reason == null) reason = fields.branch ?? null;
  const sessionRef = normalizeSessionRef(fields.sessionref ?? fields.sidref ?? "");
  return {
    v: 0,
    ts: Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(),
    event,
    stage,
    traceid: fields.traceid ?? fields.trace ?? null,
    blockid: normalizeId(fields.blockid ?? fields.block ?? "") || null,
    sessionref: sessionRef,
    durationms: numberOrNull(fields.durationms),
    outcome,
    reason,
    source,
    line: lineNumber,
  };
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseLogLine(line, source = "", lineNumber = 0) {
  const text = line.trim();
  if (text === "" || text.startsWith("=== pslog open")) return null;
  if (text.startsWith("{")) {
    try {
      const value = JSON.parse(text);
      if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
      const timestamp = value.ts ?? value.timestamp ?? null;
      return {
        v: value.v ?? 1,
        ts: timestamp,
        event: value.event ?? value.name ?? "unknown",
        stage: value.stage ?? null,
        traceid: value.traceid ?? value.trace ?? null,
        blockid: normalizeId(value.blockid ?? value.block ?? "") || null,
        sessionref: normalizeSessionRef(value.sessionref),
        durationms: numberOrNull(value.durationms),
        outcome: value.outcome ?? null,
        reason: value.reason ?? null,
        source,
        line: lineNumber,
      };
    } catch {
      return null;
    }
  }
  return parseLegacyLine(text, source, lineNumber);
}

function resolveLogFiles(options) {
  if (options.files.length > 0) return options.files.map((file) => path.resolve(file));
  const candidates = options.dir
    ? [options.dir]
    : process.env.WAVETERM_DATA_HOME
      ? [process.env.WAVETERM_DATA_HOME]
      : [path.join(os.homedir(), ".snorkeling"), path.join(process.env.APPDATA ?? os.homedir(), "snorkeling")];
  const files = [];
  for (const candidate of candidates) {
    const dir = path.resolve(candidate);
    const pslogDir = path.basename(dir).toLowerCase() === "pslog" ? dir : path.join(dir, "pslog");
    if (!fs.existsSync(pslogDir)) continue;
    for (const entry of fs.readdirSync(pslogDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".log")) files.push(path.join(pslogDir, entry.name));
    }
    if (files.length > 0) break;
  }
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function readEntries(files) {
  // ponytail: scan local rotated logs directly; switch to streaming or SQLite once searches approach one second.
  const entries = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, index) => {
      const entry = parseLogLine(line, file, index + 1);
      if (entry != null) entries.push(entry);
    });
  }
  return entries.sort((a, b) => timestampValue(a) - timestampValue(b));
}

function timestampValue(entry) {
  const value = Date.parse(entry.ts ?? "");
  return Number.isNaN(value) ? 0 : value;
}

function matches(entry, options, sinceCutoff) {
  if (options.block != null && normalizeId(entry.blockid) !== normalizeId(options.block)) return false;
  if (options.trace != null && String(entry.traceid ?? "") !== options.trace) return false;
  if (options.event != null && !String(entry.event ?? "").startsWith(options.event)) return false;
  if (sinceCutoff != null && timestampValue(entry) < sinceCutoff) return false;
  return true;
}

function displayEntry(entry) {
  const parts = [entry.ts ?? "?", `[${entry.event ?? "unknown"}]`];
  for (const key of ["stage", "blockid", "traceid", "sessionref", "durationms", "outcome", "reason"]) {
    if (entry[key] != null && entry[key] !== "") parts.push(`${key}=${entry[key]}`);
  }
  return parts.join(" ");
}

function diagnose(entries) {
  const findings = [];
  const groups = new Map();
  for (const entry of entries) {
    const key = String(entry.traceid ?? "") || normalizeId(entry.blockid) || "global";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [key, group] of groups) {
    const has = (event, stage) =>
      group.some((entry) => String(entry.event) === event && (stage == null || entry.stage === stage));
    const topRenders = group.filter(
      (entry) =>
        entry.event === "agent.top" && entry.stage === "render" && (entry.outcome != null || entry.visible != null)
    );
    const latestTopRender = topRenders[topRenders.length - 1] ?? null;
    const topRenderMiss =
      latestTopRender != null && (latestTopRender.outcome === "hidden" || String(latestTopRender.visible) === "false")
        ? latestTopRender
        : null;
    const atomWithSession = group.find(
      (entry) => entry.event === "agent.top" && entry.stage === "atom" && entry.sessionref != null
    );
    const frontendSession =
      atomWithSession ??
      group.find(
        (entry) => entry.event === "agent.pubsub" && ["set", "use"].includes(entry.stage) && entry.sessionref != null
      );
    if (topRenderMiss != null && frontendSession != null) {
      findings.push({
        code: "AGENT_TOP_001",
        severity: "high",
        key,
        message: "atom 已收到 session，但 TopBar 渲染不可见",
        evidence: [frontendSession, topRenderMiss],
      });
    }
    const noteSuccess = group.find(
      (entry) =>
        entry.event === "agent.note" &&
        ((entry.stage === "result" && entry.outcome === "ok") || entry.stage === "success")
    );
    const noteRenders = group.filter((entry) => entry.event === "agent.note" && entry.stage === "render");
    const latestNoteRender = noteRenders[noteRenders.length - 1] ?? null;
    const noteNoSummary =
      latestNoteRender != null && (latestNoteRender.reason === "no-summary" || latestNoteRender.branch === "no-summary")
        ? latestNoteRender
        : null;
    if (noteSuccess != null && noteNoSummary != null && timestampValue(noteNoSummary) >= timestampValue(noteSuccess)) {
      findings.push({
        code: "AGENT_NOTE_001",
        severity: "high",
        key,
        message: "Note Summary 请求成功，但渲染分支仍为 no-summary",
        evidence: [noteSuccess, noteNoSummary],
      });
    }
    const persisted = group.find(
      (entry) => entry.event === "agent.session" && entry.stage === "persist-result" && entry.outcome === "ok"
    );
    const received = group.find(
      (entry) => entry.event === "agent.pubsub" && entry.stage === "recv" && entry.outcome !== "skipped"
    );
    if (persisted != null && received == null && Date.now() - timestampValue(persisted) >= 2000) {
      findings.push({
        code: "AGENT_CHAIN_001",
        severity: "high",
        key,
        message: "session 已持久化，但前端没有收到对应 waveobj 更新",
        evidence: [persisted],
      });
    }
    const set = group.find((entry) => entry.event === "agent.pubsub" && entry.stage === "set");
    if (received != null && set == null && Date.now() - timestampValue(received) >= 1000) {
      findings.push({
        code: "AGENT_CHAIN_002",
        severity: "high",
        key,
        message: "前端已收到 session 更新，但没有写入 WaveObject atom",
        evidence: [received],
      });
    }
    const requests = group.filter(
      (entry) => ["agent.note", "agent.outline"].includes(entry.event) && entry.stage === "request"
    );
    for (const request of requests) {
      const terminal = group.some(
        (entry) =>
          entry.event === request.event &&
          entry.traceid === request.traceid &&
          timestampValue(entry) >= timestampValue(request) &&
          (entry.stage === "result" || ["success", "error", "stale", "stale-error"].includes(entry.stage))
      );
      if (!terminal && Date.now() - timestampValue(request) >= 5000) {
        findings.push({
          code: "AGENT_RPC_001",
          severity: "medium",
          key,
          message: "Agent 顶部 RPC 只有 request，没有终态事件",
          evidence: [request],
        });
      }
    }
    if (
      !has("agent.note", "request") &&
      !has("agent.outline", "request") &&
      group.some((entry) => entry.event === "agent.top")
    ) {
      findings.push({
        code: "AGENT_TOP_002",
        severity: "low",
        key,
        message: "TopBar 有渲染记录，但没有 Note/Outline 请求记录",
        evidence: [group.find((entry) => entry.event === "agent.top")],
      });
    }
  }
  return findings;
}

export function queryLog(options) {
  options = { files: [], limit: DefaultLimit, ...options };
  const files = resolveLogFiles(options);
  const since = parseDuration(options.since);
  const cutoff = since == null ? null : Date.now() - since;
  const entries = readEntries(files).filter((entry) => matches(entry, options, cutoff));
  return { files, entries: entries.slice(-options.limit), findings: options.diagnose ? diagnose(entries) : [] };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }
    const result = queryLog(options);
    if (options.diagnose) {
      if (options.json) process.stdout.write(`${JSON.stringify(result.findings, null, 2)}\n`);
      else if (result.findings.length === 0) process.stdout.write("No Agent top-chain findings.\n");
      else {
        for (const finding of result.findings) {
          process.stdout.write(`${finding.code} [${finding.severity}] ${finding.key}: ${finding.message}\n`);
          for (const evidence of finding.evidence.filter(Boolean))
            process.stdout.write(`  ${displayEntry(evidence)}\n`);
        }
      }
      return;
    }
    if (options.json) process.stdout.write(`${JSON.stringify(result.entries, null, 2)}\n`);
    else {
      for (const entry of result.entries) process.stdout.write(`${displayEntry(entry)}\n`);
      if (result.entries.length === 0) process.stdout.write("No matching pslog entries.\n");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] != null && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();

export { diagnose, parseArgs, parseDuration, resolveLogFiles };
