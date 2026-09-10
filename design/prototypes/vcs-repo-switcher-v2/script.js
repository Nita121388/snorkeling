/* ============================================================
   VCS Repo Switcher v2 · script.js
   场景数据（对齐 RemoteVcsRepositoriesCommand 返回字段） +
   切换器 + RepoHeader + TabBar + Changes/Remote 渲染
   ============================================================ */

"use strict";

// ── 场景定义（字段名与 wshrpc.VcsRepositoryInfo 对齐） ──
const SCENARIOS = {
  single: {
    label: "Single",
    desc: "单仓库（切换器隐藏）",
    repos: [
      makeRepo("snorkeling", "/home/user/snorkeling", "git", "main",
        0, 0, "origin/main", "https://github.com/nita121388/snorkeling", [
          { path: "README.md", code: "M", staged: false, untracked: false },
          { path: "CLAUDE.md", code: "M", staged: false, untracked: false },
        ]),
    ],
  },
  duo: {
    label: "Duo",
    desc: "2 仓库：一净一脏",
    repos: [
      makeRepo("snorkeling", "/home/user/snorkeling", "git", "main",
        0, 0, "origin/main", "https://github.com/nita121388/snorkeling", [
          { path: "README.md", code: "M", staged: false, untracked: false },
        ]),
      makeRepo("wave-terminal", "/home/user/wave-terminal", "git", "dev",
        2, 1, "origin/main", "https://github.com/command-line-inc/wave", [
          { path: "src/app.tsx", code: "M", staged: false, untracked: false },
          { path: "src/tabs.ts", code: "M", staged: false, untracked: false },
          { path: "src/temp.ts", code: "??", staged: false, untracked: true },
        ]),
    ],
  },
  quad: {
    label: "Quad",
    desc: "4 仓库（monorepo 子包）",
    repos: [
      makeRepo("frontend", "/workspace/mono/frontend", "git", "feature/dark",
        5, 0, "origin/main", "", [
          { path: "src/App.tsx", code: "M", staged: false, untracked: false },
          { path: "src/App.css", code: "M", staged: false, untracked: false },
          { path: "src/button.tsx", code: "A", staged: true, untracked: false },
          { path: "src/util.ts", code: "M", staged: false, untracked: false },
          { path: "src/new.ts", code: "??", staged: false, untracked: true },
        ]),
      makeRepo("backend", "/workspace/mono/backend", "git", "main",
        0, 0, "origin/main", "", []),
      makeRepo("cli-tools", "/workspace/mono/cli-tools", "git", "fix/lint",
        1, 0, "origin/main", "", [
          { path: "cmd/root.go", code: "M", staged: false, untracked: false },
        ]),
      makeRepo("docs", "/workspace/mono/docs", "git", "main",
        0, 0, "origin/main", "", []),
    ],
  },
  overflow: {
    label: "Overflow 6+",
    desc: "横滑 + 溢出下拉",
    repos: [
      makeRepo("web", "/workspace/mega/web", "git", "main", 0, 0, "origin/main", "", []),
      makeRepo("api", "/workspace/mega/api", "git", "feat/auth", 3, 2, "origin/main", "", [
        { path: "src/auth.ts", code: "M", staged: false, untracked: false },
        { path: "src/session.ts", code: "M", staged: false, untracked: false },
        { path: "src/old.ts", code: "D", staged: false, untracked: false },
      ]),
      makeRepo("mobile", "/workspace/mega/mobile", "git", "release/1.0", 1, 0, "origin/main", "", [
        { path: "App.tsx", code: "M", staged: false, untracked: false },
      ]),
      makeRepo("infra", "/workspace/mega/infra", "git", "main", 0, 0, "origin/main", "", []),
      makeRepo("data-pipeline", "/workspace/mega/data-pipeline", "git", "main", 2, 0, "origin/main", "", [
        { path: "etl/job.py", code: "M", staged: false, untracked: false },
        { path: "etl/schema.json", code: "??", staged: false, untracked: true },
      ]),
      makeRepo("ml-service", "/workspace/mega/ml-service", "git", "main", 0, 0, "origin/main", "", []),
      makeRepo("docs", "/workspace/mega/docs", "git", "main", 0, 0, "origin/main", "", []),
      makeRepo("scripts", "/workspace/mega/scripts", "git", "fix/ci", 0, 0, "origin/main", "", []),
    ],
  },
  mixed: {
    label: "Mixed",
    desc: "Git + SVN 混合",
    repos: [
      makeRepo("snorkeling", "/home/user/snorkeling", "git", "main",
        0, 0, "origin/main", "https://github.com/nita121388/snorkeling", []),
      makeRepo("legacy-app", "/home/user/legacy-app", "svn", "trunk",
        1, 0, "", "", [
          { path: "src/Main.java", code: "M", staged: false, untracked: false },
        ]),
    ],
  },
  nested: {
    label: "Nested",
    desc: "父目录是 git + 子仓库",
    repos: [
      makeRepo("workspace (parent)", "/home/user/workspace", "git", "main",
        0, 0, "origin/main", "", []),
      makeRepo("frontend", "/home/user/workspace/frontend", "git", "feature/ui",
        4, 0, "origin/main", "", [
          { path: "src/Header.tsx", code: "M", staged: false, untracked: false },
          { path: "src/Sidebar.tsx", code: "M", staged: false, untracked: false },
          { path: "src/new.css", code: "A", staged: true, untracked: false },
          { path: "src/temp.ts", code: "??", staged: false, untracked: true },
        ]),
      makeRepo("backend", "/home/user/workspace/backend", "git", "main",
        0, 1, "origin/main", "", []),
    ],
  },
};

function makeRepo(name, rootpath, repotype, branch, ahead, behind, upstream, browseUrl, statusList) {
  const totalChanged = (statusList ?? []).filter((s) => !s.untracked).length;
  const totalUntracked = (statusList ?? []).filter((s) => s.untracked).length;
  return {
    repoid: `${repotype}:${rootpath}`,
    name,
    rootpath,
    repotype,
    branch,
    status: statusList ?? [],
    statuserr: "",
    remoteurl: upstream ? `https://fake.git/${name}` : "",
    browseurl: browseUrl,
    remote: {
      ahead,
      behind,
      upstream,
      incoming: [],
      outgoing: [],
      files: [],
    },
  };
}

// ── 应用状态 ──
let state = {
  scenarioKey: "single",
  mode: "chips", // chips | dropdown
  activeRepoId: "",
  openTab: "changes",
  ddOpen: false,
  ddFilter: "",
  moreOpen: false,
  summaryOpen: false,
};

function scenario() { return SCENARIOS[state.scenarioKey]; }
function repos() { return scenario().repos; }
function activeRepo() {
  const r = repos().find((r) => r.repoid === state.activeRepoId);
  return r ?? repos()[0];
}
function totalChanged() { return repos().reduce((s, r) => s + r.status.filter((f) => !f.untracked).length, 0); }
function totalAhead()  { return repos().reduce((s, r) => s + (r.remote?.ahead ?? 0), 0); }
function totalBehind() { return repos().reduce((s, r) => s + (r.remote?.behind ?? 0), 0); }
function repoIsDirty(r) { return r.status.some((s) => !s.untracked) || (r.remote?.ahead ?? 0) + (r.remote?.behind ?? 0) > 0; }
function repoChanged(r) { return r.status.filter((s) => !s.untracked).length + r.status.filter((s) => s.untracked).length; }

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1600);
}

// ── 渲染 ──
function renderAll() {
  renderScenarioBar();
  renderModeBar();
  renderSummary();
  renderSwitcher();
  renderRepoHeader();
  renderTabBar();
  renderTabContent();
}

function renderScenarioBar() {
  const bar = document.getElementById("scenario-bar");
  bar.innerHTML = "";
  for (const [key, sc] of Object.entries(SCENARIOS)) {
    const btn = document.createElement("button");
    btn.className = `chip${key === state.scenarioKey ? " active" : ""}`;
    btn.textContent = sc.label;
    btn.title = sc.desc;
    btn.onclick = () => {
      state.scenarioKey = key;
      state.activeRepoId = repos()[0]?.repoid ?? "";
      state.ddOpen = false; state.moreOpen = false; state.summaryOpen = false;
      renderAll();
    };
    bar.appendChild(btn);
  }
}

function renderModeBar() {
  document.querySelectorAll(".mode-bar .chip").forEach((el) => {
    el.classList.toggle("active", el.dataset.mode === state.mode);
    el.onclick = () => { state.mode = el.dataset.mode; renderAll(); };
  });
}

// ── 汇总条 ──
function renderSummary() {
  const countEl = document.getElementById("sum-count");
  const changedEl = document.getElementById("sum-changed");
  const behindEl = document.getElementById("sum-behind");
  const aheadEl = document.getElementById("sum-ahead");
  const listEl = document.getElementById("summary-list");
  const popoverEl = document.getElementById("summary-popover");
  countEl.textContent = repos().length;
  changedEl.textContent = `${totalChanged()} changed`;
  behindEl.textContent = `↓${totalBehind()}`;
  aheadEl.textContent = `↑${totalAhead()}`;
  behindEl.classList.toggle("warn", totalBehind() > 0);
  aheadEl.classList.toggle("warn", totalAhead() > 0);

  listEl.innerHTML = "";
  for (const repo of repos()) {
    const dirty = repoIsDirty(repo);
    const ch = repoChanged(repo);
    const row = document.createElement("div");
    row.className = "sum-row";
    row.innerHTML = `
      <span class="sdot ${repo.repotype === "svn" ? "svn" : dirty ? "dirty" : "clean"}"></span>
      <span class="sname" title="${repo.name}">${repo.name}</span>
      <span class="smeta">
        <span style="font-family:var(--font-mono);font-size:10px">${repo.branch}</span>
        <span style="margin-left:6px">${ch > 0 ? `<span class="warn">${ch} files</span>` : "clean"}</span>
      </span>
      <span class="smeta" style="min-width:48px;text-align:right">
        ${repo.remote?.ahead ?? 0 > 0 ? `<span class="warn">↑${repo.remote.ahead}</span>` : ""}
        ${repo.remote?.behind ?? 0 > 0 ? `<span style="color:var(--error)">↓${repo.remote.behind}</span>` : ""}
      </span>`;
    row.onclick = () => { state.activeRepoId = repo.repoid; state.summaryOpen = false; renderAll(); };
    listEl.appendChild(row);
  }
  popoverEl.classList.toggle("hidden", !state.summaryOpen);
}

// ── 仓库切换器 ──
function renderSwitcher() {
  const el = document.getElementById("switcher");
  if (repos().length <= 1) {
    el.className = "switcher hidden";
    return;
  }
  if (state.mode === "chips") {
    el.className = "switcher visible chips-mode";
    renderChips(el);
  } else {
    el.className = "switcher visible dropdown-mode";
    renderDropdown(el);
  }
}

function chipHTML(repo) {
  const dirty = repoIsDirty(repo);
  const isActive = repo.repoid === activeRepo().repoid;
  return `
    <button class="repo-chip${isActive ? " active" : ""}" data-repo="${repo.repoid}" title="${repo.name} — ${repo.branch}">
      <span class="chip-dot${dirty ? " dirty" : ""}"></span>
      <span class="chip-name">${repo.name}</span>
      <span class="chip-branch">${repo.branch}</span>
    </button>`;
}

function moreItemHTML(repo) {
  const dirty = repoIsDirty(repo);
  const isActive = repo.repoid === activeRepo().repoid;
  return `
    <div class="more-item${isActive ? " active" : ""}" data-repo="${repo.repoid}">
      <span class="mi-dot${dirty ? " dirty" : ""}"></span>
      <span class="mi-name">${repo.name}</span>
      <span class="mi-branch">${repo.branch}</span>
    </div>`;
}

function renderChips(container) {
  const visibleCount = 4;
  const overflow = repos().length > visibleCount;
  const shown = overflow ? repos().slice(0, visibleCount) : repos();
  const rest = overflow ? repos().slice(visibleCount) : [];
  const scroll = `<div class="chips-scroll">${shown.map(chipHTML).join("")}</div>`;
  const more = overflow
    ? `<div class="chips-more">
        <button>＋${rest.length}</button>
        <div class="more-menu${state.moreOpen ? " open" : ""}">${rest.map(moreItemHTML).join("")}</div>
      </div>`
    : "";
  container.innerHTML = scroll + more;
}

function renderDropdown(container) {
  const repo = activeRepo();
  const dirty = repoIsDirty(repo);
  const filtered = repos().filter((r) =>
    state.ddFilter === "" ||
    r.name.toLowerCase().includes(state.ddFilter) ||
    r.branch.toLowerCase().includes(state.ddFilter)
  );
  container.innerHTML = `
    <span class="dd-label">Repo</span>
    <div class="dd">
      <button class="dd-trigger">
        <span class="dd-dot${dirty ? " dirty" : ""}"></span>
        <span class="dd-name">${repo.name}</span>
        <span class="dd-branch">${repo.branch}</span>
        <span class="dd-caret">▾</span>
      </button>
      <div class="dd-panel${state.ddOpen ? " open" : ""}">
        <input class="dd-search" type="text" placeholder="Search repos..." value="${state.ddFilter}" />
        <div class="dd-list">
          ${filtered.length === 0 ? '<div class="dd-empty">No match</div>' : ""}
          ${filtered.map((r) => {
            const d = repoIsDirty(r);
            const ch = repoChanged(r);
            const isActive = r.repoid === repo.repoid;
            return `
              <div class="dd-item${isActive ? " active" : ""}" data-repo="${r.repoid}">
                <span class="di-dot${d ? " dirty" : ""}"></span>
                <span class="di-name">${r.name}</span>
                <span class="di-branch">${r.branch}</span>
                <span class="di-meta">${ch > 0 ? `${ch}f` : "clean"}</span>
              </div>`;
          }).join("")}
        </div>
      </div>
    </div>`;
}

// ── RepoHeader（对齐 vcs-tabs.tsx VcsRepoHeader） ──
function renderRepoHeader() {
  const r = activeRepo();
  if (!r) return;
  const el = document.getElementById("repo-header");
  const behind = r.remote?.behind ?? 0;
  const ahead  = r.remote?.ahead ?? 0;
  const changed = r.status.filter((s) => !s.untracked).length;
  const untracked = r.status.filter((s) => s.untracked).length;
  const total = changed + untracked;
  const isSvn = r.repotype === "svn";

  el.innerHTML = `
    <span class="rh-glyph">⑂</span>
    <span class="rh-branch">${r.branch || "(no branch)"}</span>
    ${r.repotype === "git" && (ahead > 0 || behind > 0) ? `
      <span class="rh-sync${behind > 0 ? " warn" : ""}">
        ${ahead > 0 ? `↑${ahead}` : ""}
        ${ahead > 0 && behind > 0 ? " " : ""}
        ${behind > 0 ? `↓${behind}` : ""}
      </span>
    ` : ""}
    <span class="rh-spacer"></span>
    <span class="rh-changed${total > 0 ? " warn" : ""}">${total} changed</span>
    <button class="rh-pull" ${isSvn ? "disabled" : ""} title="Pull">Pull</button>
    <button class="rh-refresh" title="Refresh">↻</button>`;
}

// ── TabBar（对齐 vcs-tabs.tsx VcsTabBar） ──
function renderTabBar() {
  const r = activeRepo();
  if (!r) return;
  const el = document.getElementById("tab-bar");
  const isGit = r.repotype === "git";
  const changed = r.status.filter((s) => !s.untracked).length;
  const untracked = r.status.filter((s) => s.untracked).length;
  const changeCount = changed + untracked;
  const remote = r.remote;
  const remoteCount = (remote?.ahead ?? 0) + (remote?.behind ?? 0) + (remote?.files?.length ?? 0);
  const tabs = [
    { id: "changes",   label: "Changes",   icon: "fa-file-pen" },
    { id: "branches",  label: "Branches",  icon: "fa-code-branch", disabled: !isGit },
    { id: "pipelines", label: "Pipelines", icon: "fa-diagram-project" },
    { id: "history",   label: "History",   icon: "fa-clock-rotate-left" },
  ];
  el.innerHTML = tabs.map((t) => {
    const badge =
      t.id === "changes" && changeCount > 0 ? changeCount :
      t.id === "pipelines" && remoteCount > 0 ? remoteCount : null;
    return `
      <button class="tab-btn${t.id === state.openTab ? " active" : ""}${t.disabled ? " disabled" : ""}"
              data-tab="${t.id}" ${t.disabled ? "disabled" : ""}>
        <i class="t-ico fa-sharp fa-solid ${t.icon}"></i>
        <span>${t.label}</span>
        ${badge != null ? `<span class="t-badge">${badge}</span>` : ""}
      </button>`;
  }).join("");
}

// ── TabContent ──
function renderTabContent() {
  const el = document.getElementById("tab-content");
  const r = activeRepo();
  if (!r) { el.innerHTML = '<div class="empty-note">No repository selected.</div>'; return; }
  if (state.openTab === "changes") {
    renderChangesTab(el, r);
  } else if (state.openTab === "history") {
    renderHistoryTab(el, r);
  } else {
    el.innerHTML = `<div class="sub-note">${state.openTab === "branches" ? "Branches tab — 对齐 vcs-branches-tab.tsx" : "Pipelines tab — 对齐 vcs-pipelines-tab.tsx"}</div>`;
  }
}

function renderChangesTab(el, repo) {
  const statusList = repo.status ?? [];
  const changedList = statusList.filter((s) => !s.untracked);
  const untrackedList = statusList.filter((s) => s.untracked);
  const remote = repo.remote;
  const isGit = repo.repotype === "git";
  const behind = remote?.behind ?? 0;
  const ahead  = remote?.ahead ?? 0;

  el.innerHTML = `
    ${repo.statuserr ? `<div style="color:var(--warning);margin-bottom:8px">Status warning: ${repo.statuserr}</div>` : ""}
    ${statusList.length === 0 ? '<div class="empty-note">Clean — no changes detected.</div>' : ""}
    ${changedList.length > 0 ? `
      <div class="section-head">
        <button>▾ Changes <span class="count">(${changedList.length})</span></button>
        <span class="ops">
          <a class="muted" href="#">Select All</a>
          <a class="muted" href="#">Select None</a>
        </span>
      </div>
      <div class="file-list">
        ${changedList.map((s) => fileRowHTML(s)).join("")}
      </div>
    ` : ""}
    ${untrackedList.length > 0 ? `
      <div class="section-head">
        <button>▾ Untracked <span class="count">(${untrackedList.length})</span></button>
        <span class="ops">
          <a class="muted" href="#">Select All</a>
          <a class="muted" href="#">Select None</a>
        </span>
      </div>
      <div class="file-list">
        ${untrackedList.map((s) => fileRowHTML(s)).join("")}
      </div>
    ` : ""}
    ${isGit ? `
      <div class="section-head">
        <button>▾ Remote <span class="count">(${ahead + behind})</span></button>
        <span class="ops">
          <a href="#">Fetch</a>
          <a href="#" style="${behind <= 0 ? "color:var(--text-muted);pointer-events:none" : ""}">Pull</a>
          <a href="#" style="${ahead <= 0 ? "color:var(--text-muted);pointer-events:none" : ""}">Push</a>
        </span>
      </div>
      <div class="remote-meta">
        <span class="rm-label">Upstream</span>
        <span class="rm-upstream">${remote?.upstream || "Not configured"}</span>
        <span class="rm-badge behind">Behind ${behind}</span>
        <span class="rm-badge ahead">Ahead ${ahead}</span>
      </div>
    ` : ""}
  `;
}

function fileRowHTML(s) {
  const label = s.code === "M" ? "Modified" : s.code === "A" ? "Added" : s.code === "D" ? "Deleted" : s.code === "R" ? "Renamed" : s.code === "??" ? "Untracked" : s.code;
  return `
    <div class="file-row">
      <input type="checkbox" />
      <span class="code ${s.code === "??" ? "" : s.code}">${s.code === "??" ? "??" : s.code}</span>
      <span class="path" title="${s.path}">${s.path}</span>
      <span class="ops">
        <a href="#">Diff</a>
        <a href="#">History</a>
      </span>
    </div>`;
}

// ── History Tab（对齐 vcscommits.tsx 提交列表） ──
const FAKE_COMMIT_POOL = [
  ["feat(vcs): add repo switcher to vcs view", "ada4f9c"],
  ["fix(preview): resolve parent-dir multi-repo open", "e81b2a3"],
  ["refactor(vcs-tabs): extract VcsRepoHeader", "c3d17ff"],
  ["feat(vcs): branches + pipelines tabs", "91fe0ab"],
  ["fix(vcs): count untracked in status badge", "5c8f3b2"],
  ["docs(design): vcs-repo-switcher v2 prototype", "1a2b3c4"],
  ["feat(sync): pull/fetch/push actions in vcs", "7d9e01f"],
  ["chore(deps): bump electron to 41", "b0c1d2e"],
  ["fix(term): sticky scroll on resize", "2f3g4h5"],
  ["feat(waveai): inline model picker", "6a7b8c9"],
  ["refactor(store): move rpc clients to wshrpcutil", "d0e1f2a"],
  ["docs: update AGENTS.md routing table", "3a4b5c6"],
  ["feat(builder): open vcs from file context menu", "8f9a0b1"],
  ["fix(vcs): disable pull for svn repos", "2c3d4e5"],
  ["test(vcs): repo root detection cases", "f1a2b3c"],
  ["feat(vcscommits): expand commit to view files", "4d5e6f7"],
  ["fix(preview): cache vcs resolve per path", "9a8b7c6"],
  ["chore(release): 0.14.6-beta.0", "1e2f3a4"],
  ["feat(tab): block move menu in vcs header", "5b6c7d8"],
  ["refactor(vcs-filter): share filter across tabs", "0a1b2c3"],
];
const FAKE_AUTHORS = ["nita121388", "command-line", "renovate[bot]", "dependabot[bot]", "penguin-build"];
const FAKE_DATES = [
  "2026-09-09 14:32", "2026-09-08 09:15", "2026-09-07 18:02", "2026-09-05 11:47",
  "2026-09-03 16:20", "2026-09-01 10:05", "2026-08-29 13:41", "2026-08-27 20:33",
];

// 每个仓库一组提交（文件名中携带仓库名，避免跨仓库串数据）
function commitsFor(repo) {
  const n = repo.name.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const seed = n.length;
  const count = 6 + (seed % 3); // 6..8
  const list = [];
  for (let i = 0; i < count; i++) {
    const [subject, hash] = FAKE_COMMIT_POOL[(seed + i * 3) % FAKE_COMMIT_POOL.length];
    const shortName = subject.split(" ").pop().replace(/\./g, "");
    const files = [
      `${repo.name}/src/${shortName}.ts`,
      `${repo.name}/README.md`,
      `${repo.name}/pkg/core.go`,
    ];
    list.push({
      hash: `${hash}${n.slice(0, 2)}${i}`, // 每个仓库 hash 唯一
      subject: `${subject}${i === 0 ? " (HEAD)" : ""}`,
      author: FAKE_AUTHORS[(seed + i) % FAKE_AUTHORS.length],
      date: FAKE_DATES[(seed + i) % FAKE_DATES.length],
      files: files.slice(0, 1 + (i % 3)),
    });
  }
  return list;
}

function renderHistoryTab(el, repo) {
  const commits = commitsFor(repo);
  el.innerHTML = `
    <div class="history-toolbar">
      <input class="h-search" type="text" placeholder="Keyword (hash/author/subject)" />
      <input class="h-date" type="text" placeholder="Since" value="" />
      <input class="h-date" type="text" placeholder="Until" value="" />
      <button class="h-apply">Apply</button>
      <button class="h-reset">Reset</button>
    </div>
    <div class="commit-list">
      ${commits.map((c, idx) => commitRowHTML(c, idx)).join("")}
    </div>
    <div class="h-load-more">
      <button>Load more</button>
      <span>showing ${commits.length} commits</span>
    </div>
  `;
}

function commitRowHTML(commit, idx) {
  const files = commit.files ?? [];
  return `
    <div class="commit-row" data-commit="${commit.hash}">
      <div class="cr-main">
        <span class="cr-chevron">${idx === 0 ? "▾" : "▸"}</span>
        <span class="cr-hash mono">${shortHash(commit.hash)}</span>
        <span class="cr-subject" title="${commit.subject}">${commit.subject}</span>
        <span class="cr-author">${commit.author}</span>
        <span class="cr-date">${commit.date}</span>
      </div>
      <div class="cr-files${idx === 0 ? " open" : ""}">
        ${files.map((f) => `<div class="cr-file mono"><span class="cr-code">M</span>${f}</div>`).join("")}
        ${files.length > 0 ? `<div class="cr-file-ops"><a href="#">View Diff</a><a href="#">Open</a></div>` : ""}
      </div>
    </div>`;
}

function shortHash(hash) {
  if (!hash || hash.length <= 10) return hash;
  return hash.slice(0, 10);
}

// ── 事件委托 ──
document.addEventListener("click", (e) => {
  // Chips 切换
  const chipBtn = e.target.closest(".repo-chip[data-repo]");
  if (chipBtn) {
    state.activeRepoId = chipBtn.dataset.repo;
    renderAll();
    toast(`Switched to ${activeRepo().name}`);
    return;
  }
  // Dropdown 切换
  const ddItem = e.target.closest(".dd-item[data-repo]");
  if (ddItem) {
    state.activeRepoId = ddItem.dataset.repo;
    state.ddOpen = false;
    renderAll();
    toast(`Switched to ${activeRepo().name}`);
    return;
  }
  // More menu 切换
  const moreItem = e.target.closest(".more-item[data-repo]");
  if (moreItem) {
    state.activeRepoId = moreItem.dataset.repo;
    state.moreOpen = false;
    renderAll();
    toast(`Switched to ${activeRepo().name}`);
    return;
  }
  // Tab 切换
  const tabBtn = e.target.closest(".tab-btn[data-tab]");
  if (tabBtn && !tabBtn.disabled) {
    state.openTab = tabBtn.dataset.tab;
    renderAll();
    return;
  }
  // History commit 展开/折叠
  const commitRow = e.target.closest(".commit-row");
  if (commitRow) {
    const filesEl = commitRow.querySelector(".cr-files");
    const chev = commitRow.querySelector(".cr-chevron");
    if (filesEl) {
      const isOpen = filesEl.classList.toggle("open");
      if (chev) chev.textContent = isOpen ? "▾" : "▸";
    }
    return;
  }
  // Summary expand
  if (e.target.closest("#summary-expand")) {
    state.summaryOpen = !state.summaryOpen;
    renderSummary();
    return;
  }
  // Summary row
  const sumRow = e.target.closest(".sum-row[data-repo]");
  // (handled via inline onclick)
  // Dropdown trigger
  const ddTrigger = e.target.closest(".dd-trigger");
  if (ddTrigger) {
    state.ddOpen = !state.ddOpen;
    renderSwitcher();
    return;
  }
  // More menu trigger
  const moreBtn = e.target.closest(".chips-more > button");
  if (moreBtn) {
    state.moreOpen = !state.moreOpen;
    renderSwitcher();
    return;
  }
  // Click outside closes
  if (!e.target.closest(".dd-panel") && !e.target.closest(".dd-trigger")) {
    if (state.ddOpen) { state.ddOpen = false; renderSwitcher(); }
  }
  if (!e.target.closest(".chips-more")) {
    if (state.moreOpen) { state.moreOpen = false; renderSwitcher(); }
  }
  if (!e.target.closest("#summary-popover") && !e.target.closest("#summary-expand")) {
    if (state.summaryOpen) { state.summaryOpen = false; renderSummary(); }
  }
});

// Dropdown search input
document.addEventListener("input", (e) => {
  if (e.target.matches(".dd-search")) {
    state.ddFilter = e.target.value.trim().toLowerCase();
    renderDropdown(e.target.closest(".switcher"));
  }
});

// ── 初始化 ──
state.activeRepoId = repos()[0]?.repoid ?? "";
renderAll();
