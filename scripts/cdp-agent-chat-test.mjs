// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
// CDP-driven behavior test for the AISessions Agent chat.
// Scopes each interaction to one AISessions block (.block-content), which holds
// the composer (textarea + send/stop) AND its message list together. Uses REAL
// CDP input (focus + Input.insertText) so React state actually updates, then
// drives send via in-page .click() (so a synchronous double-click can expose
// the async canSubmit guard race). Records results + screenshots.
//
// Usage: node scripts/cdp-agent-chat-test.mjs

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const Endpoint = "http://127.0.0.1:9222";
const PreferredTarget = "Wave Terminal";
const ShotDir = path.join(process.cwd(), "screenshots");
const ReportPath = path.join(process.cwd(), "tests", "cdp-agent-chat-raw.md");

const HELPER = `
function __blocks(){
  return [...document.querySelectorAll('.block-content')].filter(b=>b.querySelector('textarea'));
}
function __pickBlock(){
  const bs=__blocks();
  if(bs.length===0) return null;
  // visible + widest composer textarea => active block
  let best=null,bestScore=-1;
  for(const b of bs){
    const ta=b.querySelector('textarea'); const r=ta.getBoundingClientRect();
    const visible=r.width>0&&r.height>0&&r.top>=0&&r.top<window.innerHeight;
    const score=(visible?1000:0)+r.width;
    if(score>bestScore){bestScore=score;best=b;}
  }
  if(!best) return null;
  const ta=best.querySelector('textarea');
  const sb=best.querySelector('button[aria-label="Send message"],button[aria-label="Stop"]');
  return {root:best, ta, sb, count:best.querySelectorAll('[id^="aisession-message-"]').length};
}
function __msgsIn(root){
  return [...root.querySelectorAll('[id^="aisession-message-"]')].map(el=>{
    const m=el.id.match(/aisession-message-(\\d+)/);
    const isUser=!!el.querySelector('.fa-user');
    return {seq:m?Number(m[1]):-1, isUser, text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,140)};
  });
}
function __blockOfMarker(marker){
  for(const b of __blocks()){
    if([...b.querySelectorAll('[id^="aisession-message-"]')].some(c=>(c.innerText||'').includes(marker)))
      return {root:b, ta:b.querySelector('textarea'), sb:b.querySelector('button[aria-label="Send message"],button[aria-label="Stop"]'), msgs:__msgsIn(b)};
  }
  return null;
}
function __globalStop(){ return !!document.querySelector('button[aria-label="Stop"]'); }
function __idle(){ const s=__globalStop(); if(s){ [...document.querySelectorAll('button[aria-label="Stop"]')][0].click(); return false;} return true; }
`;

class CDPClient {
    constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.ws = null; }
    connect() {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(this.url);
            const timer = setTimeout(() => { reject(new Error("CDP connect timeout")); ws.close(); }, 10000);
            ws.addEventListener("open", () => { clearTimeout(timer); this.ws = ws; resolve(); });
            ws.addEventListener("message", (e) => {
                const msg = JSON.parse(e.data); if (msg.id == null) return;
                const p = this.pending.get(msg.id); if (!p) return;
                clearTimeout(p.timer); this.pending.delete(msg.id);
                if (msg.error) p.reject(new Error(`${msg.error.message}`)); else p.resolve(msg.result);
            });
            ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WS error")); });
        });
    }
    send(method, params = {}, timeoutMs = 20000) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP not open"));
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    close() { this.ws?.close(); }
}
async function getTargets() {
    const root = Endpoint.replace(/\/$/, "");
    for (const s of ["/json/list", "/json"]) { const r = await fetch(`${root}${s}`); if (r.ok) { const d = await r.json(); if (Array.isArray(d)) return d; } }
    throw new Error("no targets");
}
function selectTarget(targets) {
    const pref = PreferredTarget.toLowerCase();
    return [...targets].filter((t) => t.webSocketDebuggerUrl && !String(t.title + t.url).toLowerCase().includes("devtools"))
        .map((t, i) => ({ t, i, s: String(t.title + t.url).toLowerCase().includes(pref) ? 1000 : 0 }))
        .sort((a, b) => b.s - a.s || a.i - b.i)[0]?.t;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const targets = await getTargets();
    const target = selectTarget(targets);
    const client = new CDPClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Runtime.enable");
    await client.send("Page.enable");

    const report = [];
    const log = (s) => { report.push(s); console.log(s); };
    const evalIn = async (expr, timeoutMs = 20000) => {
        const r = await client.send("Runtime.evaluate", { expression: HELPER + "\n;" + expr, returnByValue: true, awaitPromise: true }, timeoutMs);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
        return r.result?.value;
    };
    const shot = async (name) => {
        const r = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const p = path.join(ShotDir, name);
        await mkdir(ShotDir, { recursive: true });
        await writeFile(p, Buffer.from(r.data, "base64"));
        return p;
    };
    const focusTa = async (rect) => {
        await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    };
    const typeInto = async (text) => { await client.send("Input.insertText", { text }); };
    const ensureIdle = async (label) => {
        for (let i = 0; i < 15; i++) {
            const st = await evalIn(`(async()=>{ const idle=__idle(); const sb=[...document.querySelectorAll('button[aria-label="Send message"]')][0]; return {idle, hasSend:!!sb}; })()`);
            if (st.hasSend) return st;
            await sleep(1000);
        }
        log(`⚠️ ${label}: 12s+ 内未回到 idle`);
        return null;
    };

    log(`# CDP Agent Chat Test — ${new Date().toISOString()}`);
    log(`target: ${target.title} (${target.url})`);
    log("");
    log("> 假设：AISessions 视图已打开，CDP 可达。每个 AISessions 块(.block-content)包含自己的 composer 与消息列表，测试在同一块内作用域。会创建带 CDP_TEST_/CDP_DUP_ 标记的消息便于清理。");

    // Recon
    const recon = await evalIn(`(async()=>{ const p=__pickBlock(); if(!p) return {ok:false}; const r=p.ta.getBoundingClientRect(); return {ok:true, taPlaceholder:p.ta.placeholder, taRect:{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}, sbLabel:p.sb?p.sb.getAttribute('aria-label'):null, count:p.count}; })()`);
    log("## Recon");
    log("```json\n" + JSON.stringify(recon, null, 2) + "\n```");
    await shot("cdp-01-recon.png");

    // T-ORD: ordering (works on populated session)
    const ordering = await evalIn(`(async()=>{ const p=__pickBlock(); if(!p||p.count===0) return {skipped:true, count:0}; const ms=__msgsIn(p.root); let asc=true,prev=-1; for(const m of ms){ if(m.seq<prev) asc=false; prev=m.seq; } const runs=[]; let cur=null; for(const m of ms){ const r=m.isUser?'user':'ai'; if(cur!==r){runs.push(r);cur=r;} } return {count:ms.length, seqAscending:asc, roleRuns:runs, first:ms[0]||null, last:ms[ms.length-1]||null}; })()`);
    log("## T-ORD · 消息顺序");
    log("```json\n" + JSON.stringify(ordering, null, 2) + "\n```");

    // helper: drive one send (real input) then in-page click(s), poll until turn ends
    async function driveSend(marker, clicks) {
        const pick = await evalIn(`(async()=>{ const p=__pickBlock(); if(!p) return null; const r=p.ta.getBoundingClientRect(); const s=p.sb.getBoundingClientRect(); return {taRect:{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}, sbRect:{x:Math.round(s.x+s.width/2),y:Math.round(s.y+s.height/2)}, sbLabel:p.sb.getAttribute('aria-label')}; })()`);
        if (!pick) return { ok: false, reason: "no block" };
        await focusTa(pick.taRect);
        await sleep(150);
        await typeInto(marker);
        await sleep(300);
        const afterType = await evalIn(`(async()=>{ const p=__pickBlock(); const ta=p.ta; const sb=p.sb; return {taValEnd:ta.value.slice(-16), sbDisabled:sb?sb.disabled:null, sbLabel:sb?sb.getAttribute('aria-label'):null}; })()`);
        // in-page click(s): synchronous to expose async canSubmit guard
        await evalIn(`(async()=>{ const p=__pickBlock(); const sb=p.sb; for(let i=0;i<${clicks};i++) sb.click(); })()`);
        // poll until the turn ends (global Stop disappears) or 45s cap
        const marks = [0, 300, 1000, 2500, 5000, 10000]; let prev = 0; const samples = [];
        let stopSeen = false;
        for (let i = 0; i < 45; i++) {
            const s = await evalIn(`(async()=>{ const blk=__blockOfMarker(${JSON.stringify(marker)}); const has=!!blk && blk.msgs.some(m=>m.isUser&&m.text.includes(${JSON.stringify(marker)})); const stop=__globalStop(); const btn=blk?[...blk.root.querySelectorAll('button[aria-label="Send message"],button[aria-label="Stop"]')][0]:null; return {markerAppeared:has, globalStop:stop, sendLabel:btn?btn.getAttribute('aria-label'):null, seqs:blk?blk.msgs.map(m=>m.seq):[]}; })()`);
            samples.push({ t: i * 1000, ...s });
            if (s.globalStop) stopSeen = true;
            if (stopSeen && !s.globalStop) break;            // turn ended
            if (i < marks.length) { /* initial fine-grained */ }
            await sleep(1000);
        }
        const finalBlk = await evalIn(`(async()=>{ const blk=__blockOfMarker(${JSON.stringify(marker)}); if(!blk) return {found:false}; return {found:true, userMsgCount:blk.msgs.filter(m=>m.isUser&&m.text.includes(${JSON.stringify(marker)})).length, total:blk.msgs.length, seqs:blk.msgs.map(m=>m.seq), roles:blk.msgs.map(m=>m.isUser?'u':'a')}; })()`);
        return { ok: true, pick, afterType, samples, finalBlk };
    }

    // T-SND-DUP: clean idle, two synchronous in-page clicks
    await ensureIdle("T-SND-DUP 前");
    const dupMarker = "CDP_DUP_" + Date.now();
    const dup = await driveSend(dupMarker, 2);
    log("## T-SND-DUP · 重复发送防护（真实输入 + 同步两次页内点击）");
    log("```json\n" + JSON.stringify({ marker: dupMarker, afterType: dup.ok ? dup.afterType : null, finalBlk: dup.ok ? dup.finalBlk : null, stopSeen: dup.ok ? dup.samples.some((s) => s.globalStop) : null }, null, 2) + "\n```");
    await shot("cdp-02-dup.png");

    // T-SND: single send, timing of user-message appearance + send/stop toggle
    await ensureIdle("T-SND 前");
    const marker = "CDP_TEST_" + Date.now();
    const sendProbe = await driveSend(marker, 1);
    const sendSummary = sendProbe.ok ? { afterType: sendProbe.afterType, appearedAt: (() => { const s = sendProbe.samples.find((x) => x.markerAppeared); return s ? s.t : null; })(), stopSeen: sendProbe.samples.some((s) => s.globalStop), finalBlk: sendProbe.finalBlk } : { ok: false };
    log("## T-SND · 发送后用户消息出现时机 + Send/Stop 切换");
    log("```json\n" + JSON.stringify({ marker, ...sendSummary }, null, 2) + "\n```");
    await shot("cdp-03-after-send.png");

    // T-ST: agent state labels from the marker session's composer
    const stateLabels = await evalIn(`(async()=>{ const blk=__blockOfMarker(${JSON.stringify(marker)}); if(!blk) return {note:'marker session not found'}; const labels=[...blk.root.querySelectorAll('button')].map(b=>(b.getAttribute('aria-label')||'')+'|'+(b.innerText||'').trim()).filter(s=>/模型|思考|pi/i.test(s)); return {labels}; })()`);
    log("## T-ST · Agent 状态标签（模型/思考/agent）");
    log("```json\n" + JSON.stringify(stateLabels, null, 2) + "\n```");

    // T-STP: stop during streaming
    const stop = await evalIn(`(async()=>{ const sb=[...document.querySelectorAll('button[aria-label="Stop"]')][0]; if(!sb) return {note:'no Stop button (no active stream)'}; sb.click(); await new Promise(r=>setTimeout(r,1500)); const after=[...document.querySelectorAll('button[aria-label="Send message"],button[aria-label="Stop"]')][0]; return {stopped:true, sendLabelAfter:after?after.getAttribute('aria-label'):null}; })()`);
    log("## T-STP · 流式中停止");
    log("```json\n" + JSON.stringify(stop, null, 2) + "\n```");
    await shot("cdp-04-after-stop.png");

    await ensureIdle("收尾");
    await writeReport(report);
    client.close();
    log("\n✅ done — report: " + ReportPath);
}
async function writeReport(lines) { await mkdir(path.dirname(ReportPath), { recursive: true }); await writeFile(ReportPath, lines.join("\n") + "\n"); }
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
