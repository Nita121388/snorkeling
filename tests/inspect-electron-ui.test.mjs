import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, selectTarget } from "../scripts/inspect-electron-ui.mjs";

test("parseArgs reads global options and command arguments", () => {
    const parsed = parseArgs([
        "--endpoint",
        "http://127.0.0.1:9333",
        "--target",
        "Wave Terminal",
        "elements",
        "--limit",
        "12",
    ]);

    assert.equal(parsed.endpoint, "http://127.0.0.1:9333");
    assert.equal(parsed.target, "Wave Terminal");
    assert.equal(parsed.command, "elements");
    assert.deepEqual(parsed.args, ["--limit", "12"]);
});

test("selectTarget prefers matching inspectable app page", () => {
    const target = selectTarget(
        [
            {
                type: "page",
                title: "",
                url: "about:blank",
                webSocketDebuggerUrl: "ws://blank",
            },
            {
                type: "page",
                title: "Wave Terminal - T1",
                url: "http://localhost:5173/index.html",
                webSocketDebuggerUrl: "ws://wave",
            },
            {
                type: "page",
                title: "DevTools",
                url: "devtools://devtools",
                webSocketDebuggerUrl: "ws://devtools",
            },
        ],
        "Wave Terminal"
    );

    assert.equal(target.webSocketDebuggerUrl, "ws://wave");
});
