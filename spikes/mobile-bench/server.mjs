// 最小 mock server：同一份数据供给所有移动端方案
// 用法: node server.mjs [port]
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.argv[2] || 7801);
const AGENT_COUNT = 200;
const MSG_COUNT = 1000;

const now = Date.now();
const agents = Array.from({ length: AGENT_COUNT }, (_, i) => ({
  id: i, name: ['Claude Code', 'Codex', 'Pi Agent', 'Grok', 'OpenCode'][i % 5] + ' ' + i,
  env: ['MacBook Pro', 'Mac mini', 'VPS-backup'][i % 3],
  status: ['running', 'waiting', 'idle', 'offline'][i % 4],
  last: '第 ' + i + ' 个 agent 的最后一条消息：重构主题 token，等待验证结果',
  tags: ['snork-ui', 'dark-mode', 'tests'].slice(0, (i % 3) + 1),
  note: i % 2 ? '等你审完 diff 再提交' : '',
  props: [['model', ['opus-4.5', 'gpt-5.1-codex', 'pi-4'][i % 3]], ['branch', 'fix/theme-' + i]],
  time: '12:' + String(30 + (i % 30)).padStart(2, '0'),
  unread: i % 7 === 0 ? 1 : 0,
}));

const messages = Array.from({ length: MSG_COUNT }, (_, i) => ({
  id: i,
  role: i % 2 ? 'agent' : 'user',
  kind: i % 11 === 0 ? 'approval' : (i % 5 === 0 ? 'tool' : 'text'),
  text: i % 11 === 0
    ? 'rm -rf node_modules && npm install'
    : '第 ' + i + ' 条消息：' + '这是用于压测的正文，长度接近真实回复，包含中文与 code 片段 npm run verify。'.repeat(2),
  ts: now + i * 1000,
}));

function json(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  // 结果回传：浏览器跑完 POST 回来，服务端打到 stdout
  if (req.method === 'POST' && url.pathname === '/results') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      res.writeHead(204); res.end();
      console.log('RESULTS ' + body);
    });
    return;
  }
  if (url.pathname === '/api/agents') return json(res, agents);
  if (url.pathname === '/api/messages') return json(res, messages);

  // SSE 流：按 rate 条/秒 推消息，模拟 agent 流式回复
  if (url.pathname === '/events') {
    const rate = Number(url.searchParams.get('rate') || 30);
    const total = Number(url.searchParams.get('total') || 300);
    const sid = randomUUID();
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write('event: hello\ndata: {"session":"' + sid + '"}\n\n');
    const tick = 1000 / rate;
    let sent = 0;
    const timer = setInterval(() => {
      res.write('data: ' + JSON.stringify({
        seq: sent,
        text: '流式片段 ' + sent + '：' + 'token '.repeat(6),
      }) + '\n\n');
      if (++sent >= total) { clearInterval(timer); res.write('event: done\ndata: {}\n\n'); res.end(); }
    }, tick);
    req.on('close', () => clearInterval(timer));
    return;
  }
  // 静态文件（bench.html）
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/bench.html')) {
    const file = req.url.endsWith('.html') ? url.pathname.slice(1) : 'bench.html';
    readFile(join(HERE, file)).then(buf => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    }).catch(() => { res.writeHead(404); res.end('no file'); });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, () => console.log('mock server on http://127.0.0.1:' + PORT));
