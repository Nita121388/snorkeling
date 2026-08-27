// ============================================================
// VCS Header Hover Panel — 原型交互
// 模拟真实实现的数据流：
//   hover 图标(350ms) → resolveRepoForPath(懒加载+缓存) → 面板按 repotype 渲染
//   点击图标本体 → openVersionControlBlock()（行为不变）
// ============================================================

"use strict";

// ---------- 场景数据（模拟 RemoteVcsRepositoriesCommand 返回的 VcsRepositoryInfo） ----------
// ponytail: all in-app copy stays English — the app has no i18n yet.
// Chinese below appears only in reviewer-facing notes (index.html bottom section).
const SCENARIOS = {
  "git-dir": {
    label: "Git · Directory",
    scope: "directory", // directory | file
    state: { kind: "repos", repos: [makeGitRepo({ branch: "main", ahead: 2, behind: 5, changed: 3, untracked: 1 })] },
  },
  "git-file": {
    label: "Git · File",
    scope: "file",
    state: { kind: "repos", repos: [makeGitRepo({ branch: "feat/preview", ahead: 0, behind: 0, changed: 1, untracked: 2 })] },
  },
  "svn-dir": {
    label: "SVN · Directory",
    scope: "directory",
    state: { kind: "repos", repos: [makeSvnRepo({ changed: 2, untracked: 0, remoteFiles: 4 })] },
  },
  "svn-file": {
    label: "SVN · File",
    scope: "file",
    state: { kind: "repos", repos: [makeSvnRepo({ changed: 1, untracked: 0, remoteFiles: 0 })] },
  },
  multi: {
    label: "Multi-repo (nested)",
    scope: "directory",
    state: {
      kind: "repos",
      repos: [
        makeGitRepo({ name: "snorkeling", branch: "main", ahead: 1, behind: 0, changed: 5, untracked: 0 }),
        makeSvnRepo({ name: "vendor-assets", changed: 0, untracked: 3, remoteFiles: 1 }),
      ],
    },
  },
  none: {
    label: "Not a repo path",
    scope: "directory",
    state: { kind: "none" },
  },
  detecting: {
    label: "Detecting (lazy load)",
    scope: "directory",
    // 模拟首次 hover 才触发 resolve，800ms 后就绪
    state: { kind: "pending" },
    readyAfterMs: 800,
    readyState: { kind: "repos", repos: [makeGitRepo({ branch: "dev", ahead: 0, behind: 3, changed: 0, untracked: 0 })] },
  },
  error: {
    label: "Resolve failed",
    scope: "directory",
    state: { kind: "error", error: "context deadline exceeded (timeout 60s)" },
  },
};

function makeGitRepo({ name = "snorkeling", branch, ahead, behind, changed, untracked }) {
  return {
    repotype: "git",
    name,
    branch,
    remote: { ahead, behind },
    counts: { changed, untracked },
  };
}

function makeSvnRepo({ name = "vendor-assets", changed, untracked, remoteFiles }) {
  return {
    repotype: "svn",
    name,
    branch: "", // SVN 无本地分支概念
    remote: { files: Array.from({ length: remoteFiles }, (_, i) => ({ path: `remote-${i}.bin` })) },
    counts: { changed, untracked },
  };
}

// ---------- 状态 ----------
let currentKey = "git-dir";
let hoverTimer = null;
let hideTimer = null;

const els = {
  scenarioBar: document.getElementById("scenario-bar"),
  vcsBtnWrap: document.getElementById("vcs-hover-anchor"),
  panel: document.getElementById("vcs-hover-panel"),
  toast: document.getElementById("toast"),
  log: document.getElementById("log"),
};

function log(msg) {
  const now = new Date().toTimeString().slice(0, 8);
  els.log.textContent = `[${now}] ${msg}`;
}

// ---------- 场景切换 ----------
for (const [key, sc] of Object.entries(SCENARIOS)) {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.textContent = sc.label;
  chip.dataset.key = key;
  chip.addEventListener("click", () => selectScenario(key));
  els.scenarioBar.appendChild(chip);
}
els.scenarioBar.querySelector(`[data-key="${currentKey}"]`).classList.add("active");

// 目录 / 文件 block 的演示内容
function renderBlockBody(scope) {
  const body = document.getElementById("mock-block-body");
  if (scope === "file") {
    body.innerHTML = `
      <div class="file-line"><span class="status-code st-m">M</span><span class="fname">frontend/app/view/preview/preview-model.tsx</span></div>
      <div class="file-line" style="color:var(--text-muted)">— file preview content —</div>`;
  } else {
    body.innerHTML = `
      <div class="file-line"><span class="status-code st-m">M</span><span class="fname">preview-model.tsx</span></div>
      <div class="file-line"><span class="status-code st-u">?</span><span class="fname">new-component.scss</span></div>
      <div class="file-line"><span class="status-code st-u">?</span><span class="fname">notes.md</span></div>
      <div class="file-line" style="color:var(--text-muted)">— directory listing —</div>`;
  }
}

function selectScenario(key) {
  currentKey = key;
  els.scenarioBar.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.key === key));
  closePanel();
  renderBlockBody(SCENARIOS[key].scope);
  log(`scenario: ${SCENARIOS[key].label}`);
}

// ---------- 面板渲染（核心：按 repotype 区分） ----------
function repoPanelHtml(repo, scope) {
  const isGit = repo.repotype === "git";
  const badge = isGit ? "GIT" : "SVN";
  const branchHtml = isGit && repo.branch ? `<span class="vhp-branch" title="branch">${repo.branch}</span>` : "";
  // Count pills mirror the real VcsView wording style ("C:x U:y", "Behind x" / "Ahead x" badges).
  const c = repo.counts;
  const statusPills = [];
  statusPills.push(`<span class="vhp-pill">${c.changed} changed</span>`);
  if (c.untracked > 0 || !isGit) statusPills.push(`<span class="vhp-pill">${c.untracked} untracked</span>`);
  if (isGit) {
    const { ahead, behind } = repo.remote;
    statusPills.push(
      behind > 0 ? `<span class="vhp-pill warn">↓ Behind ${behind}</span>` : `<span class="vhp-pill muted">↓ Behind 0</span>`
    );
    statusPills.push(
      ahead > 0 ? `<span class="vhp-pill warn">↑ Ahead ${ahead}</span>` : `<span class="vhp-pill muted">↑ Ahead 0</span>`
    );
  } else {
    const rf = repo.remote.files.length;
    statusPills.push(
      rf > 0 ? `<span class="vhp-pill warn">${rf} remote file(s)</span>` : `<span class="vhp-pill muted">No remote changes</span>`
    );
  }

  // 动作区：Git = Pull/Push/Fetch；SVN = Update；文件 block 多一个 Diff
  const actions = [];
  if (isGit) {
    actions.push(actionBtn("Pull", "sync-pull", { primary: true, disabled: repo.remote.behind <= 0 }));
    actions.push(actionBtn("Push", "sync-push", { disabled: repo.remote.ahead <= 0 }));
    actions.push(actionBtn("Fetch", "sync-fetch"));
  } else {
    actions.push(actionBtn("Update", "sync-update", { primary: true }));
  }
  actions.push(actionBtn(isGit ? "Commits" : "Log", "commits", { more: true }));
  actions.push(actionBtn("History", "history", { more: true }));
  if (scope === "file") actions.push(actionBtn("Diff", "diff", { more: true }));
  actions.push(actionBtn("Open VCS Block", "openblock", { more: true }));

  return `
    <div class="vhp-repo" data-repotype="${repo.repotype}">
      <div class="vhp-title-row">
        <span class="vhp-badge">${badge}</span>
        <span class="vhp-name">${repo.name}</span>
        ${branchHtml}
      </div>
      <div class="vhp-status-row">${statusPills.join("")}</div>
      <div class="vhp-actions">${actions.join("")}</div>
    </div>`;
}

function actionBtn(label, action, { primary = false, disabled = false, more = false } = {}) {
  const cls = ["vhp-btn", primary && "primary", more && "more"].filter(Boolean).join(" ");
  return `<button class="${cls}" data-action="${action}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

function panelContent(sc) {
  if (sc.state.kind === "pending") {
    return `<div class="vhp-state"><span class="spinner"></span>Version Control: Detecting...</div>`;
  }
  if (sc.state.kind === "error") {
    return `<div class="vhp-state error">Resolve Failed<span style="color:var(--text-muted)">(${sc.state.error})</span></div>
            <button class="linklike" data-action="copydebug">Copy Debug Info</button>`;
  }
  if (sc.state.kind === "none") {
    // 非 repo：不弹面板（由 openPanel 直接拦截）
    return "";
  }
  return sc.state.repos.map((r) => repoPanelHtml(r, sc.scope)).join("");
}

// ---------- hover 开合逻辑（对应 Tooltip useHover + openDelay 300ms + 300ms 宽限） ----------
function openPanel() {
  const sc = SCENARIOS[currentKey];
  if (sc.state.kind === "none") {
    log("not a repo: no flyout, native title only (click still opens VCS Block)");
    return;
  }
  clearTimeout(hideTimer);
  els.panel.innerHTML = panelContent(sc);
  els.panel.classList.add("open");
  bindPanelActions();
  log("panel open (350ms hover delay; cached resolve shows instantly)");

  // 模拟 detecting → ready
  if (sc.state.kind === "pending" && sc.readyAfterMs) {
    setTimeout(() => {
      if (!els.panel.classList.contains("open")) return;
      sc.state = sc.readyState;
      els.panel.innerHTML = panelContent(sc);
      bindPanelActions();
      log("resolve ready, panel updated in place");
    }, sc.readyAfterMs);
  }
}

function closePanel() {
  els.panel.classList.remove("open");
}

els.vcsBtnWrap.addEventListener("mouseenter", () => {
  clearTimeout(hideTimer);
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(openPanel, 350);
});
els.vcsBtnWrap.addEventListener("mouseleave", () => {
  clearTimeout(hoverTimer);
  hideTimer = setTimeout(() => {
    if (!els.panel.matches(":hover")) closePanel();
  }, 250);
});
els.panel.addEventListener("mouseleave", () => {
  hideTimer = setTimeout(closePanel, 250);
});

// ---------- 点击图标本体：行为不变 ----------
document.getElementById("vcs-icon-btn").addEventListener("click", () => {
  showToast("Click unchanged → opens full VCS Block (openVersionControlBlock)");
});

// ---------- 面板按钮动作 ----------
function bindPanelActions() {
  els.panel.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action.startsWith("sync-")) {
        simulateSync(btn, action);
        return;
      }
      const labels = {
        commits: "opens Commits/Log Block (openCommitsBlock)",
        history: "opens History Block (openHistoryBlock, scoped to current path)",
        diff: "opens Diff Block (openDiffBlock, working-tree diff; file blocks only)",
        openblock: "opens full VCS Block scoped to this repo",
        copydebug: "debug info copied (path + error), same as context menu",
      };
      showToast(labels[action] ?? action);
    });
  });
}

function simulateSync(btn, action) {
  const repoDiv = btn.closest(".vhp-repo");
  const isSvn = repoDiv?.dataset.repotype === "svn";
  const runningLabel = isSvn ? "Updating..." : `${action.slice(5)[0].toUpperCase()}${action.slice(6)}ing...`;
  const doneLabel = isSvn ? "Update" : action.slice(5)[0].toUpperCase() + action.slice(6);
  btn.disabled = true;
  btn.textContent = runningLabel;
  log(`${doneLabel} started (RemoteVcsSyncCommand; cache cleared + counts refreshed on success)`);
  setTimeout(() => {
    btn.textContent = doneLabel;
    btn.disabled = false;
    showToast(`${doneLabel} completed.`);
    // 模拟刷新：清掉 ahead/behind/远端变更
    const sc = SCENARIOS[currentKey];
    if (sc.state.kind === "repos") {
      for (const r of sc.state.repos) {
        if (r.repotype === "git") r.remote = { ahead: 0, behind: 0 };
        else r.remote = { files: [] };
      }
      els.panel.innerHTML = panelContent(sc);
      bindPanelActions();
      log("cache entry cleared, panel counts refreshed");
    }
  }, 1500);
}

// ---------- toast ----------
let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

// ---------- 初始渲染 ----------
renderBlockBody(SCENARIOS[currentKey].scope);
