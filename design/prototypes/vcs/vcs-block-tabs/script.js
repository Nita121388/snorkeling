// ============================================================
// VCS Block — 三 Tab 下拉面板 · script.js
// 场景数据 + 三 Tab 渲染 + 交互逻辑
// ============================================================
"use strict";

// ── 场景数据 ──
const SCENARIOS = {
  clean: {
    label: "Clean",
    desc: "No changes",
    repos: [makeGitRepo({
      name: "snorkeling", branch: "main", ahead: 0, behind: 0,
      files: [], untracked: [],
      incoming: [], outgoing: [],
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
      incoming: [], outgoing: [],
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
        { hash: "a1b2c3d4", subject: "fix(commontext): guard detail-flush setState", author: "hamagesila", date: "09-03 23:51",
          files: [{ path: "frontend/app/view/commontext/commontext-detail.tsx", code: "M" }] },
        { hash: "e5f6a7b8", subject: "refactor(commontext): rework compose modal", author: "hamagesila", date: "09-02 14:30",
          files: [{ path: "frontend/app/view/commontext/commontext-compose.tsx", code: "M" }, { path: "frontend/app/view/commontext/commontext-compose.scss", code: "M" }] },
        { hash: "c9d0e1f2", subject: "chore(deps): bump @anthropic-ai/sdk to latest", author: "hamagesila", date: "09-01 09:15",
          files: [{ path: "package.json", code: "M" }, { path: "package-lock.json", code: "M" }] },
        { hash: "3a4b5c6d", subject: "feat(widgets): quick-launch Cmd+Shift+p", author: "hamagesila", date: "08-31 16:42",
          files: [{ path: "frontend/app/view/widgets/widget-quick-launch.tsx", code: "A" }] },
      ],
      outgoing: [
        { hash: "7e8f9a0b", subject: "feat(vcs): Quiet List redesign prototype", author: "hamagesila", date: "09-04 10:00",
          files: [{ path: ".mockup/vcs-block-redesign/index.html", code: "A" }, { path: ".mockup/vcs-block-redesign/style.css", code: "A" }] },
      ],
    })],
  },
  svn: {
    label: "SVN",
    desc: "SVN repo — no branches tab",
    repos: [makeSvnRepo({
      name: "vendor-assets",
      files: [
        { path: "assets/logo-dark.png", code: "M" },
        { path: "assets/icon.svg", code: "A" },
      ],
      untracked: [],
      remoteFiles: [
        { path: "remote/logo-print.png", code: "M" },
        { path: "remote/banner-dark.svg", code: "M" },
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
        incoming: [], outgoing: [],
      }),
      makeSvnRepo({
        name: "vendor-assets",
        files: [], untracked: ["notes.md"],
        remoteFiles: [{ path: "remote/asset.bin", code: "M" }],
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
      incoming: [], outgoing: [],
    })],
  },
};

// ── 分支数据 ──
const SAMPLE_BRANCHES = {
  local: [
    { name: "main", hash: "cad377d1", ahead: 0, behind: 0, isCurrent: true },
    { name: "feature/vcs-redesign", hash: "7e8f9a0b", ahead: 1, behind: 4, isCurrent: false },
    { name: "fix/commontext-guard", hash: "fbe3c2d6", ahead: 0, behind: 2, isCurrent: false },
  ],
  remote: [
    { name: "origin/main", hash: "c9d0e1f2", ahead: 0, behind: 0 },
    { name: "origin/feature/vcs-redesign", hash: "4f2e5c46", ahead: 0, behind: 0 },
    { name: "origin/fix/commontext-guard", hash: "a1b2c3d4", ahead: 0, behind: 0 },
  ],
};

// ── 流水线数据 ──
const SAMPLE_PIPELINES = [
  {
    id: "run-201",
    title: "CI: build + test",
    branch: "feature/vcs-redesign",
    status: "success",
    commit: "7e8f9a0b",
    author: "hamagesila",
    startedAt: "2026-09-03T10:15:00Z",
    endedAt: "2026-09-03T10:18:42Z",
    jobs: [
      { name: "lint", status: "success", duration: "28s" },
      { name: "typecheck", status: "success", duration: "45s" },
      { name: "test", status: "success", duration: "1m 32s" },
      { name: "build", status: "success", duration: "58s" },
    ],
  },
  {
    id: "run-200",
    title: "CI: build + test",
    branch: "feature/vcs-redesign",
    status: "failed",
    commit: "4f2e5c46",
    author: "hamagesila",
    startedAt: "2026-09-02T16:30:00Z",
    endedAt: "2026-09-02T16:33:15Z",
    jobs: [
      { name: "lint", status: "success", duration: "26s" },
      { name: "typecheck", status: "failed", duration: "42s" },
      { name: "test", status: "cancelled", duration: "—" },
      { name: "build", status: "cancelled", duration: "—" },
    ],
  },
  {
    id: "run-199",
    title: "CI: build + test",
    branch: "main",
    status: "success",
    commit: "cad377d1",
    author: "hamagesila",
    startedAt: "2026-09-01T09:00:00Z",
    endedAt: "2026-09-01T09:04:10Z",
    jobs: [
      { name: "lint", status: "success", duration: "30s" },
      { name: "typecheck", status: "success", duration: "48s" },
      { name: "test", status: "success", duration: "1m 45s" },
      { name: "build", status: "success", duration: "52s" },
    ],
  },
  {
    id: "run-198",
    title: "CI: build + test",
    branch: "main",
    status: "running",
    commit: "c9d0e1f2",
    author: "ci-bot",
    startedAt: "2026-09-04T08:00:00Z",
    endedAt: null,
    jobs: [
      { name: "lint", status: "success", duration: "27s" },
      { name: "typecheck", status: "running", duration: "…" },
      { name: "test", status: "queued", duration: "—" },
      { name: "build", status: "queued", duration: "—" },
    ],
  },
  {
    id: "run-197",
    title: "Release: v0.14.6",
    branch: "main",
    status: "success",
    commit: "9c0d1e2f",
    author: "hamagesila",
    startedAt: "2026-08-30T14:00:00Z",
    endedAt: "2026-08-30T14:06:30Z",
    jobs: [
      { name: "build", status: "success", duration: "2m 10s" },
      { name: "package", status: "success", duration: "45s" },
      { name: "publish", status: "success", duration: "1m 20s" },
    ],
  },
];

// ── 工厂函数 ──
function makeGitRepo({ name, branch, ahead, behind, files, untracked, detached, incoming, outgoing }) {
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
    remote: { ahead: 0, behind: 0, files: (remoteFiles || []).map(f => ({ ...f })) },
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
function formatDuration(start, end) {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}
function formatTime(iso) {
  if (!iso) return "…";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function statusIcon(s) {
  switch (s) {
    case "success": return "✓";
    case "failed": return "✗";
    case "running": return "⟳";
    case "queued": return "⏳";
    case "cancelled": return "—";
    default: return "?";
  }
}

// ── 全局状态 ──
let currentScenario = "dirty";
let currentTab = "changes"; // changes | branches | pipelines
let expandedRepos = {};
let selectedFiles = {};
let commitMsg = {};
let expandedPipelines = {};
let branchFilter = "";

// ── DOM 引用 ──
const $scenarioBar = document.getElementById("scenario-bar");
const $panel = document.getElementById("vcs-panel");
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

// ── Toast ──
let toastTimer = null;
function toast(msg) {
  clearTimeout(toastTimer);
  $toast.textContent = msg;
  $toast.classList.add("show");
  toastTimer = setTimeout(() => $toast.classList.remove("show"), 2000);
}

// ── 选择场景 ──
function selectScenario(key) {
  currentScenario = key;
  currentTab = "changes";
  expandedRepos = {};
  selectedFiles = {};
  commitMsg = {};
  expandedPipelines = {};
  branchFilter = "";
  $scenarioBar.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c.dataset.key === key));
  const repo0 = SCENARIOS[key].repos[0];
  if (repo0) expandedRepos[repo0.name] = true;
  renderAll();
}

// ── 切换 Tab ──
function switchTab(tab) {
  currentTab = tab;
  renderAll();
}

// ── 主渲染 ──
function renderAll() {
  renderPanel();
}

// ============================================================
// 渲染 VCS 面板
// ============================================================
function renderPanel() {
  const sc = SCENARIOS[currentScenario];
  const repo = sc.repos[0];
  if (!repo) { $panel.innerHTML = '<div class="panel-note">No repository</div>'; return; }

  const isGit = repo.repotype === "git";
  const behind = repo.remote.behind || 0;
  const ahead = repo.remote.ahead || 0;
  const changed = countChanged(repo);
  const untracked = countUntracked(repo);
  const totalChanged = changed + untracked;

  // Tab 定义
  const tabs = [
    { id: "changes", label: "文件改动", icon: "✎", badge: totalChanged > 0 ? totalChanged : null },
    { id: "branches", label: "分支", icon: "⑂", disabled: !isGit },
    { id: "pipelines", label: "流水线", icon: "◫" },
  ];

  let html = "";

  // ── 仓库头 ──
  html += `
    <div class="repo-header">
      <div class="repo-icon">${isGit ? "⑂" : "svn"}</div>
      <div class="repo-info">
        <div class="repo-name">${repo.name}</div>
        <div class="repo-branch">
          <span class="dot" style="${repo.detached ? "background:var(--warning)" : ""}"></span>
          ${repo.branch || "(no branch)"}
          ${repo.detached ? ' <span style="color:var(--warning);font-size:10px">detached</span>' : ""}
        </div>
      </div>
      <span class="kpis">
        <span class="kpi ${totalChanged > 0 ? "warn" : ""}">${totalChanged} changed</span>
        ${isGit ? `
          <span class="kpi ${behind > 0 ? "warn" : ""}">↓${behind}</span>
          <span class="kpi ${ahead > 0 ? "warn" : ""}">↑${ahead}</span>
        ` : ""}
      </span>
      <span class="sync-btns">
        <button onclick="toast('Fetch completed.')">Fetch</button>
        <button onclick="toast('Pull completed.')" ${behind === 0 && isGit ? "disabled" : ""}>Pull</button>
        <button class="primary" onclick="toast('Push completed.')" ${ahead === 0 && isGit ? "disabled" : ""}>Push</button>
      </span>
    </div>`;

  // ── Tab 栏 ──
  html += `<div class="vcs-tabs">`;
  for (const t of tabs) {
    const active = currentTab === t.id;
    const disabled = t.disabled;
    html += `
      <button class="vcs-tab ${active ? "active" : ""}"
              ${disabled ? 'disabled style="opacity:0.4;cursor:default"' : ""}
              onclick="${disabled ? "" : `switchTab('${t.id}')`}">
        <span class="tab-icon">${t.icon}</span>
        ${t.label}
        ${t.badge != null ? `<span class="tab-badge">${t.badge}</span>` : ""}
      </button>`;
  }
  html += `</div>`;

  // ── Tab 内容区 ──
  html += `<div class="vcs-tab-content active">`;

  if (currentTab === "changes") {
    html += renderChangesTab(repo, isGit);
  } else if (currentTab === "branches") {
    html += renderBranchesTab(repo);
  } else if (currentTab === "pipelines") {
    html += renderPipelinesTab(repo);
  }

  html += `</div>`;

  // ── 底部说明 ──
  html += `<div class="panel-note">
    原型：三 Tab 下拉面板 · 场景 <b>${sc.label}</b> ·
    参考 Lyra <code>GitPanel.tsx</code>
  </div>`;

  $panel.innerHTML = html;
}

// ============================================================
// Tab 1: 文件改动
// ============================================================
function renderChangesTab(repo, isGit) {
  const statusList = repo.status || [];
  const changedList = statusList.filter(s => !s.untracked);
  const untrackedList = repo.untracked || [];
  const total = changedList.length + untrackedList.length;

  let html = "";

  // 筛选栏
  html += `
    <div class="filter-bar">
      <input type="search" placeholder="Search files…" />
      <span class="count">${total} file${total !== 1 ? "s" : ""}</span>
    </div>`;

  // Changes 区
  html += `
    <div class="collapse-head">
      <button onclick="toast('Toggle Changes')">
        <span class="caret">▾</span>
        Changes
        <span class="count">(${changedList.length})</span>
      </button>
      <span class="ops">
        <button class="btn-text" onclick="toast('Select All Changes')">All</button>
        <button class="btn-text" onclick="toast('Select None')">None</button>
      </span>
    </div>`;

  if (changedList.length > 0) {
    html += `<div class="file-list">`;
    for (const f of changedList) {
      html += renderFileRow(f);
    }
    html += `</div>`;
  }

  // Untracked 区
  html += `
    <div class="collapse-head">
      <button onclick="toast('Toggle Untracked')">
        <span class="caret">▾</span>
        Untracked
        <span class="count">(${untrackedList.length})</span>
      </button>
      <span class="ops">
        <button class="btn-text" onclick="toast('Select All Untracked')">All</button>
        <button class="btn-text" onclick="toast('Select None')">None</button>
      </span>
    </div>`;

  if (untrackedList.length > 0) {
    html += `<div class="file-list">`;
    for (const f of untrackedList) {
      html += renderFileRow(f);
    }
    html += `</div>`;
  }

  // ── Remote 区（Git 始终显示，SVN 有 remoteFiles 时显示） ──
  const remoteAhead = repo.remote.ahead || 0;
  const remoteBehind = repo.remote.behind || 0;
  const svnRemoteFiles = !isGit && repo.remote.files ? repo.remote.files : [];
  const hasSvnRemote = svnRemoteFiles.length > 0;
  const remoteCount = isGit ? remoteAhead + remoteBehind : svnRemoteFiles.length;

  if (isGit || hasSvnRemote) {
    html += `
      <div class="collapse-head">
        <button onclick="toast('Toggle Remote')">
          <span class="caret">▾</span>
          Remote
          <span class="count">(${remoteCount})</span>
        </button>
        <span class="ops">
          <button class="btn-text" onclick="toast('Fetch')">Fetch</button>
          ${remoteBehind > 0 ? `<button class="btn-text" onclick="toast('Pull')">Pull</button>` : ""}
          ${remoteAhead > 0 ? `<button class="btn-text" onclick="toast('Push')">Push</button>` : ""}
        </span>
      </div>`;

    if (isGit) {
      html += `<div class="remote-section">`;

      // Upstream 行
      html += `<div class="remote-meta">
        <span class="rm-label">Upstream</span>
        <span class="rm-url">origin/main</span>
        ${remoteBehind > 0 ? `<span class="rm-badge behind">↓ ${remoteBehind}</span>` : ""}
        ${remoteAhead > 0 ? `<span class="rm-badge ahead">↑ ${remoteAhead}</span>` : ""}
        ${remoteAhead === 0 && remoteBehind === 0 ? `<span class="rm-badge" style="color:var(--success)">✓ synced</span>` : ""}
      </div>`;

      // Incoming commits
      const incoming = repo.remote.incoming || [];
      if (incoming.length > 0) {
        html += `<div class="remote-group">
          <div class="remote-group-title">
            <span class="rg-icon" style="color:var(--error)">↓</span>
            Incoming <span class="rg-count">${remoteBehind} commit${remoteBehind !== 1 ? "s" : ""}</span>
          </div>
          <div class="remote-commit-list">`;
        for (const c of incoming) {
          html += renderRemoteCommit(c, "incoming");
        }
        html += `</div>
          <div class="remote-group-foot">
            <button class="btn-text" onclick="toast('Pull ${remoteBehind} commits')">Pull all</button>
          </div>
        </div>`;
      }

      // Outgoing commits
      const outgoing = repo.remote.outgoing || [];
      if (outgoing.length > 0) {
        html += `<div class="remote-group">
          <div class="remote-group-title">
            <span class="rg-icon" style="color:var(--success)">↑</span>
            Outgoing <span class="rg-count">${remoteAhead} commit${remoteAhead !== 1 ? "s" : ""}</span>
          </div>
          <div class="remote-commit-list">`;
        for (const c of outgoing) {
          html += renderRemoteCommit(c, "outgoing");
        }
        html += `</div>
          <div class="remote-group-foot">
            <button class="btn-text" onclick="toast('Push ${remoteAhead} commits')">Push all</button>
          </div>
        </div>`;
      }

      // 同步完成空态
      if (remoteAhead === 0 && remoteBehind === 0) {
        html += `<div class="remote-synced">
          <span class="rs-icon">✓</span>
          <span class="rs-text">工作区已同步，无待拉取或推送的提交</span>
        </div>`;
      }

      html += `</div>`;
    } else {
      // SVN remote files
      html += `<div class="file-list">`;
      for (const f of svnRemoteFiles) {
        html += `<div class="file-row" style="grid-template-columns:20px 1fr">
          <span class="code ${f.code}">${codeLabel(f.code)}</span>
          <span class="path">${f.path}</span>
        </div>`;
      }
      html += `</div>`;
    }
  }

  // Commit 区
  if (total > 0) {
    html += `
      <div class="commit-area">
        <textarea placeholder="Commit message…">chore: update selected files</textarea>
        <div class="commit-actions">
          <button class="commit-btn" onclick="toast('Commit ${total} files')">Commit (${total})</button>
          <span class="commit-hint">supports multi-select</span>
        </div>
      </div>`;
  }

  return html;
}

function renderFileRow(f) {
  return `
    <div class="file-row">
      <input type="checkbox" class="sel" />
      <span class="code ${f.code}">${codeLabel(f.code)}</span>
      <span class="path">${f.path}</span>
      <span class="ops">
        <a href="#" onclick="event.preventDefault();toast('Open diff: ${f.path}')">Diff</a>
        <a href="#" onclick="event.preventDefault();toast('History: ${f.path}')">History</a>
      </span>
    </div>`;
}

function renderRemoteCommit(c, dir) {
  const dirIcon = dir === "incoming" ? "↓" : "↑";
  const dirColor = dir === "incoming" ? "var(--error)" : "var(--success)";
  const files = c.files || [];
  return `
    <div class="rc-row" onclick="this.classList.toggle('expanded')">
      <div class="rc-main">
        <span class="rc-dir" style="color:${dirColor}">${dirIcon}</span>
        <span class="rc-hash">${shortHash(c.hash)}</span>
        <span class="rc-subject">${c.subject}</span>
        <span class="rc-meta">
          <span class="rc-by">${c.author}</span>
          <span class="rc-when">${c.date}</span>
        </span>
      </div>
      ${files.length > 0 ? `
      <div class="rc-files">
        ${files.map(f => `<span class="rc-file"><span class="code ${f.code}" style="font-size:10px">${f.code}</span> ${f.path}</span>`).join("")}
        <div class="rc-file-ops">
          <button class="btn-text" onclick="event.stopPropagation();toast('View diff: ${c.hash}')">查看差异</button>
          ${dir === "incoming" ? `<button class="btn-text" onclick="event.stopPropagation();toast('Cherry-pick: ${shortHash(c.hash)}')">Cherry-pick</button>` : ""}
        </div>
      </div>` : ""}
    </div>`;
}

// ============================================================
// Tab 2: 分支
// ============================================================
function renderBranchesTab(repo) {
  const branches = SAMPLE_BRANCHES;
  const currentBranch = branches.local.find(b => b.isCurrent);

  let html = `<div class="branch-section">`;

  // 当前分支高亮
  if (currentBranch) {
    html += `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:8px;border:1px solid var(--accent-soft-border);border-radius:var(--r-md);background:var(--accent-soft)">
        <span style="font-size:11px;color:var(--text-muted)">当前</span>
        <span style="font-weight:600;color:var(--accent-600);font-size:13px">⑂ ${currentBranch.name}</span>
        <span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-left:auto">${shortHash(currentBranch.hash)}</span>
      </div>`;
  }

  // 本地分支
  html += `
    <div class="branch-section-title">
      本地分支 <span class="count">(${branches.local.length})</span>
    </div>
    <div class="branch-list">`;

  for (const b of branches.local) {
    html += `
      <div class="branch-row ${b.isCurrent ? "is-current" : ""}" onclick="toast('Switch to ${b.name}')">
        <span class="current-dot ${b.isCurrent ? "" : "hidden"}"></span>
        <span class="bname">${b.name}</span>
        <span class="bmeta">
          <span class="bhash">${shortHash(b.hash)}</span>
          ${b.ahead > 0 ? `<span class="ahead">↑${b.ahead}</span>` : ""}
          ${b.behind > 0 ? `<span class="behind">↓${b.behind}</span>` : ""}
        </span>
      </div>`;
  }

  html += `</div>`;

  // 远程分支
  html += `
    <div class="branch-section-title" style="margin-top:12px">
      远程分支 <span class="count">(${branches.remote.length})</span>
    </div>
    <div class="branch-list">`;

  for (const b of branches.remote) {
    html += `
      <div class="branch-row" onclick="toast('Checkout ${b.name}')">
        <span class="current-dot hidden"></span>
        <span class="bname" style="color:var(--text-secondary)">${b.name}</span>
        <span class="bmeta">
          <span class="bhash">${shortHash(b.hash)}</span>
        </span>
      </div>`;
  }

  html += `</div></div>`;

  // 新建分支
  html += `
    <div class="branch-create">
      <input type="text" placeholder="new-branch-name" />
      <button onclick="toast('Create branch')">新建</button>
    </div>`;

  return html;
}

// ============================================================
// Tab 3: 流水线
// ============================================================
function renderPipelinesTab(repo) {
  const runs = SAMPLE_PIPELINES;

  let html = `<div class="pipeline-section">`;
  html += `<div class="pipeline-list">`;

  for (const run of runs) {
    const expanded = !!expandedPipelines[run.id];
    html += `
      <div class="pipeline-row ${expanded ? "expanded" : ""}"
           onclick="togglePipeline('${run.id}')">
        <span class="pipe-dot ${run.status}"></span>
        <div class="pipe-main">
          <div class="pipe-title">${run.title}</div>
          <div class="pipe-sub">
            <span class="branch-tag">⑂ ${run.branch}</span>
            <span>${shortHash(run.commit)} · ${run.author}</span>
          </div>
        </div>
        <div class="pipe-time">
          <span class="duration">${formatDuration(run.startedAt, run.endedAt)}</span>
          <span>${formatTime(run.startedAt)}</span>
        </div>
      </div>`;

    // 展开详情
    if (expanded) {
      html += `<div style="padding:0 12px 8px">`;
      html += `<div class="pipe-detail">`;
      html += `
        <div class="detail-row">
          <span class="detail-label">状态</span>
          <span class="detail-value">${statusIcon(run.status)} ${run.status}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">提交</span>
          <span class="detail-value mono">${run.commit}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">触发者</span>
          <span class="detail-value">${run.author}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">耗时</span>
          <span class="detail-value">${formatDuration(run.startedAt, run.endedAt)}</span>
        </div>`;

      // Jobs
      if (run.jobs && run.jobs.length > 0) {
        html += `<div class="job-list">`;
        for (const job of run.jobs) {
          html += `
            <div class="job-row">
              <span class="job-dot ${job.status}"></span>
              <span class="job-name">${job.name}</span>
              <span class="job-status">${job.duration}</span>
            </div>`;
        }
        html += `</div>`;
      }

      html += `</div></div>`;
    }
  }

  html += `</div></div>`;
  return html;
}

function togglePipeline(id) {
  expandedPipelines[id] = !expandedPipelines[id];
  renderAll();
}

// ── 初始化 ──
const repo0 = SCENARIOS[currentScenario].repos[0];
if (repo0) expandedRepos[repo0.name] = true;
renderAll();
