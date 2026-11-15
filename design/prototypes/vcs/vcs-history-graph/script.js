/* VCS History graph prototype — rendering + interactions. */

const state = {
    keyword: "",
    since: "",
    until: "",
    page: 1,
    pageSize: 20,
    expanded: new Set(),
};

const PAGE_H = GRAPH_GEO.rowHeight;
const FILE_ROW_H = 27;

const BRANCH_PALETTE = ["#3b82f6", "#f97316", "#e74c4c", "#22c55e", "#a855f7", "#eab308"];

/** Branch name -> stable lane colour (keeps colours identical across pages/filters). */
function colorForBranchName(name) {
    const known = MOCK_BRANCH_ORDER.indexOf(name);
    if (known >= 0) return BRANCH_PALETTE[known % BRANCH_PALETTE.length];
    let hash = 0;
    for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) % 997;
    return BRANCH_PALETTE[hash % BRANCH_PALETTE.length];
}

function colorForCommit(commit) {
    const ref = (commit.refs || []).find((entry) => entry.type === "head" || entry.type === "branch");
    return ref ? colorForBranchName(ref.name) : null;
}

const AVATAR_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#eab308", "#ef4444", "#22c55e"];

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function initials(name) {
    const parts = String(name || "?")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(name) {
    let hash = 0;
    for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) % 997;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function shortHash(hash) {
    return hash.length > 8 ? hash.slice(0, 8) : hash;
}

/** "2m" / "3h" / "1d" / "1w" -> Date (prototype-only: filters need absolute dates). */
function relativeToDate(rel) {
    const now = Date.now();
    const match = /^(\d+)([mhdw])$/.exec(String(rel || "").trim());
    if (!match) return new Date(now);
    const value = Number(match[1]);
    const unitMs = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2]];
    return new Date(now - value * unitMs);
}

function filteredCommits() {
    const keyword = state.keyword.trim().toLowerCase();
    const since = state.since ? new Date(`${state.since}T00:00:00`) : null;
    const until = state.until ? new Date(`${state.until}T23:59:59`) : null;
    return MOCK_COMMITS.filter((commit) => {
        if (keyword) {
            const haystack = `${commit.hash} ${commit.author} ${commit.email} ${commit.subject}`.toLowerCase();
            if (!haystack.includes(keyword)) return false;
        }
        const date = relativeToDate(commit.time);
        if (since && date < since) return false;
        if (until && date > until) return false;
        return true;
    });
}

function refMarkup(ref) {
    if (ref.type === "head") {
        return `<span class="ref ref-head" style="color:${refColor(ref.name)}">${escapeHtml(ref.name)} <i>◄</i></span>`;
    }
    if (ref.type === "tag") {
        return `<span class="ref ref-tag">⚑ ${escapeHtml(ref.name)}</span>`;
    }
    if (ref.type === "remote") {
        return `<span class="ref ref-remote">☁ ${escapeHtml(ref.name)}</span>`;
    }
    const color = refColor(ref.name);
    return `<span class="ref ref-branch" style="color:${color};border-color:${hexToAlpha(color, 0.45)};background:${hexToAlpha(
        color,
        0.14
    )}">${escapeHtml(ref.name)}</span>`;
}

/** Branch name -> lane color, resolved from the rendered layout. */
let branchColors = {};

function refColor(name) {
    return branchColors[name] || colorForBranchName(name);
}

/** HEAD badge shows the branch it points at (like the source screenshots: `main`). */
function headTarget(commit) {
    const headRef = (commit.refs || []).find((ref) => ref.type === "head");
    return headRef ? headRef.name : "HEAD";
}

function hexToAlpha(hex, alpha) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderLegend() {
    branchColors = {};
    MOCK_BRANCH_ORDER.forEach((name) => {
        branchColors[name] = colorForBranchName(name);
    });
    document.getElementById("legend").innerHTML = MOCK_BRANCH_ORDER.map(
        (name) =>
            `<span class="legend-item"><span class="legend-dot" style="background:${branchColors[name]}"></span>${escapeHtml(
                name
            )}</span>`
    ).join("");
}

function fileStatMarkup(file) {
    const parts = [];
    if (file.added > 0) parts.push(`<span class="add">+${file.added}</span>`);
    if (file.deleted > 0) parts.push(`<span class="del">−${file.deleted}</span>`);
    if (parts.length === 0) parts.push(`<span class="muted">0</span>`);
    return `<span class="file-stat tabular-nums">${parts.join("")}</span>`;
}

function filePathMarkup(path) {
    const idx = path.lastIndexOf("/");
    if (idx === -1) return escapeHtml(path);
    return `<span class="dir">${escapeHtml(path.slice(0, idx + 1))}</span>${escapeHtml(path.slice(idx + 1))}`;
}

function commitItemMarkup(row, layout) {
    const commit = row.commit;
    const isOpen = state.expanded.has(commit.id);
    const headBranch = headTarget(commit);
    const refs = (commit.refs || []).map((ref) =>
        ref.type === "head" ? `<span class="ref ref-head" style="color:${refColor(headBranch)}">${escapeHtml(
            "HEAD → " + headBranch
        )}</span>` : refMarkup(ref)
    );

    const files = commit.files || [];
    const gutterHeight = files.length * FILE_ROW_H + 8;
    const filesPanel = isOpen
        ? `<div class="commit-files">
             <div class="gutter">
               <svg width="${layout.width}" height="${gutterHeight}" viewBox="0 0 ${layout.width} ${gutterHeight}" fill="none" stroke-width="1.5" stroke-linecap="round">${gutterSvg(
                   row.bottomLanes,
                   gutterHeight
               )}</svg>
             </div>
             <div class="files-body">
               ${files
                   .map(
                       (file) => `<div class="file-row">
                          <span class="file-code ${file.code}">${file.code}</span>
                          <span class="file-path">${filePathMarkup(file.path)}</span>
                          ${fileStatMarkup(file)}
                          <button class="icon-btn" type="button" title="View diff">⇄</button>
                        </div>`
                   )
                   .join("")}
             </div>
           </div>`
        : "";

    return `<div class="commit-item${isOpen ? " open" : ""}" data-commit="${commit.id}">
        <div class="commit-row" data-toggle="${commit.id}">
          <span class="graph-cell">
            <svg width="${layout.width}" height="${PAGE_H}" viewBox="0 0 ${layout.width} ${PAGE_H}" fill="none" stroke-width="1.5" stroke-linecap="round">${rowSvg(
                row,
                PAGE_H
            )}</svg>
          </span>
          <span class="commit-title">
            <span class="refs">${refs.join("")}</span>
            <span class="subject" title="${escapeHtml(commit.subject)}">${escapeHtml(commit.subject)}</span>
          </span>
          <span class="commit-hash" title="${escapeHtml(commit.hash)}">${escapeHtml(shortHash(commit.hash))}</span>
          <span class="commit-author">
            <span class="avatar" style="background:${avatarColor(commit.author)}">${escapeHtml(initials(commit.author))}</span>
            <span>${escapeHtml(commit.author)}</span>
          </span>
          <span class="commit-time">${escapeHtml(commit.time)}</span>
          <span class="commit-actions">
            <button class="icon-btn" type="button" data-copy="${escapeHtml(commit.hash)}" title="Copy hash">⧉</button>
            <button class="icon-btn" type="button" title="Open commit on remote">↗</button>
          </span>
        </div>
        ${filesPanel}
      </div>`;
}

function render() {
    const commits = filteredCommits();
    const pageSize = Math.max(1, state.pageSize);
    const pageCount = Math.max(1, Math.ceil(commits.length / pageSize));
    if (state.page > pageCount) state.page = pageCount;

    const start = (state.page - 1) * pageSize;
    const pageCommits = commits.slice(start, start + pageSize);
    const layout = computeLayout(pageCommits, { colorForCommit });

    document.getElementById("history").style.setProperty("--graph-w", `${layout.width + 10}px`);

    const history = document.getElementById("history");
    if (pageCommits.length === 0) {
        history.innerHTML = `<div class="muted" style="padding:16px 12px;font-size:12px">No commits found.</div>`;
    } else {
        history.innerHTML = layout.rows.map((row) => commitItemMarkup(row, layout)).join("");
    }

    renderLegend();

    const from = commits.length === 0 ? 0 : start + 1;
    const to = Math.min(start + pageSize, commits.length);
    document.getElementById(
        "page-info"
    ).textContent = `${from}–${to} of ${commits.length} commits · page ${state.page}/${pageCount}`;

    document.getElementById("page-prev").disabled = state.page <= 1;
    document.getElementById("page-next").disabled = state.page >= pageCount;

    bindRowEvents();
}

function bindRowEvents() {
    document.querySelectorAll(".commit-row").forEach((rowEl) => {
        rowEl.addEventListener("click", (event) => {
            if (event.target.closest("[data-copy]")) return;
            if (event.target.closest(".icon-btn")) return;
            const id = rowEl.getAttribute("data-toggle");
            if (state.expanded.has(id)) state.expanded.delete(id);
            else state.expanded.add(id);
            render();
        });
    });

    document.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", async (event) => {
            event.stopPropagation();
            const hash = btn.getAttribute("data-copy");
            try {
                await navigator.clipboard.writeText(hash);
            } catch {
                /* clipboard may be blocked on file:// — prototype only */
            }
            const old = btn.textContent;
            btn.textContent = "✓";
            window.setTimeout(() => (btn.textContent = old), 1200);
        });
    });
}

function applyFilters() {
    state.keyword = document.getElementById("f-keyword").value;
    state.since = document.getElementById("f-since").value;
    state.until = document.getElementById("f-until").value;
    state.pageSize = Number(document.getElementById("f-pagesize").value) || 20;
    state.page = 1;
    render();
}

function resetFilters() {
    document.getElementById("f-keyword").value = "";
    document.getElementById("f-since").value = "";
    document.getElementById("f-until").value = "";
    document.getElementById("f-pagesize").value = "20";
    state.keyword = "";
    state.since = "";
    state.until = "";
    state.pageSize = 20;
    state.page = 1;
    state.expanded.clear();
    render();
}

document.getElementById("f-apply").addEventListener("click", applyFilters);
document.getElementById("f-reset").addEventListener("click", resetFilters);
document.getElementById("f-keyword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyFilters();
});
document.getElementById("f-pagesize").addEventListener("change", applyFilters);
document.getElementById("page-prev").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    render();
});
document.getElementById("page-next").addEventListener("click", () => {
    state.page += 1;
    render();
});

document.getElementById("theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    document.getElementById("theme-toggle").textContent = next === "dark" ? "◐ Dark" : "◑ Light";
});

/** Prototype-only demo state via URL query, e.g.
 *  ?theme=light&expand=c20,c19&keyword=merge&hover=1 */
(function applyUrlState() {
    const params = new URLSearchParams(location.search);
    const theme = params.get("theme");
    if (theme === "light" || theme === "dark") {
        document.documentElement.setAttribute("data-theme", theme);
        document.getElementById("theme-toggle").textContent = theme === "dark" ? "◐ Dark" : "◑ Light";
    }
    const expand = params.get("expand");
    if (expand) {
        expand
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
            .forEach((id) => state.expanded.add(id));
    }
    const keyword = params.get("keyword");
    if (keyword) {
        document.getElementById("f-keyword").value = keyword;
        state.keyword = keyword;
    }
    const pagesize = params.get("pagesize");
    if (pagesize) {
        document.getElementById("f-pagesize").value = pagesize;
        state.pageSize = Number(pagesize) || state.pageSize;
    }
    if (params.get("hover") === "1") document.body.classList.add("force-actions");
})();

render();
