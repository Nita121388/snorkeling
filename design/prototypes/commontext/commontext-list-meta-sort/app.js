// 数据字段与真实 CommonTextItem（commontext-model.ts）逐字段对齐：
// id / title / text / shortcut / tags / pinned / createdat / updatedat / lastusedat / usagecount
const DATA = [
    {
        id: "ct-1",
        title: "Daily report",
        text: "Done today:\n- \n\nPlan tomorrow:\n- ",
        shortcut: "rpt",
        tags: ["email", "ops"],
        pinned: true,
        createdat: daysAgo(38),
        updatedat: hoursAgo(5),
        lastusedat: minutesAgo(42),
        usagecount: 24,
    },
    {
        id: "ct-2",
        title: "Support reply · reproduced",
        text: "Hi, we reproduced the issue. A fix is expected today; I will update this ticket once it ships.",
        shortcut: "",
        tags: ["support"],
        pinned: true,
        createdat: daysAgo(52),
        updatedat: daysAgo(3),
        lastusedat: hoursAgo(3),
        usagecount: 16,
    },
    {
        id: "ct-3",
        title: "Weekly report outline",
        text: "Highlights\nRisks\nNext week",
        shortcut: "wk",
        tags: ["email"],
        pinned: false,
        createdat: daysAgo(21),
        updatedat: daysAgo(1),
        lastusedat: hoursAgo(26),
        usagecount: 9,
    },
    {
        id: "ct-4",
        title: "Meeting notes skeleton",
        text: "Attendees:\nTopics:\nDecisions:\nOwners:",
        shortcut: "",
        tags: [],
        pinned: false,
        createdat: daysAgo(64),
        updatedat: daysAgo(64),
        lastusedat: hoursAgo(70),
        usagecount: 3,
    },
    {
        id: "ct-5",
        title: "Deploy checklist",
        text: "1. Tag release\n2. Build all platforms\n3. Smoke test\n4. Announce",
        shortcut: "",
        tags: ["ops"],
        pinned: false,
        createdat: daysAgo(6),
        updatedat: daysAgo(2),
        lastusedat: undefined,
        usagecount: 0,
    },
    {
        id: "ct-6",
        title: "Handoff note",
        text: "Current state:\nBlocked on:\nNext owner:",
        shortcut: "",
        tags: [],
        pinned: false,
        createdat: daysAgo(2),
        updatedat: hoursAgo(9),
        lastusedat: undefined,
        usagecount: 0,
    },
];

// 排序项与真实 sortCommonTextItems 的能力对齐；Relevance 只在搜索态出现，不是持久选项。
// 遵循「能用图标表示的不用文字」：界面上只有图标，含义走 title / aria-label（见 index.html）。
const SORT_OPTIONS = [
    { key: "lastused-desc" },
    { key: "updated-desc" },
    { key: "created-desc" },
    { key: "usage-desc" },
    { key: "title-asc" },
];
const SORT_STORAGE_KEY = "mockup.commontext.sort";
const DEFAULT_SORT = "lastused-desc";

const state = {
    sortKey: "lastused-desc",
    manualQuery: "",
    selectedTags: [],
    untaggedOnly: false,
    detailId: "ct-1",
    status: "",
};

/* ---------- 时间格式化 ----------
   真实仓库已有 formatSessionRelativeTime / formatSessionDateCompact（aisessions/utils.ts），
   这里照它们的输出口径复刻，落地时直接复用，不另写一套。 */
function minutesAgo(n) {
    return Date.now() - n * 60 * 1000;
}
function hoursAgo(n) {
    return Date.now() - n * 60 * 60 * 1000;
}
function daysAgo(n) {
    return Date.now() - n * 24 * 60 * 60 * 1000;
}
function pad2(n) {
    return String(n).padStart(2, "0");
}

function relTime(ts, now = Date.now()) {
    if (!ts) return "never";
    const sec = Math.floor(Math.max(0, now - ts) / 1000);
    if (sec < 10) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour}h ago`;
    return `${Math.floor(hour / 24)}d ago`;
}

function compactDate(ts, now = Date.now()) {
    if (!ts) return "";
    const d = new Date(ts);
    const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const datePart = d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}-${md}`;
    return `${datePart} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ---------- 过滤 ---------- */
function normalizeTagList(tags) {
    const seen = new Set();
    const out = [];
    for (const raw of Array.isArray(tags) ? tags : []) {
        if (typeof raw !== "string") continue;
        const t = raw.trim();
        if (!t) continue;
        const lower = t.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        out.push(t);
    }
    return out;
}

function filterByTags(items) {
    if (state.untaggedOnly) return items.filter((item) => normalizeTagList(item.tags).length === 0);
    if (state.selectedTags.length === 0) return items;
    const wanted = state.selectedTags.map((t) => t.toLowerCase());
    return items.filter((item) => {
        const set = new Set(normalizeTagList(item.tags).map((t) => t.toLowerCase()));
        return wanted.every((t) => set.has(t));
    });
}

/* ---------- 排序 ----------
   规则与评审结论一致：
   1) 浏览态：pinned 在前，再按用户选的 key；并列时回落到 updatedat desc、再 title。
   2) 搜索态：相关度降序；baseOrder（即上面那套顺序）只做并列次序。
   3) 独立函数，不改真实 sortCommonTextItems 本体（它还负责写盘顺序与键盘导航下标）。 */
function compareTitle(a, b) {
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

function sortByKey(items, key) {
    const arr = [...items];
    arr.sort((a, b) => {
        if ((a.pinned ?? false) !== (b.pinned ?? false)) return a.pinned ? -1 : 1;
        let primary = 0;
        switch (key) {
            case "updated-desc":
                primary = (b.updatedat ?? 0) - (a.updatedat ?? 0);
                break;
            case "created-desc":
                primary = (b.createdat ?? 0) - (a.createdat ?? 0);
                break;
            case "created-asc":
                primary = (a.createdat ?? 0) - (b.createdat ?? 0);
                break;
            case "usage-desc":
                primary = (b.usagecount ?? 0) - (a.usagecount ?? 0);
                break;
            case "title-asc":
                return compareTitle(a, b);
            case "lastused-desc":
            default:
                primary = (b.lastusedat ?? 0) - (a.lastusedat ?? 0);
                break;
        }
        if (primary !== 0) return primary;
        const updated = (b.updatedat ?? 0) - (a.updatedat ?? 0);
        if (updated !== 0) return updated;
        return compareTitle(a, b);
    });
    return arr;
}

/* 简化版相关度打分，口径照 scoreCommonTextToken：shortcut > title > tags > text */
function scoreToken(item, token) {
    const shortcut = (item.shortcut ?? "").toLowerCase();
    const title = item.title.toLowerCase();
    const tags = normalizeTagList(item.tags).map((t) => t.toLowerCase());
    const text = item.text.toLowerCase();
    if (shortcut === token) return 12;
    if (shortcut.includes(token)) return 10;
    if (title === token) return 8;
    if (title.includes(token)) return 6;
    if (tags.some((t) => t === token)) return 5;
    if (tags.some((t) => t.includes(token))) return 4;
    if (text.includes(token)) return 2;
    return 0;
}

function searchByRelevance(items, query) {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return items;
    const baseOrder = new Map(items.map((item, index) => [item.id, index]));
    const scored = [];
    for (const item of items) {
        let score = 0;
        let hits = 0;
        for (const token of tokens) {
            const s = scoreToken(item, token);
            if (s === 0) continue;
            score += s;
            hits += 1;
        }
        if (hits === 0) continue;
        scored.push({ item, score, hits });
    }
    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.hits !== a.hits) return b.hits - a.hits;
        return (baseOrder.get(a.item.id) ?? 0) - (baseOrder.get(b.item.id) ?? 0);
    });
    return scored.map((entry) => entry.item);
}

/* ---------- 计算当前列表 ---------- */
function isSearching() {
    return state.manualQuery.trim() !== "";
}

function getVisibleItems() {
    const tagged = filterByTags(DATA);
    const base = sortByKey(tagged, state.sortKey);
    return isSearching() ? searchByRelevance(base, state.manualQuery) : base;
}

function getTagSummaries(items) {
    const counts = new Map();
    for (const item of items) {
        for (const tag of normalizeTagList(item.tags)) {
            const lower = tag.toLowerCase();
            const cur = counts.get(lower);
            if (cur == null) counts.set(lower, { tag, count: 1 });
            else cur.count += 1;
        }
    }
    return [...counts.values()].sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag));
}

/* ---------- 渲染 ---------- */
const listEl = document.getElementById("listEl");
const detailEl = document.getElementById("detailPane");
const sortGroupEl = document.getElementById("sortGroup");
const sortRelevanceEl = document.getElementById("sortRelevance");
const searchInputEl = document.getElementById("searchInput");
const searchWrapEl = document.querySelector(".mm-search-input-wrap");
const tagChipsEl = document.getElementById("tagChips");
const untaggedChipEl = document.getElementById("untaggedChip");
const untaggedCountEl = document.getElementById("untaggedCount");
const statusEl = document.getElementById("status");

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 真实 makePreview：text.replace(/\s+/g, " ").trim()
function makePreview(text) {
    return text.replace(/\s+/g, " ").trim();
}

function itemTooltip(item) {
    const lines = [
        `Created: ${compactDate(item.createdat)}`,
        `Updated: ${compactDate(item.updatedat)}`,
        `Last used: ${item.lastusedat ? compactDate(item.lastusedat) : "never"}`,
        `Used: ${item.usagecount ?? 0} time(s)`,
    ];
    if (item.shortcut) lines.splice(3, 0, `Shortcut: ${item.shortcut}`);
    return lines.join("\n");
}

function renderSortControl() {
    const searching = isSearching();
    sortGroupEl.classList.toggle("disabled", searching);
    sortGroupEl.querySelectorAll("[data-sort]").forEach((btn) => {
        const active = !searching && btn.dataset.sort === state.sortKey;
        btn.classList.toggle("active", active);
        btn.disabled = searching;
        btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    // 搜索态亮起「相关度」图标；浏览态隐藏（不靠文字告知当前排序）
    sortRelevanceEl.classList.toggle("hidden", !searching);
}

function renderChips() {
    const summaries = getTagSummaries(DATA);
    untaggedCountEl.textContent = String(DATA.filter((item) => normalizeTagList(item.tags).length === 0).length);
    untaggedChipEl.classList.toggle("active", state.untaggedOnly);
    tagChipsEl.innerHTML = summaries
        .map((s) => {
            const active = state.selectedTags.some((t) => t.toLowerCase() === s.tag.toLowerCase());
            return `<button type="button" class="mm-chip${active ? " active" : ""}" data-tag="${escapeHtml(s.tag)}">
                <span>${escapeHtml(s.tag)}</span><span class="mm-chip-count">${s.count}</span>
            </button>`;
        })
        .join("");
}

function renderList() {
    const items = getVisibleItems();
    if (items.length === 0) {
        const msg = DATA.length === 0 ? "No common text yet" : "No matching text";
        listEl.innerHTML = `<div class="mm-empty">
            <i class="fa-regular fa-quote-left" style="font-size:20px;opacity:.6"></i>
            <div>${msg}</div>
        </div>`;
        return;
    }
    listEl.innerHTML = items
        .map((item) => {
            const tags = normalizeTagList(item.tags)
                .slice(0, 4)
                .map((tag) => `<span class="mm-item-tag">#${escapeHtml(tag)}</span>`)
                .join("");
            const usage = item.usagecount ?? 0;
            const updated = relTime(item.updatedat);
            return `<div class="mm-item${item.id === state.detailId ? " selected" : ""}" data-id="${item.id}"
                    title="${escapeHtml(itemTooltip(item))}">
                <div class="mm-item-pin-col">${item.pinned ? '<i class="fa-solid fa-thumbtack"></i>' : ""}</div>
                <div class="mm-item-main">
                    <div class="mm-item-title">${escapeHtml(item.title)}</div>
                    <div class="mm-item-preview">${escapeHtml(makePreview(item.text))}</div>
                    ${tags ? `<div class="mm-item-tags">${tags}</div>` : ""}
                </div>
                <div class="mm-item-meta">
                    <span class="mm-item-usage${usage === 0 ? " zero" : ""}" title="Used ${usage} time(s)">
                        <i class="fa-solid fa-repeat" aria-hidden="true"></i>${usage}
                    </span>
                    <span class="mm-item-updated" title="Updated ${item.updatedat ? compactDate(item.updatedat) : "never"}">
                        <i class="fa-regular fa-clock" aria-hidden="true"></i>${updated === "never" ? "—" : updated}
                    </span>
                </div>
                <button type="button" class="mm-item-insert" data-insert="${item.id}"
                        aria-label="Insert this common text into the editor" title="Insert into editor">
                    <i class="fa-regular fa-paste"></i>
                </button>
            </div>`;
        })
        .join("");
}

function renderDetail() {
    const item = DATA.find((it) => it.id === state.detailId) ?? null;
    if (item == null) {
        detailEl.innerHTML = `<div class="md-detail-empty">
            <i class="fa-regular fa-square"></i>
            <div>No item selected — click a row to edit</div>
            <div style="font-size:11px;opacity:.75">Enter on a row also opens it</div>
        </div>`;
        return;
    }
    const summaries = getTagSummaries(DATA);
    const detailTags = new Set(normalizeTagList(item.tags).map((t) => t.toLowerCase()));
    const tagHtml = summaries.length
        ? `<div class="md-detail-tag-list">${summaries
              .map((s) => {
                  const active = detailTags.has(s.tag.toLowerCase());
                  return `<button type="button" class="mm-chip${active ? " active" : ""}" data-detail-tag="${escapeHtml(s.tag)}">
                      <span>${escapeHtml(s.tag)}</span><span class="mm-chip-count">${s.count}</span>
                  </button>`;
              })
              .join("")}</div>`
        : `<div style="font-size:11px;color:var(--muted)">No tags yet — type <code>#tag</code> in Text to create one</div>`;

    // 详情底部新增一行只读元信息 —— 图标优先，完整语义走 title/aria-label。
    // 真实组件该位置只有自动保存状态 + 删除按钮，落地时把这一组插在它左侧。
    const metaLine = `<span class="meta-group" title="Created ${compactDate(item.createdat)}">
            <i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>${compactDate(item.createdat)}
        </span>
        <span class="sep"></span>
        <span class="meta-group" title="Updated ${compactDate(item.updatedat)}">
            <i class="fa-solid fa-pen" aria-hidden="true"></i>${compactDate(item.updatedat)}
        </span>
        <span class="sep"></span>
        <span class="meta-group" title="Last used ${item.lastusedat ? compactDate(item.lastusedat) : "never"}">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>${item.lastusedat ? relTime(item.lastusedat) : "—"}
        </span>
        <span class="sep"></span>
        <span class="meta-group" title="Used ${item.usagecount ?? 0} time(s)">
            <i class="fa-solid fa-repeat" aria-hidden="true"></i>${item.usagecount ?? 0}
        </span>`;

    detailEl.innerHTML = `
        <div class="md-detail-head">
            <input class="md-detail-title-input" id="detailTitle" value="${escapeHtml(item.title)}"
                   placeholder="Title (optional — auto-derived from text)" spellcheck="false" />
            <button type="button" class="pin-btn${item.pinned ? " active" : ""}" id="detailPin"
                    title="${item.pinned ? "Unpin this text" : "Pin this text to the top of the list"}">
                <i class="fa-solid fa-thumbtack"></i>
            </button>
        </div>
        <textarea class="md-detail-body" id="detailBody" spellcheck="false"
                  placeholder="Text to insert — type #tag inline to tag this item">${escapeHtml(item.text)}</textarea>
        <div class="md-detail-tags">
            <div class="md-detail-tags-head">
                <span>All tags</span>
                <span class="hint">${summaries.length} tags · click to toggle in Text</span>
            </div>
            ${tagHtml}
        </div>
        <div class="md-detail-footer">
            <button class="mm-btn" title="Send to focused terminal"><i class="fa-regular fa-paper-plane"></i> Send</button>
            <button class="mm-btn" title="Copy this text"><i class="fa-regular fa-copy"></i> Copy</button>
            <button class="mm-btn" id="insertDetail" title="Insert into editor at caret">
                <i class="fa-solid fa-arrow-up"></i> Insert
            </button>
            <div class="spacer"></div>
            <span class="md-detail-save">${metaLine}</span>
            <button type="button" class="delete-btn" id="deleteItem" title="Delete this text">
                <i class="fa-regular fa-trash-can"></i>
            </button>
        </div>`;

    document.getElementById("detailPin").addEventListener("click", () => {
        item.pinned = !item.pinned;
        renderAll();
    });
    document.getElementById("deleteItem").addEventListener("click", () => {
        const index = DATA.findIndex((it) => it.id === item.id);
        if (index >= 0) DATA.splice(index, 1);
        state.detailId = DATA[0]?.id ?? null;
        setStatus("Deleted", "ok");
        renderAll();
    });
    document.getElementById("insertDetail").addEventListener("click", () => {
        // 真实实现会调 recordCommonTextUse：插入/发送计数，复制不计数（落地时要补齐这两个写入点）
        item.lastusedat = Date.now();
        item.usagecount = (item.usagecount ?? 0) + 1;
        setStatus("Inserted · usage +1", "ok");
        renderAll();
    });
    document.getElementById("detailBody").addEventListener("input", (event) => {
        item.text = event.currentTarget.value;
        item.updatedat = Date.now();
        renderList();
    });
    document.getElementById("detailTitle").addEventListener("input", (event) => {
        item.title = event.currentTarget.value;
        item.updatedat = Date.now();
        renderList();
    });
    detailEl.querySelectorAll("[data-detail-tag]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const tag = btn.dataset.detailTag;
            const tags = normalizeTagList(item.tags);
            const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
            item.tags = has ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag];
            item.updatedat = Date.now();
            renderAll();
        });
    });
}

function renderAll() {
    renderSortControl();
    renderChips();
    renderList();
    renderDetail();
}

function setStatus(text, kind) {
    state.status = text;
    statusEl.textContent = text;
    statusEl.className = "mm-status" + (kind ? ` ${kind}` : "");
}

/* ---------- 事件 ---------- */
sortGroupEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-sort]");
    if (btn == null || isSearching()) return;
    state.sortKey = btn.dataset.sort;
    try {
        localStorage.setItem(SORT_STORAGE_KEY, state.sortKey);
    } catch (err) {
        /* localStorage 不可用时忽略，仅本次会话生效 */
    }
    renderList();
    renderSortControl();
});

searchInputEl.addEventListener("input", () => {
    state.manualQuery = searchInputEl.value;
    searchWrapEl.classList.toggle("has-value", state.manualQuery !== "");
    renderAll();
});

document.getElementById("searchClear").addEventListener("click", () => {
    searchInputEl.value = "";
    state.manualQuery = "";
    searchWrapEl.classList.remove("has-value");
    renderAll();
});

untaggedChipEl.addEventListener("click", () => {
    state.untaggedOnly = !state.untaggedOnly;
    if (state.untaggedOnly) state.selectedTags = [];
    renderAll();
});

tagChipsEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-tag]");
    if (btn == null) return;
    const tag = btn.dataset.tag;
    const exists = state.selectedTags.some((t) => t.toLowerCase() === tag.toLowerCase());
    state.selectedTags = exists
        ? state.selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase())
        : [...state.selectedTags, tag];
    if (state.selectedTags.length > 0) state.untaggedOnly = false;
    renderAll();
});

listEl.addEventListener("click", (event) => {
    const insertBtn = event.target.closest("[data-insert]");
    if (insertBtn != null) {
        event.stopPropagation();
        const item = DATA.find((it) => it.id === insertBtn.dataset.insert);
        if (item != null) {
            item.lastusedat = Date.now();
            item.usagecount = (item.usagecount ?? 0) + 1;
            setStatus("Inserted · usage +1", "ok");
            renderAll();
        }
        return;
    }
    const row = event.target.closest("[data-id]");
    if (row == null) return;
    state.detailId = row.dataset.id;
    setStatus("");
    renderAll();
});

document.getElementById("clearBtn").addEventListener("click", () => {
    const composer = document.getElementById("composer");
    composer.value = "";
    setStatus("");
});

document.getElementById("addBtn").addEventListener("click", () => {
    const id = `ct-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    // 镜像真实行为：upsertCommonTextItem 后紧跟 recordCommonTextUse，所以新建条目
    // 的 usagecount 从 1 起、lastusedat=now（这也是「使用次数」口径要一起讨论的原因）。
    DATA.unshift({
        id,
        title: "Untitled text",
        text: "",
        shortcut: "",
        tags: [],
        pinned: false,
        createdat: now,
        updatedat: now,
        lastusedat: now,
        usagecount: 1,
    });
    state.detailId = id;
    renderAll();
    setStatus("Added to top", "ok");
});

document.getElementById("filterBtn").addEventListener("click", (event) => {
    const composer = document.getElementById("composer");
    const btn = event.currentTarget;
    const active = btn.classList.toggle("active");
    if (active && composer.value.trim() !== "") {
        state.manualQuery = composer.value.trim();
        searchInputEl.value = state.manualQuery;
        searchWrapEl.classList.add("has-value");
    } else {
        state.manualQuery = "";
        searchInputEl.value = "";
        searchWrapEl.classList.remove("has-value");
    }
    renderAll();
});

document.getElementById("themeSwitch").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-theme-val]");
    if (btn == null) return;
    document.body.dataset.theme = btn.dataset.themeVal;
    document.querySelectorAll("#themeSwitch button").forEach((el) => {
        el.classList.toggle("active", el === btn);
    });
});

/* ---------- 启动 ---------- */
(function boot() {
    let saved = null;
    try {
        saved = localStorage.getItem(SORT_STORAGE_KEY);
    } catch (err) {
        saved = null;
    }
    if (saved != null && SORT_OPTIONS.some((opt) => opt.key === saved)) {
        state.sortKey = saved;
    } else {
        state.sortKey = DEFAULT_SORT;
    }
    renderAll();
})();
