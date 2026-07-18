import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { diagnose, parseLogLine, queryLog } from "./pslog-query.mjs";

test("parseLogLine reads structured and legacy pslog entries", () => {
  const structured = parseLogLine(
    '{"v":1,"ts":"2026-07-19T00:00:00.000Z","event":"agent.note","stage":"success","traceid":"fe-1","blockid":"block-1","sessionref":"abc123","note":"private","token":"secret"}',
    "fixture.log",
    4
  );
  assert.equal(structured.event, "agent.note");
  assert.equal(structured.blockid, "block-1");
  assert.equal(structured.traceid, "fe-1");
  assert.equal(structured.sessionref, null);
  assert.equal("note" in structured, false);
  assert.equal("token" in structured, false);
  assert.equal(structured.line, 4);

  const legacy = parseLogLine(
    "2026-07-19T00:00:01.000 [ps-agent-top] stage=render block=block-1 trace=fe-1",
    "fixture.log",
    5
  );
  assert.equal(legacy.event, "agent.top");
  assert.equal(legacy.blockid, "block-1");
  assert.equal(legacy.traceid, "fe-1");
});

test("queryLog filters by block and diagnoses an invisible top bar", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pslog-query-"));
  const pslogDir = path.join(root, "pslog");
  fs.mkdirSync(pslogDir);
  const lines = [
    {
      v: 1,
      ts: "2026-07-19T00:00:00.000Z",
      event: "agent.top",
      stage: "atom",
      blockid: "block-1",
      sessionref: "fnv1a64:9f0fe866346bdc9a",
    },
    {
      v: 1,
      ts: "2026-07-19T00:00:00.100Z",
      event: "agent.top",
      stage: "render",
      blockid: "block-1",
      outcome: "hidden",
    },
    {
      v: 1,
      ts: "2026-07-19T00:00:00.200Z",
      event: "agent.top",
      stage: "render",
      blockid: "block-2",
      outcome: "visible",
    },
  ];
  fs.writeFileSync(path.join(pslogDir, "pslog-test.log"), lines.map((line) => JSON.stringify(line)).join("\n"));
  const result = queryLog({ dir: root, block: "block-1", limit: 20, files: [], diagnose: true });
  assert.equal(result.entries.length, 2);
  assert.equal(result.findings[0]?.code, "AGENT_TOP_001");
});

test("diagnose distinguishes a complete trace from a missing frontend receive", () => {
  const traceid = "agent:block-1:fnv1a64:9f0fe866346bdc9a";
  const base = { v: 1, blockid: "block-1", traceid, sessionref: "fnv1a64:9f0fe866346bdc9a" };
  const event = (offset, name, stage, outcome = "ok", reason = null) => ({
    ...base,
    ts: new Date(Date.now() - 10_000 + offset).toISOString(),
    event: name,
    stage,
    outcome,
    reason,
  });
  const complete = [
    event(0, "agent.session", "persist-result"),
    event(10, "agent.pubsub", "publish"),
    event(20, "agent.pubsub", "route"),
    event(30, "agent.pubsub", "recv"),
    event(40, "agent.pubsub", "set"),
    event(50, "agent.pubsub", "use"),
    event(60, "agent.top", "render", "visible"),
    event(70, "agent.note", "request", null),
    event(80, "agent.note", "result"),
    event(90, "agent.note", "render", "visible"),
    event(100, "agent.outline", "request", null),
    event(110, "agent.outline", "result"),
    event(120, "agent.outline", "render", "visible"),
  ];
  assert.deepEqual(diagnose(complete), []);
  assert.equal(diagnose(complete.filter((entry) => entry.stage !== "recv"))[0]?.code, "AGENT_CHAIN_001");
});

test("diagnose ignores an early hidden render followed by a visible render", () => {
  const traceid = "agent:block-1:fnv1a64:9f0fe866346bdc9a";
  const base = { v: 1, blockid: "block-1", traceid, sessionref: "fnv1a64:9f0fe866346bdc9a" };
  const event = (offset, outcome) => ({
    ...base,
    ts: new Date(Date.now() - 10_000 + offset).toISOString(),
    event: "agent.top",
    stage: "render",
    outcome,
  });
  const findings = diagnose([
    { ...base, ts: new Date(Date.now() - 10_000).toISOString(), event: "agent.top", stage: "atom", outcome: "ok" },
    event(0, "hidden"),
    event(10, "visible"),
  ]);
  assert.equal(
    findings.some((finding) => finding.code === "AGENT_TOP_001"),
    false
  );
});
