// ============================================================
// VCS Block Redesign — Quiet List · script.js
// 场景数据 + 4 视图渲染 + 交互逻辑
// ============================================================
"use strict";

// ── 场景数据 ──
const SCENARIOS = {
  clean: {
    label: "Clean",
    desc: "No changes",
    repos: [makeGitRepo({
      name: "snorkeling", branch: "main", ahead: 0, behind: 0,
      files: [], untracked: []
    })],
  },
  dirty: {
    label: "Dirty",
    desc: "3 changed + 1 untracked",
    repos: [makeGitRepo({
      name: "snorkeling", branch: "main", ahead: 0, behind: 0,
      files: [
        { path: "frontend/app/view/vcs/vcs.tsx", code: "M" },
        { path: "frontend/app/view/vcs/vcsmeta.ts", code: "A" },
        { path: "pkg/wshrpc/wshremote/vcs.go", code: "M" },
      ],
      untracked: ["new-component.tsx"],
    })],
  },
  "behind-ahead": {
    label: "Behind/Ahead",
    desc: "behind 4 + ahead 1",
    repos: [makeGitRepo({
      name: "snorkeling", branch: "feature/vcs-redesign", ahead: 1, behind: 4,
      files: [
        { path: "frontend/app/view/vcs/vcs.tsx", code: "M" },
        { path: "frontend/app/view/vcs/vcsmeta.ts", code: "A" },
      ],
      untracked: [],
      incoming: [
        { hash: "a1b2c3d4", subject: "fix(commontext): guard detail-flush setState", author: "hamagesila", date: "07-22 23:51" },
        { hash: "e5f6a7b8", subject: "refactor(commontext): rework compose modal", author: "hamagesila", date: "07-21 14:30" },
        { hash: "c9d0e1f2", subject: "chore(deps): bump @anthropic-ai/sdk", author: "hamagesila", date: "07-20 09:15" },
        { hash: "3a4b5c6d", subject: "feat(widgets): quick-launch Cmd+Shift+p", author: "hamagesila", date: "07-19 16:42" },
      ],
      outgoing: [
        { hash: "7e8f9a0b", subject: "feat(vcs): Quiet List redesign", author: "hamagesila", date: "08-31 10:00" },
      ],
    })],
  },
  svn: {
    label: "SVN",
    desc: "SVN repo",
    repos: [makeSvnRepo({
      name: "vendor-assets",
      files: [
        { path: "assets/logo-dark.png", code: "M" },
        { path: "assets/icon.svg", code: "A" },
      ],
      untracked: [],
      remoteFiles: [
        { path: "remote-0.bin", code: "M" },
        { path: "remote-1.bin", code: "M" },
        { path: "remote-2.bin", code: "M" },
        { path: "remote-3.bin", code: "M" },
      ],
    })],
  },
  "multi-repo": {
    label: "Multi-repo",
    desc: "Git + SVN nested",
    repos: [
      makeGitRepo({
        name: "snorkeling", branch: "main", ahead: 0, behind: 0,
        files: [{ path: "frontend/app/view/vcs/vcs.tsx", code: "M" }],
        untracked: [],
      }),
      makeSvnRepo({
        name: "vendor-assets",
        files: [], untracked: ["notes.md"],
        remoteFiles: [{ path: "remote-0.bin", code: "M" }],
      }),
    ],
  },
  detached: {
    label: "Detached HEAD",
    desc: "detached@a3f7b2c1",
    repos: [makeGitRepo({
      name: "snorkeling", branch: "detached@a3f7b2c1", ahead: 0, behind: 0,
      files: [{ path: "frontend/app/view/vcs/vcs.tsx", code: "M" }],
      untracked: [],
      detached: true,
    })],
  },
};

// ── 提交数据（vcscommits / vcshistory 共用） ──
const SAMPLE_COMMITS = [
  { hash: "cad377d1", subject: "feat(agent-status): done-unread (D) layer", author: "hamagesila", date: "07-23 03:18", files: [
    { path: "frontend/app/block/atomack.ts", code: "M" },
    { path: "frontend/app/block/atomack.ts", code: "M" },
  ]},
  { hash: "fbe3c2d6", subject: "fix(commontext): guard detail-flush setState", author: "hamagesila", date: "07-22 23:51", files: [
    { path: "frontend/app/view/commontext/commontext-detail.tsx", code: "M" },
  ]},
  { hash: "4f2e5c46", subject: "refactor(commontext): rework compose modal", author: "hamagesila", date: "07-21 14:30", files: [
    { path: "frontend/app/view/commontext/commontext-compose.tsx", code: "M" },
    { path: "frontend/app/view/commontext/commontext-compose.scss", code: "M" },
  ]},
  { hash: "c9d0e1f2", subject: "chore(deps): bump @anthropic-ai/sdk to latest", author: "hamagesila", date: "07-20 09:15", files: [
    { path: "package.json", code: "M" },
    { path: "package-lock.json", code: "M" },
  ]},
  { hash: "3a4b5c6d", subject: "feat(widgets): quick-launch Cmd+Shift+p", author: "hamagesila", date: "07-19 16:42", files: [
    { path: "frontend/app/view/widgets/widget-quick-launch.tsx", code: "A" },
    { path: "frontend/app/block/keymodel.ts", code: "M" },
  ]},
  { hash: "7e8f9a0b", subject: "feat(vcs): Quiet List redesign proto", author: "hamagesila", date: "07-18 11:05", files: [
    { path: ".mockup/vcs-block-redesign/index.html", code: "A" },
  ]},
  { hash: "9c0d1e2f", subject: "fix(sessions): session-overview grid align", author: "hamagesila", date: "07-17 22:10", files: [
    { path: "frontend/app/view/sessions/session-overview.tsx", code: "M" },
  ]},
  { hash: "a1b2c3d4", subject: "chore: add vitest cache-test config", author: "hamagesila", date: "07-16 08:30", files: [
    { path: "vitest.cache-test.config.ts", code: "A" },
  ]},
];

const SAMPLE_BRANCHES = [
  { name: "main", current: true, ahead: 0, behind: 0, last: "cad377d1" },
  { name: "feature/vcs-redesign", current: false, ahead: 1, behind: 4, last: "7e8f9a0b" },
  { name: "fix/commontext-guard", current: false, ahead: 0, behind: 2, last: "fbe3c2d6" },
  { name: "origin/main", remote: true, last: "c9d0e1f2" },
];
const SAMPLE_STASHES = [
  { id: "stash@{0}", msg: "WIP: vcs filter tweaks", branch: "feature/vcs-redesign", time: "2h ago" },
  { id: "stash@{1}", msg: "temp: before rebase main", branch: "main", time: "1d ago" },
];
const SAMPLE_TAGS = ["v0.14.6", "v0.14.5", "v0.14.4", "v0.14.3"];
const GRAPH_TEXT = `* cad377d1 (HEAD -> main) feat(agent-status): done-unread
* fbe3c2d6 fix(commontext): guard detail-flush
| * 7e8f9a0b (feature/vcs-redesign) feat(vcs): Quiet List
| * 4f2e5c46 refactor(commontext): rework compose
|/
* c9d0e1f2 chore(deps): bump sdk
* 3a4b5c6d feat(widgets): quick-launch
* 9c0d1e2f fix(sessions): grid align`;
const SAMPLE_CONTRIB = [
  { name: "hamagesila", pct: 82 },
  { name: "ci-bot", pct: 10 },
  { name: "guest", pct: 8 },
];

const DIFF_TEXT = `@@ -220,7 +220,7 @@
 export function RepoHeader() {
   return (
-    <div className="bg-black/15">
+    <div className="bg-[var(--block-bg-color)]">
       <button className="flex min-w-0 flex-1 items-stretch gap-2 text-left cursor-pointer"
         onClick={onToggle}
       >
-        <span className="text-[11px] text-muted">C:{summary.changed} U:{summary.untracked} R:{remoteCount}</span>
+        <span className="tabular-nums text-[11px] text-muted">{summary.changed} changed</span>`;

// ── 工厂函数 ──
function makeGitRepo({ name, branch, ahead, behind, files, untracked, incoming, outgoing, detached }) {
  return {
    repotype: "git", name, branch, detached: !!detached,
    remote: { ahead, behind, incoming: incoming || [], outgoing: outgoing || [] },
    status: files.map(f => ({ ...f, staged: f.code !== "?", untracked: false })),
    untracked: (untracked || []).map(u => ({ path: u, code: "?", staged: false, untracked: true })),
  };
}
function makeSvnRepo({ name, files, untracked, remoteFiles }) {
  return {
    repotype: "svn", name, branch: "", detached: false,
    remote: { ahead: 0, behind: 0, incoming: [], outgoing: [], files: (remoteFiles || []).map(f => ({ ...f })) },
    status: files.map(f => ({ ...f, staged: true, untracked: false })),
    untracked: (untracked || []).map(u => ({ path: u, code: "?", staged: false, untracked: true })),
  };
}

// ── 工具函数 ──
function shortHash(h) { return (h || "").length > 10 ? h.slice(0, 10) : h; }
function codeLabel(c) { return c || "·"; }
function countChanged(repo) {
  return (repo.status || []).filter(s => !s.untracked).length;
}
function countUntracked(repo) {
  return repo.untracked ? repo.untracked.length : 0;
}

// ── 全局状态 ──
let currentScenario = "dirty";
let currentView = "dashboard";
let currentDashTab = "overview";
let expandedRepos = {};
let expandedCommits = {};
let selectedFiles = {};
let commitMsg = {};
let diffMode = "side-by-side";
let fileFilter = { search: "", type: "all", ext: "" };
let commitPage = 1;
let commitsPerPage = 50;

// ── DOM 引用 ──
const $scenarioBar = document.getElementById("scenario-bar");
const $viewTabs = document.getElementById("view-tabs");
const $viewPanels = document.getElementById("view-panels");
const $toast = document.getElementById("toast");

// ── 场景 chip ──
for (const [key, sc] of Object.entries(SCENARIOS)) {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = sc.label;
  chip.title = sc.desc;
  chip.dataset.key = key;
  chip.addEventListener("click", () => selectScenario(key));
  $scenarioBar.appendChild(chip);
}
$scenarioBar.querySelector(`[data-key="${currentScenario}"]`).classList.add("active");

// ── 视图 tab（Dashboard 聚合为默认）──
const VIEWS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "vcs", label: "Version Control" },
  { key: "vcscommits", label: "Repo Commits" },
  { key: "vcshistory", label: "File History" },
  { key: "vcsdiff", label: "File Diff" },
];
for (const v of VIEWS) {
  const tab = document.createElement("button");
  tab.className = "view-tab";
  tab.textContent = v.label;
  tab.dataset.view = v.key;
  tab.addEventListener("click", () => selectView(v.key));
  $viewTabs.appendChild(tab);
}
$viewTabs.querySelector(`[data-view="${currentView}"]`).classList.add("active");

// ── 选择场景 ──
function selectScenario(key) {
  currentScenario = key;
  currentDashTab = "overview";
  expandedRepos = {};
  expandedCommits = {};
  selectedFiles = {};
  commitMsg = {};
  fileFilter = { search: "", type: "all", ext: "" };
  commitPage = 1;
  $scenarioBar.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.key === key));
  const repo0 = SCENARIOS[key].repos[0];
  if (repo0) expandedRepos[repo0.name] = true;
  renderAll();
}

// ── 选择视图 ──
function selectView(view) {
  currentView = view;
  $viewTabs.querySelectorAll(".view-tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view-panel").forEach(p => p.classList.toggle("active", p.dataset.view === view));
}

// ── 主渲染 ──
function renderAll() {
  renderDashboard();
  renderVcs();
  renderVcscommits();
  renderVcshistory();
  renderVcsdiff();
}

// ============================================================
// §1 Dashboard 聚合（历史·变动·流水线）
// ============================================================
function renderDashboard() {
  const $panel = document.getElementById("view-dashboard");
  if (!$panel) return;
  const sc = SCENARIOS[currentScenario];
  const repo = sc.repos[0];
  const behind = repo ? (repo.remote.behind || 0) : 0;
  const ahead = repo ? (repo.remote.ahead || 0) : 0;
  const changed = repo ? countChanged(repo) : 0;
  const untracked = repo ? countUntracked(repo) : 0;
  const totalChanged = changed + untracked;
  const remoteFiles = (repo && repo.remote.files) ? repo.remote.files.length : 0;
  const commits = SAMPLE_COMMITS.slice(0, 5);
  // --- head ---
  let html = `
    <div class="section" style="overflow:visible">
      <div class="compare-bar" style="margin:10px 14px 0">
        <span style="font-size:11px;color:var(--text-muted)">对比</span>
        <select class="ctrl" onchange="toast('Compare: ' + this.value)">
          <option>main … feature/vcs-redesign</option>
          <option>main … fix/commontext-guard</option>
          <option>HEAD … HEAD~5</option>
        </select>
        <span class="vs">vs</span>
        <select class="ctrl" onchange="toast('Compare base: ' + this.value)">
          <option>origin/main</option><option>main</option>
        </select>
        <button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Open compare diff')">查看差异</button>
        <button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Create PR')">建 PR</button>
        <span style="margin-left:auto;display:inline-flex;gap:6px">
          <button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Merge')">Merge</button>
          <button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Rebase')">Rebase</button>
          <button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Cherry-pick')">Cherry-pick</button>
        </span>
      </div>
      <div class="dash-head">
        <span class="repo-name">${repo ? repo.name : "—"}</span>
        <span class="branch"><span class="dot"></span>${repo ? (repo.branch || "(no branch)") : "—"}</span>
        <span class="kpis">
          <span class="kpi ${totalChanged>0?"warn":"muted"}">${totalChanged} changed</span>
          ${repo && repo.repotype==="git" ? `<span class="kpi ${behind>0?"warn":"muted"}">↓ Behind ${behind}</span><span class="kpi ${ahead>0?"warn":"muted"}">↑ Ahead ${ahead}</span>` : `<span class="kpi ${remoteFiles>0?"warn":"muted"}">${remoteFiles} remote file(s)</span>`}
        </span>
        <span class="head-actions">
          <button class="btn-ghost" onclick="toast('Fetch completed.')">Fetch</button>
          <button class="btn-ghost" onclick="toast('Pull completed.')">Pull</button>
          <button class="btn-ghost" onclick="toast('Push completed.')">Push</button>
        </span>
      </div>
      ${renderDashSubTabs()}
      <div class="dash-grid">
        ${renderDashTabPanels(repo, commits, totalChanged, behind, ahead, remoteFiles)}
      </div>
    </div>`;
  $panel.innerHTML = html;
}

function renderDashChanges(repo) {
  if (!repo) return `<div class="pipe-empty">No repo</div>`;
  const all = [...(repo.status||[]), ...(repo.untracked||[])];
  if (all.length===0) return `<div class="pipe-empty">No changed files — working tree clean.</div>`;
  // 分组：Changes / Untracked
  let html = `<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Changes (${(repo.status||[]).length}) · Untracked (${(repo.untracked||[]).length})</div>`;
  html += `<div class="dash-filelist">`;
  for (const f of all) {
    html += `
      <div class="dash-file-row">
        <span style="color:var(--text-secondary);font-size:11px">○</span>
        <span class="code ${f.code}" style="font-family:var(--font-mono);font-size:11px;text-align:center">${codeLabel(f.code)}</span>
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.path}</span>
        <span style="display:inline-flex;gap:8px"><a href="#" style="color:var(--accent-600);text-decoration:none;font-size:11px" onclick="event.preventDefault();selectView('vcsdiff');toast('Diff: ${f.path}')">Diff</a><a href="#" style="color:var(--accent-600);text-decoration:none;font-size:11px" onclick="event.preventDefault();selectView('vcshistory')">History</a></span>
      </div>`;
  }
  html += `</div>`;
  return html;
}

function renderDashPipeline(repo) {
  if (!repo) return `<div class="pipe-empty">No repo</div>`;
  const behind = repo.remote.behind||0;
  const ahead = repo.remote.ahead||0;
  const incoming = repo.remote.incoming||[];
  const outgoing = repo.remote.outgoing||[];
  const isGit = repo.repotype==="git";
  // 模拟 CI 流水线（与 git 状态联动）
  const ciRuns = [
    { title: "CI · main", sub: "push · " + shortHash(SAMPLE_COMMITS[0].hash), time: "2m ago", state: "success", branch: repo.branch },
    { title: "CI · " + (repo.branch||"main"), sub: ahead>0 ? "ahead " + ahead + " · pending push" : "up to date", time: ahead>0?"pending":"38m ago", state: ahead>0?"queued":"success" },
    { title: "Lint & Test", sub: isGit?"git pull --ff-only":"svn update", time: behind>0?"needs pull":"—", state: behind>0?"running":"success" },
  ];
  let html = `<div class="pipeline">`;
  // 同步流
  html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">同步流 · ${isGit?"Git":"SVN"}</div>`;
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
    ${isGit ? `<span class="kpi ${behind>0?"warn":"muted"}" style="border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:11px">↓ Behind ${behind}</span><span class="kpi ${ahead>0?"warn":"muted"}" style="border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:11px">↑ Ahead ${ahead}</span>` : `<span class="kpi" style="border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:11px">${(repo.remote.files||[]).length} remote file(s)</span>`}
    <button class="btn-ghost" style="padding:2px 8px;font-size:11px" onclick="toast('Pull')">Pull</button>
    <button class="btn-ghost" style="padding:2px 8px;font-size:11px" onclick="toast('Push')">Push</button>
  </div>`;
  if (isGit && (incoming.length||outgoing.length)) {
    if (incoming.length) {
      html += `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Incoming (${incoming.length})</div>`;
      for (const c of incoming.slice(0,3)) html += `<div class="pipe-run" style="padding:6px 10px"><span class="pipe-dot queued"></span><div class="pipe-main"><div class="pipe-title">${c.subject}</div><div class="pipe-sub">${shortHash(c.hash)} · ${c.author}</div></div><span class="pipe-time">${c.date}</span></div>`;
    }
    if (outgoing.length) {
      html += `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Outgoing (${outgoing.length})</div>`;
      for (const c of outgoing.slice(0,2)) html += `<div class="pipe-run" style="padding:6px 10px"><span class="pipe-dot queued"></span><div class="pipe-main"><div class="pipe-title">${c.subject}</div><div class="pipe-sub">${shortHash(c.hash)} · ${c.author}</div></div><span class="pipe-time">${c.date}</span></div>`;
    }
  } else if (!isGit && (repo.remote.files||[]).length) {
    html += `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Remote files (${(repo.remote.files||[]).length})</div>`;
    for (const f of (repo.remote.files||[]).slice(0,3)) html += `<div class="pipe-run" style="padding:6px 10px"><span class="pipe-dot queued"></span><div class="pipe-main"><div class="pipe-title">${f.path}</div><div class="pipe-sub">remote</div></div></div>`;
  } else {
    html += `<div class="pipe-empty" style="margin-top:4px">No remote changes — ${isGit?"behind/ahead 均为 0":"No remote files"}.</div>`;
  }
  // CI 流水线
  html += `<div style="font-size:11px;color:var(--text-muted);margin-top:10px">CI 流水线 · 模拟</div>`;
  for (const r of ciRuns) {
    html += `<div class="pipe-run"><span class="pipe-dot ${r.state}"></span><div class="pipe-main"><div class="pipe-title">${r.title}</div><div class="pipe-sub">${r.sub}</div><div class="pipe-actions"><button class="btn-ghost" style="padding:1px 6px;font-size:11px" onclick="toast('View logs: ${r.title}')">Logs</button><button class="btn-ghost" style="padding:1px 6px;font-size:11px" onclick="toast('Rerun: ${r.title}')">Rerun</button></div></div><span class="pipe-time">${r.time}</span></div>`;
  }
  html += `</div>`;
  return html;
}
function renderDashStats(repo) {
  let html = `<div class="stats-grid">
    <div class="stat-card"><div class="slabel">Commits (30d)</div><div class="svalue">${SAMPLE_COMMITS.length * 3}</div></div>
    <div class="stat-card"><div class="slabel">Changed files</div><div class="svalue">${repo ? (countChanged(repo)+countUntracked(repo)) : 0}</div></div>
  </div>`;
  html += `<div class="contrib">`;
  for (const c of SAMPLE_CONTRIB) html += `<div class="contrib-row"><span class="cname">${c.name}</span><span class="cbar"><i style="width:${c.pct}%"></i></span><span style="text-align:right;color:var(--text-muted)">${c.pct}%</span></div>`;
  html += `</div>`;
  html += `<div class="heatmap">`;
  const lv = [0,1,2,0,3,1,0, 1,0,2,4,1,0,2, 0,1,1,2,0,3,0];
  for (const v of lv) html += `<span class="hcell ${v?'l'+v:''}"></span>`;
  html += `</div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">近 21 天提交热力</div>`;
  return html;
}
function renderDashFileOps(repo) {
  const all = repo ? [...(repo.status||[]), ...(repo.untracked||[])] : [];
  if (!all.length) return `<div class="pipe-empty">No changed files.</div><div style="margin-top:8px;display:flex;gap:6px"><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Blame')">Blame</button><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="selectView('vcshistory')">History</button><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('add -p')">行级暂存</button></div>`;
  let html = `<div class="dash-filelist">`;
  for (const f of all.slice(0,4)) html += `<div class="dash-file-row"><span style="color:var(--text-secondary);font-size:11px">○</span><span class="code ${f.code}" style="font-family:var(--font-mono);font-size:11px;text-align:center">${codeLabel(f.code)}</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.path}</span><span style="display:inline-flex;gap:8px"><a href="#" style="color:var(--accent-600);text-decoration:none;font-size:11px" onclick="event.preventDefault();toast('Blame: ${f.path}')">Blame</a><a href="#" style="color:var(--accent-600);text-decoration:none;font-size:11px" onclick="event.preventDefault();selectView('vcshistory')">History</a></span></div>`;
  html += `</div>`;
  html += `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Blame')">Blame</button><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('add -p')">行级暂存</button><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="selectView('vcsdiff')">Diff</button></div>`;
  return html;
}

// ============================================================
// §2 VCS 视图（主看板）
// ============================================================
function renderVcs() {
  const $panel = document.getElementById("view-vcs");
  const sc = SCENARIOS[currentScenario];
  const repos = sc.repos;

  let html = "";
  for (const repo of repos) {
    const isOpen = !!expandedRepos[repo.name];
    const changed = countChanged(repo);
    const untracked = countUntracked(repo);
    const total = changed + untracked;
    const behind = repo.remote.behind || 0;
    const ahead = repo.remote.ahead || 0;
    const flow = (behind > 0 || ahead > 0)
      ? `<span class="down">${behind > 0 ? "↓" + behind : ""}</span> ${ahead > 0 ? "<span class='up'>↑" + ahead + "</span>" : ""}`
      : "";
    const isDetached = repo.detached;
    const badge = repo.repotype === "git" ? "GIT" : "SVN";

    html += `
      <div class="section" style="margin-bottom:12px">
        <div class="section-head" style="padding:10px 14px">
          <div class="h" style="flex:1;min-width:0">
            <span style="font-size:11px;color:var(--text-muted);width:12px">${isOpen ? "▾" : "▸"}</span>
            <span style="border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:11px;text-transform:uppercase;color:var(--text-secondary)">${badge}</span>
            <span class="name">${repo.name}</span>
            <span class="crumb">${repo.branch || "(no branch)"}</span>
            ${flow ? `<span class="flow">${flow}</span>` : ""}
          </div>
          <div class="actions">
            <button class="btn-ghost" onclick="toast('Pull completed.')">Pull</button>
            <button class="btn-ghost" onclick="toast('Push completed.')">Push</button>
            <button class="btn-text" title="Open Commits" onclick="selectView('vcscommits')">☷</button>
          </div>
        </div>`;

    if (isOpen) {
      html += `
        <div class="filter-bar">
          <input class="ctrl" placeholder="Search files" value="${fileFilter.search}" oninput="fileFilter.search=this.value;renderVcs()" />
          <input class="ctrl ext-ctrl" placeholder="Ext .tsx" value="${fileFilter.ext}" oninput="fileFilter.ext=this.value;renderVcs()" />
          <select class="ctrl type-ctrl" onchange="fileFilter.type=this.value;renderVcs()">
            <option value="all">All</option>
            <option value="modified" ${fileFilter.type==="modified"?"selected":""}>Modified</option>
            <option value="added" ${fileFilter.type==="added"?"selected":""}>Added</option>
            <option value="deleted" ${fileFilter.type==="deleted"?"selected":""}>Deleted</option>
            <option value="untracked" ${fileFilter.type==="untracked"?"selected":""}>Untracked</option>
            <option value="staged" ${fileFilter.type==="staged"?"selected":""}>Staged</option>
          </select>
          <span class="count">${total} files</span>
        </div>
        <div class="section-body">`;

      // Changes
      html += renderCollapseHead("Changes", changed, true, repo.name, "changes");
      if (repo.status && repo.status.length > 0) {
        html += `<div class="file-card">`;
        for (const f of repo.status) {
          html += renderFileRow(f, repo.name);
        }
        html += `</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No changed files.</div>`;
      }

      // Untracked
      html += renderCollapseHead("Untracked", untracked, true, repo.name, "untracked");
      if (repo.untracked && repo.untracked.length > 0) {
        html += `<div class="file-card">`;
        for (const f of repo.untracked) {
          html += renderFileRow(f, repo.name);
        }
        html += `</div>`;
      } else {
        html += `<div style="font-size:12px;color:var(--text-muted);padding:4px 0">No untracked files.</div>`;
      }

      // Remote
      const remoteCount = behind + ahead + (repo.remote.files || []).length;
      html += renderCollapseHead("Remote", remoteCount, true, repo.name, "remote");
      html += renderRemoteSection(repo);

      html += `</div>`; // section-body
    }

    if (total > 0) {
      const n = selectedFiles[repo.name] ? selectedFiles[repo.name].length : 0;
      html += `
        <div class="section-foot">
          <input class="ctrl" style="flex:1" placeholder="chore: update selected files" value="${commitMsg[repo.name] || ""}" oninput="commitMsg['${repo.name}']=this.value" />
          <button class="btn-primary" onclick="toast('Commit ${n} file(s).')">Commit · ${n}</button>
        </div>`;
    }

    html += `</div>`; // section
  }

  if (repos.length === 0) {
    html = `<div class="empty">No Git/SVN repository found in this path.</div>`;
  }

  $panel.innerHTML = html;
}

function renderFileRow(f, repoName) {
  const key = repoName + ":" + f.path;
  const checked = selectedFiles[repoName] && selectedFiles[repoName].includes(f.path);
  return `
    <div class="file-row">
      <span class="sel">${checked ? "✓" : "○"}</span>
      <span class="code ${f.code}">${codeLabel(f.code)}</span>
      <span class="path">${f.path}</span>
      <span class="ops">
        <a href="#" onclick="event.preventDefault();toast('Opening diff for ${f.path}')">Diff</a>
        <a href="#" onclick="event.preventDefault();selectView('vcshistory')">History</a>
      </span>
    </div>`;
}

function renderCollapseHead(title, count, isOpen, repoName, section) {
  const cnt = typeof count === "number" ? count : "";
  return `
    <div class="collapse-head">
      <button onclick="expandedRepos['${repoName}']=true;renderVcs()">
        <span class="caret">${isOpen ? "▾" : "▸"}</span>
        <span>${title} <span class="count">${cnt ? "(" + cnt + ")" : ""}</span></span>
      </button>
      <span class="ops">
        <button class="btn-text" onclick="toast('Select All')">Select All</button>
        <button class="btn-text" style="color:var(--text-secondary)" onclick="toast('Select None')">Select None</button>
      </span>
    </div>`;
}

function renderRemoteSection(repo) {
  if (repo.repotype === "svn") {
    const files = repo.remote.files || [];
    return `
      <div style="margin-top:4px">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)">
          <span style="color:var(--text-muted)">Upstream</span>
          <span style="font-family:var(--font-mono)">${repo.remote.upstream || "Not configured"}</span>
          ${files.length > 0 ? `<span style="border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:11px;color:var(--warning)">${files.length} remote file(s)</span>` : `<span style="font-size:11px;color:var(--text-muted)">No remote changes</span>`}
        </div>
      </div>`;
  }
  const behind = repo.remote.behind || 0;
  const ahead = repo.remote.ahead || 0;
  const incoming = repo.remote.incoming || [];
  const outgoing = repo.remote.outgoing || [];
  return `
    <div style="margin-top:4px">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary)">
        <span style="color:var(--text-muted)">Upstream</span>
        <span style="font-family:var(--font-mono)">${repo.remote.upstream || "origin/" + (repo.branch || "main")}</span>
        ${behind > 0 || ahead > 0 ? `<span class="flow" style="font-size:12px"><span class="down">${behind > 0 ? "↓ Behind " + behind : ""}</span> ${ahead > 0 ? "<span class='up'>↑ Ahead " + ahead + "</span>" : ""}</span>` : ""}
      </div>
      ${incoming.length > 0 ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted);margin-bottom:2px">Incoming (${incoming.length})</div>` : ""}
      ${incoming.map(c => `
        <div class="commit-row" style="border-top:none;padding:4px 0">
          <span></span>
          <span class="hash">${shortHash(c.hash)}</span>
          <span class="subj">${c.subject}</span>
          <span class="by">${c.author}</span>
          <span class="when">${c.date}</span>
        </div>`).join("")}
      ${outgoing.length > 0 ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted);margin-bottom:2px">Outgoing (${outgoing.length})</div>` : ""}
      ${outgoing.map(c => `
        <div class="commit-row" style="border-top:none;padding:4px 0">
          <span></span>
          <span class="hash">${shortHash(c.hash)}</span>
          <span class="subj">${c.subject}</span>
          <span class="by">${c.author}</span>
          <span class="when">${c.date}</span>
        </div>`).join("")}
      ${incoming.length === 0 && outgoing.length === 0 ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">No remote changes.</div>` : ""}
    </div>`;
}

// ============================================================
// §3 VCSCommits 视图
// ============================================================
function renderVcscommits() {
  const $panel = document.getElementById("view-vcscommits");
  let html = `
    <div class="section">
      <div class="section-head">
        <div class="h">
          <span class="eyebrow">repo commits · git</span>
          <span class="name">Commits</span>
          <span class="crumb">page ${commitPage}</span>
        </div>
        <div class="actions">
          <input class="ctrl" style="width:180px" placeholder="keyword..." />
          <button class="btn-primary" style="padding:4px 10px" onclick="toast('Filters applied')">Apply</button>
        </div>
      </div>
      <div class="section-body">`;

  const commits = SAMPLE_COMMITS;
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const rev = c.hash;
    const isOpen = !!expandedCommits[rev];
    const files = c.files || [];
    html += `
      <div class="commit-row" onclick="expandedCommits['${rev}']=!expandedCommits['${rev}'];renderVcscommits()" style="cursor:pointer">
        <span class="caret">${isOpen ? "▾" : "▸"}</span>
        <span class="hash">${shortHash(rev)}</span>
        <span class="subj">${c.subject}</span>
        <span class="by">${c.author}</span>
        <span class="when">${c.date}</span>
      </div>`;
    if (isOpen && files.length > 0) {
      html += `<div class="files-list" style="margin-left:30px">`;
      for (const f of files) {
        html += `
          <div class="f">
            <span class="code ${f.code}">${codeLabel(f.code)}</span>
            <span>${f.path}</span>
            <a href="#" onclick="event.preventDefault();selectView('vcsdiff');toast('Opening diff: ${f.path}')">Diff</a>
          </div>`;
      }
      html += `</div>`;
    }
  }

  html += `
        <div class="pager">
          <button class="btn-ghost" disabled>‹ Prev</button>
          <span class="info">page ${commitPage}</span>
          <button class="btn-ghost" onclick="toast('Next page')">Next ›</button>
        </div>
      </div>
    </div>`;
  $panel.innerHTML = html;
}

const DASH_TABS = [
  { key: "overview", label: "总览",   desc: "流水线 · 统计" },
  { key: "workspace", label: "工作区", desc: "变动 · 文件级" },
  { key: "history",  label: "历史",   desc: "提交 · 图谱" },
  { key: "branches", label: "分支",   desc: "分支 · 贮藏" },
];
function renderDashSubTabs() {
  return `<div class="dash-subtabs">${DASH_TABS.map(t=>`
    <button class="dash-subtab ${t.key===currentDashTab?'active':''}" onclick="currentDashTab='${t.key}';renderDashboard()">
      ${t.label} <span class="badge">${t.desc}</span>
    </button>`).join('')}</div>`;
}
function renderDashTabPanels(repo, commits, totalChanged, behind, ahead, remoteFiles) {
  if (currentDashTab === "overview") {
    // 总览：流水线 + 统计
    return `
        <div class="dash-col dash-col--pipeline">
          <div class="dash-col-head"><span class="title">流水线</span><span class="count">· 同步 · CI</span><button class="more" onclick="selectView('vcs')">→ 详情</button></div>
          <div class="dash-col-body">${renderDashPipeline(repo)}</div>
        </div>
        <div class="dash-col dash-col--stats">
          <div class="dash-col-head"><span class="title">统计</span><span class="count">· 贡献 · 热力</span><button class="more" onclick="toast('Stats → vcscommits')">→ 详情</button></div>
          <div class="dash-col-body">${renderDashStats(repo)}</div>
        </div>`;
  }
  if (currentDashTab === "workspace") {
    // 工作区：变动 + 文件级
    return `
        <div class="dash-col dash-col--changes">
          <div class="dash-col-head"><span class="title">变动</span><span class="count">· ${totalChanged} files</span><button class="more" onclick="selectView('vcs')">→ 详情</button></div>
          <div class="dash-col-body">${renderDashChanges(repo)}</div>
          <div class="dash-col-foot"><input class="ctrl" placeholder="chore: update selected files" value="${repo ? (commitMsg[repo.name]||"") : ""}" oninput="if('${repo?repo.name:""}') commitMsg['${repo?repo.name:""}']=this.value" /><button class="btn-primary" onclick="toast('Commit · ' + (${totalChanged}||0) + ' files')">Commit</button></div>
        </div>
        <div class="dash-col dash-col--fileops">
          <div class="dash-col-head"><span class="title">文件级</span><span class="count">· Blame · History</span><button class="more" onclick="selectView('vcshistory')">→ 详情</button></div>
          <div class="dash-col-body">${renderDashFileOps(repo)}</div>
        </div>`;
  }
  if (currentDashTab === "history") {
    // 历史：时间线 + 图谱
    return `
        <div class="dash-col dash-col--history">
          <div class="dash-col-head"><span class="title">历史</span><span class="count">· 最近 ${commits.length}</span><button class="more" onclick="selectView('vcscommits')">→ 详情</button></div>
          <div class="dash-col-body"><div class="timeline">${commits.map(c=>{const rev=c.hash;const open=!!expandedCommits[rev];return `<div class="tl-item" onclick="expandedCommits['${rev}']=!expandedCommits['${rev}'];renderDashboard()" style="cursor:pointer"><span class="tl-dot"></span><div class="tl-main"><div style="display:flex;gap:8px;align-items:baseline"><span class="hash mono" style="font-size:11px;color:var(--text-secondary);font-variant-numeric:tabular-nums">${shortHash(rev)}</span><span class="tl-subject">${c.subject}</span></div><div class="tl-meta"><span>${c.author}</span><span>${c.date}</span></div>${open?`<div class="tl-files">${(c.files||[]).map(f=>`<div class="f"><span class="code ${f.code}">${codeLabel(f.code)}</span><span>${f.path}</span><a href="#" onclick="event.preventDefault();event.stopPropagation();selectView('vcsdiff');toast('Opening diff: ${f.path}')">Diff</a></div>`).join("")}</div>`:""}</div></div>`}).join("")}</div></div>
        </div>
        <div class="dash-col dash-col--graph">
          <div class="dash-col-head"><span class="title">图谱</span><span class="count">· --graph --all</span><button class="more" onclick="selectView('vcscommits')">→ 详情</button></div>
          <div class="dash-col-body"><div class="graph-wrap"><pre class="graph-canvas">${GRAPH_TEXT}</pre><div class="graph-legend"><span><i class="ldot" style="background:var(--accent-600)"></i> branch</span><span><i class="ldot" style="background:var(--success)"></i> HEAD</span><span><i class="ldot" style="background:var(--warning)"></i> merge</span></div></div></div>
        </div>`;
  }
  // branches
  return `
        <div class="dash-col dash-col--branches">
          <div class="dash-col-head"><span class="title">分支</span><span class="count">· ${SAMPLE_BRANCHES.length}</span><button class="more" onclick="toast('Branch → vcs')">→ 详情</button></div>
          <div class="dash-col-body"><div class="branch-list">${SAMPLE_BRANCHES.map(b=>`<div class="branch-row ${b.current?'is-current':''}"><span class="bstar">${b.current?'●':'○'}</span><span class="bname ${b.current?'is-current':''}" title="${b.name}">${b.name}${b.remote?' (remote)':''}</span><span class="bmeta">${shortHash(b.last||'')}</span><span class="barrow ${b.ahead>0?'ahead':''} ${b.behind>0?'behind':''}">${b.ahead!=null? (b.ahead>0?`↑${b.ahead}`:'') : ''} ${b.behind!=null && b.behind>0?`↓${b.behind}`:''}</span></div>`).join('')}</div><div style="margin-top:8px;display:flex;gap:6px"><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Create branch')">新建分支</button><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('Checkout')">切换</button></div></div>
        </div>
        <div class="dash-col dash-col--stash">
          <div class="dash-col-head"><span class="title">贮藏 · 标签</span><span class="count">· ${SAMPLE_STASHES.length} stash · ${SAMPLE_TAGS.length} tags</span><button class="more" onclick="toast('Stash/Tag → vcs')">→ 详情</button></div>
          <div class="dash-col-body"><div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Stash</div><div class="stash-list">${SAMPLE_STASHES.length? SAMPLE_STASHES.map(s=>`<div class="stash-row"><span class="smsg">${s.msg}</span><span class="smeta">${s.branch} · ${s.time}</span></div>`).join('') : '<div class="pipe-empty">No stashes.</div>'}</div><div style="margin-top:8px;display:flex;gap:6px"><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('git stash push')">Stash push</button><button class="btn-ghost" style="padding:3px 8px;font-size:11px" onclick="toast('git stash pop')">Pop</button></div><div style="font-size:11px;color:var(--text-muted);margin:10px 0 4px">Tags</div><div class="tag-list">${SAMPLE_TAGS.map(t=>`<span class="tag-pill"><span class="tdot"></span><span class="tname">${t}</span></span>`).join('')}</div></div>
        </div>`;
}

// ============================================================
// §4 VCSHistory 视图
// ============================================================
function renderVcshistory() {
  const $panel = document.getElementById("view-vcshistory");
  const commits = SAMPLE_COMMITS.slice(0, 5);
  let html = `
    <div class="section">
      <div class="section-head">
        <div class="h">
          <span class="eyebrow">file history · git</span>
          <span class="name">vcs.tsx</span>
          <span class="crumb">last ${commits.length} commits</span>
        </div>
      </div>
      <div class="section-body">`;

  for (const c of commits) {
    const rev = c.hash;
    const isOpen = !!expandedCommits[rev];
    html += `
      <div class="commit-row" onclick="expandedCommits['${rev}']=!expandedCommits['${rev}'];renderVcshistory()" style="cursor:pointer">
        <span class="caret">${isOpen ? "▾" : "▸"}</span>
        <span class="hash">${shortHash(rev)}</span>
        <span class="subj">${c.subject}</span>
        <span class="by">${c.author}</span>
        <span class="when">${c.date}</span>
      </div>`;
    if (isOpen) {
      html += `
        <div class="files-list" style="margin-left:30px">
          <div class="f">
            <span class="code M">M</span>
            <span>frontend/app/view/vcs/vcs.tsx</span>
            <a href="#" onclick="event.preventDefault();selectView('vcsdiff')">Diff</a>
          </div>
        </div>`;
    }
  }

  html += `
      </div>
    </div>`;
  $panel.innerHTML = html;
}

// ============================================================
// §5 VCSDiff 视图
// ============================================================
function renderVcsdiff() {
  const $panel = document.getElementById("view-vcsdiff");
  const lines = DIFF_TEXT.split("\n");
  let diffHtml = "";
  for (const line of lines) {
    if (line.startsWith("@@")) {
      diffHtml += `<span class="hunk">${escHtml(line)}</span>\n`;
    } else if (line.startsWith("-")) {
      diffHtml += `<span class="del">${escHtml(line)}</span>\n`;
    } else if (line.startsWith("+")) {
      diffHtml += `<span class="add">${escHtml(line)}</span>\n`;
    } else {
      diffHtml += escHtml(line) + "\n";
    }
  }

  let html = `
    <div class="section">
      <div class="section-head">
        <div class="h">
          <span class="eyebrow">file diff · git</span>
          <span class="name">vcs.tsx</span>
          <span class="crumb">@ cad377d1</span>
        </div>
        <div class="actions">
          <div class="mode-bar">
            <span class="lbl">view</span>
            <button class="${diffMode==="side-by-side"?"on":""}" onclick="diffMode='side-by-side';renderVcsdiff()">Side by side</button>
            <button class="${diffMode==="inline"?"on":""}" onclick="diffMode='inline';renderVcsdiff()">Inline</button>
          </div>
        </div>
      </div>
      <div class="section-body">
        <pre class="diff-area">${diffHtml}</pre>
      </div>
    </div>`;

  $panel.innerHTML = html;
}

// ── 工具 ──
function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

let toastTimer = null;
function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 2200);
}

// ── 初始渲染 ──
const repo0 = SCENARIOS[currentScenario].repos[0];
if (repo0) expandedRepos[repo0.name] = true;
renderAll();
