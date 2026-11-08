import os
p = r'E:/code/snorkeling/design/prototypes/overview-kanban/prototype-a-views.html'
html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>原型 A+ · 多视图</title>
<style>
:root{--bg:#0f1014;--col:#16181f;--card:#1d2029;--border:#2a2e3a;--text:#e6e6e6;--subtext:#9b9da6;--accent:#6aa6ff;--ok:#3fb950;--warn:#d29922;--err:#f85149}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:var(--bg);color:var(--text)}
header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid var(--border)}
.left{display:flex;align-items:center;gap:14px}h1{margin:0;font-size:14px}
.view-tabs{display:flex;gap:6px;background:rgba(255,255,255,0.01);border:1px solid var(--border);border-radius:999px;padding:3px}
.view-tab{border:0;background:transparent;color:var(--subtext);font-size:11px;border-radius:999px;padding:4px 10px;cursor:pointer}
.view-tab.active{background:rgba(106,166,255,0.18);color:var(--text)}
.pill-row{display:flex;gap:8px}.pill{border:1px solid var(--border);border-radius:999px;padding:4px 10px;font-size:11px;color:var(--subtext);text-decoration:none}
.view{display:none;height:calc(100vh - 56px);overflow:hidden}.view.active{display:block}
.board,.status-grid{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(320px,360px);gap:14px;overflow-x:auto;overflow-y:hidden;padding:18px 20px;height:100%;align-items:start}
.column{background:var(--col);border:1px solid var(--border);border-radius:10px;display:flex;flex-direction:column;max-height:calc(100% - 4px)}
.column-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border)}
.column-title{display:flex;align-items:center;gap:8px}.dot{width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 6px rgba(106,166,255,0.08)}.column-title span{font-size:13px}
.count{color:var(--subtext);font-size:12px}
.column-body{display:flex;flex-direction:column;gap:10px;padding:12px;overflow-y:auto;overflow-x:hidden}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;display:flex;flex-direction:column;gap:10px;padding:12px 14px}
.card:hover{border-color:rgba(106,166,255,0.7)}
.card-top{display:flex;align-items:center;justify-content:space-between}
.card-id{display:flex;align-items:center;gap:8px}
.icon{width:18px;height:18px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 30%,rgba(106,166,255,0.9),rgba(106,166,255,0.4));font-size:10px}
.icon.green{background:radial-gradient(circle at 30% 30%,rgba(63,185,80,0.9),rgba(63,185,80,0.4))}
.icon.orange{background:radial-gradient(circle at 30% 30%,rgba(210,153,34,0.9),rgba(210,153,34,0.4))}
.title{font-size:13px}
.status{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 8px;font-size:11px;border:1px solid rgba(106,166,255,0.5);color:var(--accent)}
.status.ok{border-color:rgba(63,185,80,0.6);color:var(--ok)}.status.warn{border-color:rgba(210,153,34,0.6);color:var(--warn)}.status.idle{border-color:var(--border);color:var(--subtext)}
.pulse{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px rgba(106,166,255,0.12)}
.meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--subtext);font-size:11px}
.preview{font-size:12px;color:var(--subtext);line-height:1.7;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.note{border-top:1px solid var(--border);padding-top:8px;display:flex;gap:8px;color:var(--subtext);font-size:11px}
.list{display:flex;flex-direction:column;gap:6px;padding:18px 20px;max-width:1100px;margin:0 auto;height:100%;overflow-y:auto}
.row{display:grid;grid-template-columns:220px 1fr 120px 90px;gap:16px;align-items:center;padding:10px 14px;background:var(--card);border:1px solid var(--border);border-radius:10px}
.row:hover{border-color:rgba(106,166,255,0.7)}
.row-left{display:flex;align-items:center;gap:8px}.row-title{font-size:13px}.row-sub{color:var(--subtext);font-size:11px}
.row-preview{color:var(--subtext);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row-right{display:flex;align-items:center;justify-content:flex-end;gap:10px;color:var(--subtext);font-size:11px}
.provider{padding:18px 20px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;height:100%}
.provider-group{display:flex;flex-direction:column;gap:10px}
.provider-header{display:flex;align-items:center;justify-content:space-between;padding:0 4px}
.provider-title{display:flex;align-items:center;gap:8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}
</style>
</head>
<body>
<header>
  <div class="left"><h1>Overview · 原型 A+</h1><div class="view-tabs"><button class="view-tab active" data-view="board">Board by Tab</button><button class="view-tab" data-view="status">Board by Status</button><button class="view-tab" data-view="list">Compact List</button><button class="view-tab" data-view="provider">Group by Provider</button></div></div>
  <div class="pill-row"><span class="pill">Agents only</span><span class="pill">Opened Tabs</span><a class="pill" href="./index.html">返回对比页</a></div>
</header>
<section class="view active" id="view-board"><div class="board"><section class="column"><header class="column-header"><div class="column-title"><span class="dot"></span><span>main</span></div><span class="count">3</span></header><div class="column-body"><article class="card"><div class="card-top"><div class="card-id"><span class="icon">C</span><span class="title">Claude · refactor-auth</span></div><div class="status"><span class="pulse"></span>Running</div></div><div class="meta"><span>Tab: main</span><span>·</span><span>Updated 2m ago</span></div><div class="preview">正在梳理 auth 中间件的依赖链，计划先拆分 session 校验逻辑并补充单元测试...</div><div class="note"><span>✎</span><span>先跑类型检查再改动存储层</span></div></article><article class="card"><div class="card-top"><div class="card-id"><span class="icon green">X</span><span class="title">Codex · fix-preview</span></div><div class="status ok"><span class="pulse"></span>Done</div></div><div class="meta"><span>Tab: main</span><span>·</span><span>Updated 18m ago</span></div><div class="preview">已修复预览编辑的软换行丢失问题，新增机器可判定验证台用例并通过本地校验。</div></article><article class="card"><div class="card-top"><div class="card-id"><span class="icon">G</span><span class="title">Gemini · docs-sync</span></div><div class="status idle">Idle</div></div><div class="meta"><span>Tab: main</span><span>·</span><span>Updated 1h ago</span></div><div class="preview">待处理：根据最新 spec 同步 Trellis 文档索引。</div></article></div></section><section class="column"><header class="column-header"><div class="column-title"><span class="dot" style="background:var(--warn);box-shadow:0 0 0 6px rgba(210,153,34,0.1);"></span><span>feature/overview</span></div><span class="count">2</span></header><div class="column-body"><article class="card"><div class="card-top"><div class="card-id"><span class="icon orange">C</span><span class="title">Claude · overview-kanban</span></div><div class="status warn"><span class="pulse"></span>Waiting for input</div></div><div class="meta"><span>Tab: feature/overview</span><span>·</span><span>Updated 5m ago</span></div><div class="preview">需要确认：要用哪套原型落地？A/B/C/D 选定后再继续细化实现细节。</div><div class="note"><span>✎</span><span>优先参考 Linear 的卡片信息密度</span></div></article><article class="card"><div class="card-top"><div class="card-id"><span class="icon">X</span><span class="title">Codex · css-polish</span></div><div class="status"><span class="pulse"></span>Running</div></div><div class="meta"><span>Tab: feature/overview</span><span>·</span><span>Updated 9m ago</span></div><div class="preview">正在调整列间距、卡片圆角与 hover 边框，尽量贴近现有设计变量。</div></article></div></section><section class="column"><header class="column-header"><div class="c
