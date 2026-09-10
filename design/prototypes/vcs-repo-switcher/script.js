// ============================================================
// VCS Block — Multi-repo Switcher · script.js
// 场景数据 + repo 切换器 + tab 联动
// ============================================================
"use strict";

// ── 仓库构造器（字段对齐 wshrpc.VcsRepositoryInfo） ──
function makeCommit({ hash, author, date, subject, files }) {
  return { hash, author, date, subject, files: files || [] };
}

function makeGitRepo({ name, path, branch, changed, untracked, ahead = 0, behind = 0, branches, commits = [] }) {
  return {
    repoid: "git:" + path,
    repotype: "git",
    name, rootpath: path, branch: branch || "(no branch)",
    status: [
      ...changed.map((p) => ({ path: p, code: "M" })),
      ...untracked.map((p) => ({ path: p, code: "U", untracked: true })),
    ],
    remote: { ahead, behind },
    branches: branches || [branch || "main"],
    commits,
  };
}
function makeSvnRepo({ name, path, changed, untracked = [], remoteFiles = [], commits = [] }) {
  return {
    repoid: "svn:" + path,
    repotype: "svn",
    name, rootpath: path, branch: "/trunk",
    status: [
      ...changed.map((p) => ({ path: p, code: "M" })),
      ...untracked.map((p) => ({ path: p, code: "U", untracked: true })),
    ],
    remote: { files: remoteFiles.length },
    branches: [],
    remoteFiles,
    commits,
  };
}

// ── 场景数据（含用户真实目录 E:/projects） ──
const SCENARIOS = {
  "real-projects": {
    label: "E:/projects（真实）",
    desc: "5 git repos — 用户实际目录",
    repos: [
      makeGitRepo({ name: "monthly-log-web", path: "E:\\projects\\monthly-log-web", branch: "main", changed: ["frontend/app/App.tsx", "src/utils.ts"], untracked: ["new-page.md"], behind: 3, ahead: 1, branches: ["main", "dev"], commits: [
        makeCommit({ hash: "9f81a3c2d5", author: "nita", date: "2026-09-08 14:22", subject: "feat: 月报导出新增 xlsx 模板", files: [{ path: "src/export.ts", code: "A" }] }),
        makeCommit({ hash: "7e2b1c09d4", author: "nita", date: "2026-09-05 09:10", subject: "fix: 登录态过期跳转", files: [{ path: "frontend/app/App.tsx", code: "M" }, { path: "src/auth.ts", code: "M" }] }),
        makeCommit({ hash: "4aa0ff71e9", author: "chemclin", date: "2026-08-30 18:03", subject: "docs: 补充 README 使用说明", files: [{ path: "README.md", code: "M" }] }),
      ] }),
      makeGitRepo({ name: "quartz-site", path: "E:\\projects\\quartz-site", branch: "master", changed: ["content/blog/003.md"], untracked: [], behind: 0, ahead: 2, branches: ["master"], commits: [
        makeCommit({ hash: "c1d2e3f405", author: "nita", date: "2026-09-06 11:00", subject: "post: 新增 003 博客", files: [{ path: "content/blog/003.md", code: "A" }] }),
        makeCommit({ hash: "09ac88b12f", author: "nita", date: "2026-09-02 16:44", subject: "chore: 更新 quartz 主题配置", files: [{ path: "quartz.config.ts", code: "M" }] }),
      ] }),
      makeGitRepo({ name: "quartz-site/quartz", path: "E:\\projects\\quartz-site\\quartz", branch: "v4.4.0", changed: [], untracked: [], branches: ["v4.4.0"], commits: [] }),
      makeGitRepo({ name: "tab-out", path: "E:\\projects\\tab-out", branch: "main", changed: ["src/background.js"], untracked: [], branches: ["main"], commits: [
        makeCommit({ hash: "d55ab09c11", author: "nita", date: "2026-09-03 13:20", subject: "feat: 定时清空超时 tab", files: [{ path: "src/background.js", code: "M" }, { path: "manifest.json", code: "M" }] }),
      ] }),
      makeGitRepo({ name: "tabshelf", path: "E:\\projects\\tabshelf", branch: "master", changed: [], untracked: ["proto/"], behind: 1, branches: ["master"], commits: [
        makeCommit({ hash: "1f0a2b3c4d", author: "nita", date: "2026-09-01 20:15", subject: "feat: websocket 桥接初版", files: [{ path: "src/bridge.ts", code: "A" }, { path: "README.md", code: "A" }] }),
      ] }),
    ],
  },
  "single": {
    label: "单仓库",
    desc: "dropdown 收起为只读",
    repos: [
      makeGitRepo({ name: "snorkeling", path: "E:\\code\\snorkeling", branch: "main", changed: ["frontend/app/view/vcs/vcs.tsx"], untracked: [], branches: ["main"] }),
    ],
  },
  "mixed": {
    label: "Git + SVN 混合",
    desc: "徽标区分 GIT / SVN",
    repos: [
      makeGitRepo({ name: "app-frontend", path: "E:\\work\\app-frontend", branch: "dev", changed: ["src/ui.tsx"], untracked: ["todo.txt"], branches: ["dev", "main"], commits: [
        makeCommit({ hash: "aabbcc1122", author: "nita", date: "2026-09-09 10:00", subject: "feat: 卡片拖拽排序", files: [{ path: "src/ui.tsx", code: "M" }] }),
      ] }),
      makeSvnRepo({ name: "legacy-assets", path: "E:\\work\\legacy-assets", changed: ["assets/logo.png", "assets/icon.svg"], remoteFiles: ["assets/banner.png"], commits: [
        makeCommit({ hash: "r1204", author: "nita", date: "2026-08-20 09:30", subject: "update logo assets", files: [{ path: "assets/logo.png", code: "M" }] }),
      ] }),
    ],
  },
  "nested": {
    label: "嵌套仓库",
    desc: "相对层级路径展示",
    repos: [
      makeGitRepo({ name: "design-system", path: "E:\\repo\\design-system", branch: "main", changed: ["tokens.css"], untracked: [], branches: ["main"] }),
      makeGitRepo({ name: "design-system/playground", path: "E:\\repo\\design-system\\playground", branch: "wip", changed: [], untracked: ["draft.md"], branches: ["wip"] }),
    ],
  },
  "empty": {
    label: "空路径",
    desc: "No Git/SVN repository found",
    repos: [],
  },
};

// ── 状态 ──
let state = {
  repos: [],
  activeRepoId: "",
};

// ── DOM refs ──
const $ = (id) => document.getElementById(id);
const rsTrigger = $("rsTrigger"), rsName = $("rsName"), rsIcon = $("rsIcon"), rsBadge = $("rsBadge"), rsMenu = $("rsMenu");
const vcsBranch = $("vcsBranch"), vcsAb = $("vcsAb"), vcsChanged = $("vcsChanged"), vcsBack = $("vcsBack"), vcsFwd = $("vcsFwd");
const vcsBehind = $("behind"), vcsAhead = $("ahead"), vcsPull = $("vcsPull");
const tabChanges = $("tabChanges"), tabBranches = $("tabBranches"), tabHistory = $("tabHistory"), tabPipelines = $("tabPipelines");
const tabbar = $("vcsTabbar");

// ── 场景栏 ──
const scenarioBar = $("scenarioBar");
Object.entries(SCENARIOS).forEach(([key, sc]) => {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = sc.label;
  chip.title = sc.desc;
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    loadScenario(sc);
  });
  scenarioBar.appendChild(chip);
});

// ── 头部渲染 ──
function renderHeader(repo) {
  const isGit = repo.repotype === "git";
  const changed = repo.status.length;
  const changedWarn = changed > 0;
  const ahead = repo.remote.ahead || 0;
  const behind = repo.remote.behind || 0;

  rsName.textContent = repo.name;
  rsIcon.textContent = isGit ? "⑂" : "↺";
  rsBadge.textContent = isGit ? "GIT" : "SVN";
  rsBadge.classList.toggle("SVN", !isGit);

  vcsBranch.textContent = repo.branch || "(no branch)";
  vcsAb.textContent = isGit && (ahead > 0 || behind > 0) ? (behind > 0 ? "↓" + behind : "") + (ahead > 0 ? "↑" + ahead : "") : "";

  vcsChanged.textContent = changed + " changed";
  vcsChanged.classList.toggle("warn", changedWarn);

  vcsBehind.textContent = behind;
  vcsBack.classList.toggle("warn", isGit && behind > 0);
  vcsBack.style.display = isGit && behind > 0 ? "" : "none";
  vcsAhead.textContent = ahead;
  vcsFwd.classList.toggle("warn", isGit && ahead > 0);
  vcsFwd.style.display = isGit && ahead > 0 ? "" : "none";

  vcsPull.disabled = !isGit;

  // 单仓库：下拉收起为只读
  rsTrigger.classList.toggle("readonly", state.repos.length <= 1);
  rsTrigger.querySelector(".rs-caret").style.display = state.repos.length <= 1 ? "none" : "";
  renderTabs();
}

function renderSwitcherMenu() {
  if (state.repos.length <= 1) { rsMenu.hidden = true; return; }
  rsMenu.innerHTML = "";
  state.repos.forEach((repo) => {
    const isGit = repo.repotype === "git";
    const row = document.createElement("div");
    row.className = "rs-item" + (repo.repoid === state.activeRepoId ? " is-current" : "");
    row.role = "option";
    row.setAttribute("aria-selected", repo.repoid === state.activeRepoId);
    row.innerHTML =
      `<span class="check ${repo.repoid === state.activeRepoId ? "" : "blank"}">✓</span>` +
      `<span class="meta">` +
        `<span class="m-name">${esc(repo.name)} <span class="badge ${isGit ? "" : "svn"}">${isGit ? "GIT" : "SVN"}</span></span>` +
        `<span class="m-path">${esc(repo.rootpath)}</span>` +
      `</span>` +
      `<span class="m-branch">${esc(repo.branch || "")}</span>`;
    row.addEventListener("click", () => {
      setActive(repo.repoid);
      closeMenu();
    });
    rsMenu.appendChild(row);
  });
}

function setActive(repoid) {
  state.activeRepoId = repoid;
  const repo = state.repos.find((r) => r.repoid === repoid);
  if (repo) renderHeader(repo);
  renderSwitcherMenu();
}

// ── Tab 渲染 ──
function renderTabs() {
  const repo = state.repos.find((r) => r.repoid === state.activeRepoId);
  if (!repo) return;
  const isGit = repo.repotype === "git";
  const changeCount = repo.status.length;

  const tabs = [
    { id: "changes", label: "Changes", icon: "✎", count: changeCount, disabled: false, pane: tabChanges },
    { id: "branches", label: "Branches", icon: "⑂", count: false, disabled: !isGit, pane: tabBranches },
    { id: "history", label: "History", icon: "◷", count: false, disabled: false, pane: tabHistory },
    { id: "pipelines", label: "Pipelines", icon: "▦", count: false, disabled: false, pane: tabPipelines },
  ];
  tabbar.innerHTML = "";
  let activeView = "changes";
  tabs.forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "vcs-tab" + (t.id === activeView ? " active" : "");
    btn.disabled = t.disabled;
    btn.innerHTML = `<span>${t.icon}</span><span>${t.label}</span>${t.count ? `<span class="badge">${t.count}</span>` : ""}`;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      document.querySelectorAll(".vcs-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderPane(t.id, repo);
    });
    tabbar.appendChild(btn);
  });
  renderPane(activeView, repo);
}

function renderPane(view, repo) {
  [tabChanges, tabBranches, tabHistory, tabPipelines].forEach((p) => p.classList.remove("active"));
  const isGit = repo.repotype === "git";
  if (view === "changes") {
    tabChanges.classList.add("active");
    tabChanges.innerHTML = "";
    if (repo.status.length === 0) {
      tabChanges.innerHTML = '<div class="empty">No local changes.</div>';
      return;
    }
    const rows = document.createElement("div");
    rows.className = "pane-rows";
    repo.status.forEach((s) => {
      const code = s.untracked ? "U" : s.code;
      const row = document.createElement("div");
      row.className = "pane-row";
      row.innerHTML = `<span class="code ${code}">${code}</span><span class="pp">${esc(s.path)}</span><span class="sub">${repo.name}</span>`;
      rows.appendChild(row);
    });
    tabChanges.appendChild(rows);
  } else if (view === "branches") {
    tabBranches.classList.add("active");
    tabBranches.innerHTML = "";
    const list = (repo.branches || []).map((b) => `<div class="pane-row"><span class="pp">⑂ ${esc(b)}</span>${b === repo.branch ? '<span class="sub">current</span>' : ""}</div>`).join("");
    tabBranches.innerHTML = isGit ? (list || '<div class="empty">No branches.</div>') : '<div class="empty">Not a Git repository.</div>';
  } else if (view === "history") {
    tabHistory.classList.add("active");
    tabHistory.innerHTML = "";
    if (!repo.commits || repo.commits.length === 0) {
      tabHistory.innerHTML = '<div class="empty">No commits found.</div>';
      return;
    }
    const list = document.createElement("div");
    list.className = "history-list";
    repo.commits.forEach((c) => {
      const card = document.createElement("div");
      card.className = "hist-row";
      card.innerHTML =
        `<div class="hist-head">` +
          `<span class="hist-caret">▸</span>` +
          `<span class="hist-hash mono">${esc(shortHash(c.hash))}</span>` +
          `<span class="hist-subject">${esc(c.subject)}</span>` +
        `</div>` +
        `<div class="hist-meta"><span>${esc(c.author || "unknown")}</span><span>${esc(c.date || "")}</span></div>` +
        `<div class="hist-files" hidden>` +
          (c.files || []).map((f) =>
            `<div class="hist-file"><span class="code ${f.code}">${esc(f.code)}</span><span class="pp">${esc(f.path)}</span><button class="diff-btn">Diff</button></div>`
          ).join("") +
        `</div>`;
      card.querySelector(".hist-head").addEventListener("click", () => {
        const expanded = card.classList.toggle("expanded");
        const caret = card.querySelector(".hist-caret");
        const files = card.querySelector(".hist-files");
        caret.textContent = expanded ? "▾" : "▸";
        files.hidden = !expanded;
      });
      card.querySelectorAll(".diff-btn").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          showToast("Open Diff: " + b.closest(".hist-file").querySelector(".pp").textContent);
        });
      });
      list.appendChild(card);
    });
    tabHistory.appendChild(list);
  } else {
    tabPipelines.classList.add("active");
    tabPipelines.innerHTML = '<div class="empty">Pipeline list for ' + esc(repo.name) + ' (placeholder).</div>';
  }
}

// ── 下拉开合 ──
function openMenu() {
  if (state.repos.length <= 1) return;
  renderSwitcherMenu();
  rsMenu.hidden = false;
  rsTrigger.setAttribute("aria-expanded", "true");
}
function closeMenu() {
  rsMenu.hidden = true;
  rsTrigger.setAttribute("aria-expanded", "false");
}
rsTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  rsMenu.hidden ? openMenu() : closeMenu();
});
document.addEventListener("click", (e) => {
  if (!rsMenu.hidden && !rsMenu.contains(e.target) && !rsTrigger.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

// ── 加载场景 ──
const blockHeader = document.querySelector(".vcs-header");
const blockTabbar = document.querySelector(".vcs-tabbar");
const blockContent = document.querySelector(".vcs-content");
let emptyEl = null;

function loadScenario(sc) {
  state.repos = sc.repos;
  if (state.repos.length === 0) {
    // 只隐藏/清空内容区，不销毁 header/tabbar DOM，避免重建
    blockHeader.style.display = "none";
    blockTabbar.style.display = "none";
    [tabChanges, tabBranches, tabHistory, tabPipelines].forEach((p) => p.classList.remove("active"));
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.className = "empty";
      emptyEl.style.cssText = "padding:40px 16px;text-align:center;";
      emptyEl.textContent = "No Git/SVN repository found in this path.";
    }
    blockContent.appendChild(emptyEl);
    return;
  }
  blockHeader.style.display = "";
  blockTabbar.style.display = "";
  if (emptyEl) emptyEl.remove();
  state.activeRepoId = state.repos[0].repoid;
  renderHeader(state.repos[0]);
  renderSwitcherMenu();
}

// ── 工具 ──
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function shortHash(h) { return !h ? "" : (h.length <= 10 ? h : h.slice(0, 10)); }
function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1600);
}

// ── 初始：默认加载真实场景 ──
const firstKey = "real-projects";
document.querySelectorAll(".chip")[0].classList.add("active");
loadScenario(SCENARIOS[firstKey]);