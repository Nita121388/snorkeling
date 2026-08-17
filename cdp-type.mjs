// CDP helper: 向 xterm terminal 注入键盘输入
import WebSocket from "ws";

const listRes = await fetch("http://127.0.0.1:9222/json/list").then((r) => r.json());
const page = listRes.find((p) => p.title.includes("Wave Terminal"));
if (!page) { console.error("no page", listRes.map(p=>p.id)); process.exit(1); }
console.log("page", page.id);

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0;
const pending = new Map();
const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });
ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
    }
});
await new Promise((res) => ws.on("open", res));

// focus xterm textarea
const focus = await send("Runtime.evaluate", {
    expression: `(() => { const ta=document.querySelector('.xterm-helper-textarea'); if(!ta) return 'no-ta'; ta.focus(); return 'ok'; })()`,
    returnByValue: true,
});
console.log("focus:", focus.result?.value);

const text = process.argv[2] ?? "echo CDP-TEST-123";
await send("Input.insertText", { text });
console.log("inserted:", text);

// always press enter
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
console.log("enter pressed");
ws.close();