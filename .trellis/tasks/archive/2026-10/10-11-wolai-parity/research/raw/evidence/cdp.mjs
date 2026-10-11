// Minimal CDP driver: node /tmp/cdp.mjs '<json-plan-file>'
// plan file: { "steps": [ {"type":"eval","expr":"..."} , {"type":"mouse","x":1,"y":2},
//   {"type":"click","x":1,"y":2}, {"type":"key","text":"a"}, {"type":"rawkey","key":"Tab","code":"Tab","vk":9,"mods":0},
//   {"type":"shot","path":"/tmp/x.png"}, {"type":"wait","ms":500} ] }
import fs from 'fs';
import WebSocket from 'ws';

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cdpPort = plan.port || 20015;

const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
const target = list.find(t => t.type === 'page' && (!plan.urlMatch || t.url.includes(plan.urlMatch)));
if (!target) { console.error('no target', list.map(t => t.url)); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 200 * 1024 * 1024 });
let id = 0;
const pending = new Map();
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ error: 'timeout ' + method }); } }, 60000);
});
await new Promise(r => ws.on('open', r));
const out = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (const s of plan.steps) {
  if (s.type === 'eval') {
    const r = await send('Runtime.evaluate', { expression: s.expr, returnByValue: true, awaitPromise: !!s.await });
    out.push({ step: 'eval', label: s.label, value: r.result?.result?.value, err: r.result?.exceptionDetails?.text || r.error });
  } else if (s.type === 'mouse') {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'none' });
  } else if (s.type === 'click') {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'none' });
    await sleep(120);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 0 });
  } else if (s.type === 'clickExpr' || s.type === 'mouseExpr') {
    const r = await send('Runtime.evaluate', { expression: s.expr, returnByValue: true, awaitPromise: !!s.await });
    const v = r.result?.result?.value;
    const pt = typeof v === 'string' ? JSON.parse(v) : v;
    if (!pt || pt.x == null) { out.push({ step: s.type, label: s.label, err: 'no point', v }); }
    else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
      await sleep(150);
      if (s.type === 'clickExpr') {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 1 });
        await sleep(60);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: 0 });
      }
      out.push({ step: s.type, label: s.label, point: pt });
    }
  } else if (s.type === 'key') {
    for (const ch of s.text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    }
  } else if (s.type === 'type') {
    for (const ch of s.text) {
      const code = ch === ' ' ? 'Space' : ch === '/' ? 'Slash' : ch === '#' ? 'Digit3' : ch === '-' ? 'Minus' : ch === '>' ? 'Period' : /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : ch.charCodeAt(0) < 32 ? '' : 'Digit' + ch;
      const vk = ch === ' ' ? 32 : ch === '/' ? 191 : ch === '#' ? 51 : ch === '-' ? 189 : ch === '>' ? 190 : ch.toUpperCase().charCodeAt(0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch === ' ' ? ' ' : ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: ch, unmodifiedText: ch });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch === ' ' ? ' ' : ch, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      await sleep(s.delay || 40);
    }
  } else if (s.type === 'rawkey') {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: s.key, code: s.code, windowsVirtualKeyCode: s.vk, nativeVirtualKeyCode: s.vk, modifiers: s.mods || 0 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: s.key, code: s.code, windowsVirtualKeyCode: s.vk, nativeVirtualKeyCode: s.vk, modifiers: s.mods || 0 });
  } else if (s.type === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(s.path, Buffer.from(r.result.data, 'base64'));
    out.push({ step: 'shot', path: s.path, ok: !!r.result?.data });
  } else if (s.type === 'wait') { await sleep(s.ms); }
}
if (plan.out) fs.writeFileSync(plan.out, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, plan.printLimit || 6000));
ws.close();
process.exit(0);
