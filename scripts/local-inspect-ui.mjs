/**
 * Local-only Electron UI inspector via Chrome DevTools Protocol (CDP)
 *
 * Usage:
 *   node scripts/local-inspect-ui.mjs state
 *   node scripts/local-inspect-ui.mjs elements --limit 40
 *   node scripts/local-inspect-ui.mjs style "Common Text"
 *   node scripts/local-inspect-ui.mjs click <x> <y>
 *   node scripts/local-inspect-ui.mjs screenshot [filename]
 *   node scripts/local-inspect-ui.mjs html [selector]
 *   node scripts/local-inspect-ui.mjs eval "1+1"
 *   node scripts/local-inspect-ui.mjs eval "document.title"
 *   node scripts/local-inspect-ui.mjs run-script path/to/script.js
 *   node scripts/local-inspect-ui.mjs console "console.log('hello')"
 *
 * The app must be running with --remote-debugging-port=9222.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CDP_PORT = 9222;
const BASE = `http://127.0.0.1:${CDP_PORT}`;

// -- helpers ----------------------------------------------------------

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

/** Find the first page/webview target from the /json/list endpoint. */
async function findTarget() {
  const list = await fetchJSON(`${BASE}/json/list`);
  const pages = list.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  // Prefer a real workspace tab title ("Wave Terminal - T<n>") over the bare init window.
  const target =
    pages.find((t) => /Wave Terminal - T\d/.test(t.title ?? "")) ||
    pages.find((t) => (t.title ?? "").includes("Wave Terminal")) ||
    pages[0];
  if (!target) {
    throw new Error(
      `No page target found on port ${CDP_PORT}. Is the app running with --remote-debugging-port=${CDP_PORT}?\n` +
        `Check ${BASE}/json/list in a browser.`
    );
  }
  return target;
}

/** Attach via CDP and return a send() helper + disconnect(). */
async function connect() {
  const wsURL = (await findTarget()).webSocketDebuggerUrl;
  const ws = new WebSocket(wsURL);
  let msgId = 1;
  const pending = new Map();

  ws.addEventListener("message", (raw) => {
    const msg = JSON.parse(raw.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
    setTimeout(() => reject(new Error("CDP WebSocket timeout")), 5000);
  });

  const send = async (method, params = {}) => {
    const id = msgId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, { resolve }));
  };

  const disconnect = () => ws.close();

  return { send, disconnect };
}

// -- console capture --------------------------------------------------

/**
 * Inject a console.log interceptor into the page and return a flush()
 * function that retrieves buffered log lines.
 */
async function injectConsoleCapture(send) {
  await send("Runtime.evaluate", {
    expression: `
      (function() {
        if (window.__cdpLogBuffer) return;
        window.__cdpLogBuffer = [];
        const orig = console.log;
        console.log = function() {
          window.__cdpLogBuffer.push(Array.from(arguments).join(" "));
          return orig.apply(console, arguments);
        };
      })()
    `,
  });
}

async function flushConsole(send) {
  const { result } = await send("Runtime.evaluate", {
    expression: `(function() {
      const buf = (window.__cdpLogBuffer || []).slice();
      window.__cdpLogBuffer = [];
      return buf;
    })()`,
    returnByValue: true,
  });
  return result?.result?.value || [];
}

// -- commands ---------------------------------------------------------

async function cmdState() {
  const { send, disconnect } = await connect();
  try {
    const { result: doc } = await send("DOM.getDocument", { depth: 0 });
    const { result: { nodeId } } = await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "body",
    });
    const { result } = await send("DOM.getOuterHTML", { nodeId });
    console.log(`Document URL: ${doc.root.documentURL}`);
    console.log(`Body HTML length: ${result.outerHTML.length} chars`);
    console.log(`Body (truncated to 2000):\n${result.outerHTML.slice(0, 2000)}`);
  } finally {
    disconnect();
  }
}

async function cmdElements(limit = 40) {
  const { send, disconnect } = await connect();
  try {
    const { result: doc } = await send("DOM.getDocument", { depth: 0 });
    const { result: { nodeId } } = await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: "*",
    });
    const { result: { nodeIds } } = await send("DOM.querySelectorAll", {
      nodeId,
      selector: "*",
    });

    const top = nodeIds.slice(0, limit);
    const infos = [];
    for (const id of top) {
      try {
        const { result } = await send("DOM.describeNode", { nodeId: id, depth: 0 });
        const n = result.node;
        infos.push({
          nodeId: n.nodeId,
          nodeName: n.nodeName,
          localName: n.localName,
          id: n.attributes
            ? n.attributes[n.attributes.indexOf("id") + 1]
            : undefined,
          classes: n.attributes
            ? (() => {
                const idx = n.attributes.indexOf("class");
                return idx >= 0 ? n.attributes[idx + 1] : "";
              })()
            : "",
          childNodeCount: n.childNodeCount,
          attributes: n.attributes || [],
        });
      } catch {
        // skip detached nodes
      }
    }

    console.log(`Total elements: ${nodeIds.length}, showing first ${limit}:`);
    for (const info of infos) {
      const tag = info.localName || info.nodeName;
      const cls = info.classes ? `.${info.classes.split(/\s+/).join(".")}` : "";
      const ida = info.id ? `#${info.id}` : "";
      const kids = info.childNodeCount != null ? ` [${info.childNodeCount} children]` : "";
      console.log(`  [${info.nodeId}] <${tag}${ida}${cls}>${kids}`);
    }
  } finally {
    disconnect();
  }
}

async function cmdStyle(search) {
  const { send, disconnect } = await connect();
  try {
    const { result: doc } = await send("DOM.getDocument", { depth: 0 });
    const { result: { nodeId } } = await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: `*`,
    });
    const { result: { nodeIds } } = await send("DOM.querySelectorAll", {
      nodeId,
      selector: `*`,
    });

    const candidates = [];
    for (const id of nodeIds) {
      try {
        const { result } = await send("DOM.describeNode", { nodeId: id, depth: 1 });
        const n = result.node;

        let match = false;
        if (n.attributes) {
          for (let i = 0; i < n.attributes.length; i += 2) {
            if (
              n.attributes[i].toLowerCase().includes(search.toLowerCase()) ||
              (n.attributes[i + 1] &&
                n.attributes[i + 1].toLowerCase().includes(search.toLowerCase()))
            ) {
              match = true;
              break;
            }
          }
        }
        if (!match && n.children) {
          for (const child of n.children) {
            if (child.nodeType === 3 && child.nodeValue?.trim()) {
              if (child.nodeValue.toLowerCase().includes(search.toLowerCase())) {
                match = true;
                break;
              }
            }
          }
        }
        if (match) candidates.push(id);
      } catch {
        // skip
      }
    }

    if (candidates.length === 0) {
      console.log(`No elements found matching "${search}"`);
      return;
    }

    console.log(`Found ${candidates.length} element(s) matching "${search}":`);
    const limit = Math.min(candidates.length, 5);
    for (let i = 0; i < limit; i++) {
      const id = candidates[i];

      let boxModel = null;
      try {
        const boxRes = await send("DOM.getBoxModel", { nodeId: id });
        boxModel = boxRes.result?.model;
      } catch {
        // hidden/detached node
      }

      let computedStyle = null;
      try {
        const result2 = await send("CSS.getComputedStyleForNode", { nodeId: id });
        computedStyle = result2.result?.computedStyle;
      } catch {
        // CSS domain may not be available
      }

      const styleMap = {};
      if (computedStyle) {
        for (const prop of computedStyle) {
          styleMap[prop.name] = prop.value;
        }
      }

      const { result: { node } } = await send("DOM.describeNode", { nodeId: id, depth: 0 });
      const box = boxModel;
      const boxInfo = box
        ? `x=${box.content[0]} y=${box.content[1]} w=${box.width} h=${box.height}`
        : "hidden/detached";
      console.log(`\n--- [${id}] <${node.nodeName}> ---`);
      console.log(`  Box: ${boxInfo}`);
      if (styleMap.display) console.log(`  display: ${styleMap.display}`);
      if (styleMap.flex) console.log(`  flex: ${styleMap.flex}`);
      if (styleMap["min-height"]) console.log(`  minHeight: ${styleMap["min-height"]}`);
      if (styleMap.height) console.log(`  height: ${styleMap.height}`);
      if (styleMap["max-height"]) console.log(`  maxHeight: ${styleMap["max-height"]}`);
      if (styleMap.overflow) console.log(`  overflow: ${styleMap.overflow}`);
      if (styleMap["overflow-y"]) console.log(`  overflowY: ${styleMap["overflow-y"]}`);
      if (box) console.log(`  clientHeight (box): ${box.height}`);
      if (node.attributes) {
        const attrs = {};
        for (let i = 0; i < node.attributes.length; i += 2) {
          attrs[node.attributes[i]] = node.attributes[i + 1];
        }
        if (attrs["aria-label"]) console.log(`  aria-label: ${attrs["aria-label"]}`);
        if (attrs.title) console.log(`  title: ${attrs.title}`);
        if (attrs.class) console.log(`  class: ${attrs.class}`);
      }
    }

    if (candidates.length > limit) {
      console.log(`\n... and ${candidates.length - limit} more matches`);
    }
  } finally {
    disconnect();
  }
}

async function cmdClick(x, y) {
  const { send, disconnect } = await connect();
  try {
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x, y,
      button: "left",
      clickCount: 1,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x, y,
      button: "left",
      clickCount: 1,
    });
    console.log(`Clicked at (${x}, ${y})`);
  } finally {
    disconnect();
  }
}

async function cmdScreenshot(filename) {
  const { send, disconnect } = await connect();
  try {
    const { result: { data } } = await send("Page.captureScreenshot", { format: "png" });
    const buf = Buffer.from(data, "base64");
    const name = filename || `screenshot-${Date.now()}.png`;
    writeFileSync(name, buf);
    console.log(`Screenshot saved: ${name} (${buf.length} bytes)`);
  } finally {
    disconnect();
  }
}

async function cmdHtml(selector) {
  const { send, disconnect } = await connect();
  try {
    const { result: doc } = await send("DOM.getDocument", { depth: 0 });
    const sel = selector || "body";
    const { result: { nodeId } } = await send("DOM.querySelector", {
      nodeId: doc.root.nodeId,
      selector: sel,
    });
    if (!nodeId) {
      console.log(`No element found for selector "${sel}"`);
      return;
    }
    const { result } = await send("DOM.getOuterHTML", { nodeId });
    console.log(result.outerHTML);
  } finally {
    disconnect();
  }
}

/** Evaluate arbitrary JS in the renderer (page) context. Captures console.log output. */
async function cmdEval(jsExpr) {
  const { send, disconnect } = await connect();
  try {
    await injectConsoleCapture(send);

    const { result } = await send("Runtime.evaluate", {
      expression: jsExpr,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      console.error(`Error: ${result.exceptionDetails.text}`);
      if (result.exceptionDetails.exception?.description) {
        console.error(result.exceptionDetails.exception.description);
      }
    } else if (result.result) {
      const val = result.result.value;
      if (val !== undefined) {
        console.log(JSON.stringify(val, null, 2));
      }
    }

    const logs = await flushConsole(send);
    if (logs.length > 0) {
      console.log("\n--- console.log output ---");
      logs.forEach((l) => console.log(l));
    }
  } finally {
    disconnect();
  }
}

/** Run a JS file in the renderer context. */
async function cmdRunScript(scriptPath) {
  const fullPath = resolve(scriptPath);
  const code = readFileSync(fullPath, "utf-8");
  console.log(`Running script: ${fullPath}`);
  return cmdEval(`(function() {\n${code}\n})()`);
}

/** Evaluate JS and capture console.* output (Console domain events). */
async function cmdConsole(jsExpr) {
  const { send, disconnect } = await connect();
  try {
    await send("Console.enable");

    const { result } = await send("Runtime.evaluate", {
      expression: jsExpr,
      returnByValue: true,
    });

    if (result.exceptionDetails) {
      console.error(`Error: ${result.exceptionDetails.text}`);
      if (result.exceptionDetails.exception?.description) {
        console.error(result.exceptionDetails.exception.description);
      }
    }

    // Wait a tick for Console.messageAdded events to arrive over WS
    await new Promise((r) => setTimeout(r, 300));

    const logLines = [];
    // If no console messages came via Console domain, try the interceptor approach
    const { result: flushResult } = await send("Runtime.evaluate", {
      expression: `(function() {
        const arr = [];
        while (window.__cdpConsoleQueue && window.__cdpConsoleQueue.length) {
          arr.push(window.__cdpConsoleQueue.shift());
        }
        return arr;
      })()`,
      returnByValue: true,
    });
    const flushed = flushResult?.result?.value || [];
    if (flushed.length > 0) {
      logLines.push(...flushed);
    }

    if (logLines.length > 0) {
      console.log("--- console output ---");
      logLines.forEach((l) => console.log(l));
    } else {
      // Direct eval approach: monkey-patch and re-run
      await send("Runtime.evaluate", {
        expression: `(function() {
          if (window.__cdpConsoleQueue) return;
          window.__cdpConsoleQueue = [];
          const origLog = console.log;
          const origWarn = console.warn;
          const origError = console.error;
          console.log = function() {
            window.__cdpConsoleQueue.push("[log] " + Array.from(arguments).join(" "));
            return origLog.apply(console, arguments);
          };
          console.warn = function() {
            window.__cdpConsoleQueue.push("[warn] " + Array.from(arguments).join(" "));
            return origWarn.apply(console, arguments);
          };
          console.error = function() {
            window.__cdpConsoleQueue.push("[error] " + Array.from(arguments).join(" "));
            return origError.apply(console, arguments);
          };
        })()`,
      });
      const { result: reResult } = await send("Runtime.evaluate", {
        expression: jsExpr,
        returnByValue: true,
      });
      const { result: flush2Result } = await send("Runtime.evaluate", {
        expression: `(function() {
          const arr = [];
          while (window.__cdpConsoleQueue && window.__cdpConsoleQueue.length) {
            arr.push(window.__cdpConsoleQueue.shift());
          }
          return arr;
        })()`,
        returnByValue: true,
      });
      const flushed2 = flush2Result?.result?.value || [];
      if (flushed2.length > 0) {
        console.log("--- console output ---");
        flushed2.forEach((l) => console.log(l));
      } else {
        console.log("(no console output)");
      }
    }
  } finally {
    disconnect();
  }
}

// -- main -------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);

const COMMANDS = {
  state:       { fn: () => cmdState(),                    desc: "Show document state and body HTML" },
  elements:    { fn: () => cmdElements(+args[0] || 40),   desc: "List DOM elements (--limit)" },
  style:       { fn: () => cmdStyle(args[0] || ""),       desc: "Show computed style for matching elements" },
  click:       { fn: () => cmdClick(+args[0], +args[1]),  desc: "Click at coordinates x y" },
  screenshot:  { fn: () => cmdScreenshot(args[0]),        desc: "Capture screenshot (optional filename)" },
  html:        { fn: () => cmdHtml(args[0]),              desc: "Get outerHTML for a CSS selector" },
  eval:        { fn: () => cmdEval(args.join(" ")),       desc: "Evaluate JS expression in the page" },
  "run-script":{ fn: () => cmdRunScript(args[0]),         desc: "Run a JS file in the page context" },
  console:     { fn: () => cmdConsole(args.join(" ")),    desc: "Evaluate JS and capture console output" },
  help:        { fn: () => printHelp(),                   desc: "Show this help" },
};

function printHelp() {
  console.log(`Local Electron UI Inspector (CDP, port ${CDP_PORT})

Usage:
  node scripts/local-inspect-ui.mjs <command> [options]

Commands:
`);
  for (const [name, { desc }] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(14)} ${desc}`);
  }
  console.log(`
Examples:
  node scripts/local-inspect-ui.mjs state
  node scripts/local-inspect-ui.mjs elements --limit 40
  node scripts/local-inspect-ui.mjs style "Common Text"
  node scripts/local-inspect-ui.mjs click 1796 296
  node scripts/local-inspect-ui.mjs screenshot
  node scripts/local-inspect-ui.mjs html ".modal-content"
  node scripts/local-inspect-ui.mjs eval "document.title"
  node scripts/local-inspect-ui.mjs eval "document.querySelector('.tab.active')?.textContent"
  node scripts/local-inspect-ui.mjs eval "getComputedStyle(document.body).backgroundColor"
  node scripts/local-inspect-ui.mjs console "console.log('hello from renderer')"
  node scripts/local-inspect-ui.mjs run-script my-debug.js
`);
}

async function main() {
  if (!cmd || cmd === "help" || !COMMANDS[cmd]) {
    printHelp();
    return;
  }

  try {
    await COMMANDS[cmd].fn();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
