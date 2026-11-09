// 数据字段与真实 CommonTextItem（commontext-model.ts）逐字段对齐：
// id / title / text / shortcut / tags / pinned / createdat / updatedat / lastusedat / usagecount
// 覆盖全部 5 个新鲜度档位 + 「建好后从未编辑过」（updatedat === createdat）这个边界。

function minutesAgo(n) {
    return Date.now() - n * 60 * 1000;
}
function hoursAgo(n) {
    return Date.now() - n * 60 * 60 * 1000;
}
function daysAgo(n) {
    return Date.now() - n * 24 * 60 * 60 * 1000;
}

const DATA = [
    // 1 档：< 1h
    {
        id: "ct-1",
        title: "Support reply · reproduced",
        text: "Hi, we reproduced the issue. A fix is expected today; I will update this ticket once it ships.",
        tags: ["support"],
        pinned: true,
        createdat: daysAgo(52),
        updatedat: minutesAgo(12),
        lastusedat: minutesAgo(6),
        usagecount: 16,
    },
    // 2 档：< 1d
    {
        id: "ct-2",
        title: "Daily report",
        text: "Done today:\n- \n\nPlan tomorrow:\n- ",
        tags: ["email", "ops"],
        pinned: true,
        createdat: daysAgo(38),
        updatedat: hoursAgo(5),
        lastusedat: minutesAgo(42),
        usagecount: 24,
    },
    // 3 档：< 7d
    {
        id: "ct-3",
        title: "Deploy checklist",
        text: "1. Tag release\n2. Build all platforms\n3. Smoke test\n4. Announce",
        tags: ["ops"],
        pinned: false,
        createdat: daysAgo(6),
        updatedat: daysAgo(2),
        lastusedat: hoursAgo(3),
        usagecount: 9,
    },
    // 4 档：< 30d
    {
        id: "ct-4",
        title: "Weekly report outline",
        text: "Highlights\nRisks\nNext week",
        tags: ["email"],
        pinned: false,
        createdat: daysAgo(21),
        updatedat: daysAgo(12),
        lastusedat: hoursAgo(26),
        usagecount: 3,
    },
    // 5 档：>= 30d
    {
        id: "ct-5",
        title: "Handoff note",
        text: "Current state:\nBlocked on:\nNext owner:",
        tags: [],
        pinned: false,
        createdat: daysAgo(96),
        updatedat: daysAgo(45),
        lastusedat: undefined,
        usagecount: 0,
    },
    // 边界：建好后从未编辑过（updatedat === createdat），要能和 5 档区分开
    {
        id: "ct-6",
        title: "Meeting notes skeleton",
        text: "Attendees:\nTopics:\nDecisions:\nOwners:",
        tags: [],
        pinned: false,
        createdat: daysAgo(40),
        updatedat: daysAgo(40),
        lastusedat: hoursAgo(70),
        usagecount: 2,
    },
];

/* ---------- 时间格式化 ----------
   真实仓库已有 formatSessionRelativeTime / formatSessionDateCompact（aisessions/utils.ts），
   这里照它们的输出口径复刻，落地时直接复用，不另写一套。 */
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

/* ============================================================
   新鲜度编码 —— 与 frontend/app/view/aisessions/utils.ts 的口径一致
   ============================================================ */

/** 1 = 最新鲜，5 = 最陈旧。阈值照抄 freshnessLevel()：<1h / <1d / <7d / <30d / >=30d */
function freshnessLevel(ts, now = Date.now()) {
    if (!ts) return 5;
    const elapsed = Math.max(0, now - ts);
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;
    if (elapsed < hour) return 1;
    if (elapsed < day) return 2;
    if (elapsed < 7 * day) return 3;
    if (elapsed < 30 * day) return 4;
    return 5;
}

/** 照抄 session-row.tsx:63 的 RecencyFillByLevel（索引 = level - 1） */
const RecencyFillScales = {
    repo: ["100%", "62%", "32%", "15%", "6%"],
    tuned: ["100%", "68%", "44%", "26%", "12%"],
    // 4 档合并：既然 26px 里 4/5 档本来就分不开，就诚实地只留 4 档（>=7 天全算「旧」）。
    quad: ["100%", "66%", "33%", "12%"],
};

/** 档位 → 填充宽度。quad 把第 5 档并进第 4 档（两档同宽，就是我们想要的语义）。 */
function barWidth(scale, level) {
    const vals = RecencyFillScales[scale];
    const idx = scale === "quad" ? Math.min(level, vals.length) - 1 : level - 1;
    return vals[Math.max(0, Math.min(idx, vals.length - 1))];
}

/** B 变体的段数：5 档 → 5..1 段 */
const SegCountByLevel = [5, 4, 3, 2, 1];

/**
 * E HeatCell 方块的填充高度 / 浓度（索引 = level - 1）。
 * 1 档满格 + 满浓度，5 档只剩一格底。高度与浓度同向变化 = 双通道，
 * 色弱用户也能靠「填了多少」读出来。
 */
const HeatFillByLevel = ["100%", "84%", "66%", "48%", "30%"];
const HeatOpacityByLevel = [1, 0.85, 0.72, 0.6, 0.5];

/** 详情页脚的档位词（不给具体时间，只给量级） */
const LevelWord = ["Fresh", "Recent", "This week", "This month", "Stale"];

/**
 * 「建好后从未编辑过」是一个独立语义，不是第五档。
 * 真实数据里 createdat 与 updatedat 在建条时都是同一个 now（commontext-model.ts:647-648），
 * 所以严格相等即可判定。
 */
function isNeverEdited(item) {
    return (item.updatedat ?? 0) === (item.createdat ?? 0);
}

function updateTitle(item) {
    return `Updated ${relTime(item.updatedat)} · ${compactDate(item.updatedat)}`;
}

function updatedLabel(item) {
    return isNeverEdited(item) ? "Never edited since created" : `Updated ${relTime(item.updatedat)}`;
}

/* ---- 四个变体的 markup 生成器 ---- */

function markText(item) {
    if (isNeverEdited(item)) {
        return `<span class="fh-text"><i class="fa-regular fa-clock" aria-hidden="true"></i>—</span>`;
    }
    return `<span class="fh-text"><i class="fa-regular fa-clock" aria-hidden="true"></i>${relTime(item.updatedat)}</span>`;
}

function markBar(item, scale = state.barScale) {
    const ghost = isNeverEdited(item);
    const lv = ghost ? 5 : freshnessLevel(item.updatedat);
    const width = ghost ? "0%" : barWidth(scale, lv);
    return `<span class="fh-bar${ghost ? " is-ghost" : ""}"><span style="width:${width}"></span></span>`;
}

function markSeg(item) {
    const ghost = isNeverEdited(item);
    const on = ghost ? 0 : SegCountByLevel[freshnessLevel(item.updatedat) - 1];
    const segs = Array.from({ length: 5 }, (_, i) => `<span class="${i < on ? "on" : ""}"></span>`).join("");
    return `<span class="fh-seg${ghost ? " is-ghost" : ""}">${segs}</span>`;
}

function markDot(item) {
    if (isNeverEdited(item)) return `<span class="fh-dot is-ghost"></span>`;
    return `<span class="fh-dot lv${freshnessLevel(item.updatedat)}"></span>`;
}

/** D 纯色方块：只有颜色一个通道 */
function markSq(item) {
    if (isNeverEdited(item)) return `<span class="fh-sq is-ghost"></span>`;
    return `<span class="fh-sq lv${freshnessLevel(item.updatedat)}"></span>`;
}

/** E HeatCell 方块：颜色 + 填充高度双通道 */
function markHeat(item) {
    if (isNeverEdited(item)) return `<span class="fh-heat is-ghost"><span></span></span>`;
    const lv = freshnessLevel(item.updatedat);
    return `<span class="fh-heat lv${lv}"><span style="height:${HeatFillByLevel[lv - 1]};opacity:${
        HeatOpacityByLevel[lv - 1]
    }"></span></span>`;
}

function markUpdate(item, variant) {
    switch (variant) {
        case "bar":
            return markBar(item);
        case "seg":
            return markSeg(item);
        case "dot":
            return markDot(item);
        case "sq":
            return markSq(item);
        case "heat":
            return markHeat(item);
        case "text":
        default:
            return markText(item);
    }
}

/** 图形外面包一层无障碍语义：纯 title 对读屏不稳，必须给 role + aria-label。 */
function graphical(glyph, item, variant, withHint) {
    if (variant === "text") return glyph;
    const label = updatedLabel(item);
    const hint = withHint ? ` title="${escapeHtml(updateTitle(item))}"` : "";
    return `<span role="img" aria-label="${escapeHtml(label)}"${hint} style="display:inline-flex;align-items:center">${glyph}</span>`;
}

/* ---------- 状态 ---------- */
const state = {
    listVariant: "text",
    detailVariant: "text",
    barScale: "repo",
    sortKey: "updated-desc",
    query: "",
    detailId: "ct-1",
    showHoverHint: true,
};

/**
 * 直接分享某个变体： `index.html#list=bar&detail=meter`。
 * 评审时不用每次手动点开关，也方便截图对齐。
 */
function applyHashState() {
    const raw = window.location.hash.replace(/^#/, "");
    if (raw === "") return;
    const params = new URLSearchParams(raw);
    const list = params.get("list");
    const detail = params.get("detail");
    const scale = params.get("scale");
    const hint = params.get("hint");
    if (["text", "bar", "seg", "dot", "sq", "heat"].includes(list)) state.listVariant = list;
    if (["text", "meter", "stamp"].includes(detail)) state.detailVariant = detail;
    if (["repo", "tuned", "quad"].includes(scale)) state.barScale = scale;
    if (hint === "0") state.showHoverHint = false;
}

/* ---------- DOM ---------- */
const listEl = document.getElementById("listEl");
const detailEl = document.getElementById("detailPane");
const searchInputEl = document.getElementById("searchInput");
const tagChipsEl = document.getElementById("tagChips");
const untaggedChipEl = document.getElementById("untaggedChip");
const untaggedCountEl = document.getElementById("untaggedCount");
const statusEl = document.getElementById("status");
const specimenEl = document.getElementById("specimen");

function escapeHtml(value) {
    return String(value).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
}

function makePreview(text) {
    return text.replace(/\s+/g, " ").trim();
}

function normalizeTagList(tags) {
    return (Array.isArray(tags) ? tags : []).map((t) => String(t).trim()).filter(Boolean);
}

/* ---------- 排序（真实：pinned 在前 → 用户选 key → updatedat → title） ---------- */
function sortItems(items, key) {
    const arr = [...items];
    arr.sort((a, b) => {
        if ((a.pinned ?? false) !== (b.pinned ?? false)) return a.pinned ? -1 : 1;
        let primary = 0;
        switch (key) {
            case "lastused-desc":
                primary = (b.lastusedat ?? 0) - (a.lastusedat ?? 0);
                break;
            case "usage-desc":
                primary = (b.usagecount ?? 0) - (a.usagecount ?? 0);
                break;
            case "created-desc":
                primary = (b.createdat ?? 0) - (a.createdat ?? 0);
                break;
            case "updated-desc":
            default:
                primary = (b.updatedat ?? 0) - (a.updatedat ?? 0);
                break;
        }
        if (primary !== 0) return primary;
        const updated = (b.updatedat ?? 0) - (a.updatedat ?? 0);
        if (updated !== 0) return updated;
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    return arr;
}

function getVisibleItems() {
    let items = DATA;
    const q = state.query.trim().toLowerCase();
    if (q !== "") {
        items = items.filter(
            (it) => it.title.toLowerCase().includes(q) || it.text.toLowerCase().includes(q)
        );
    }
    return sortItems(items, state.sortKey);
}

/* ---------- 渲染 ---------- */
function renderList() {
    const items = getVisibleItems();
    if (items.length === 0) {
        listEl.innerHTML = `<div class="mm-empty"><i class="fa-regular fa-quote-left"></i><div>No matching text</div></div>`;
        return;
    }
    listEl.innerHTML = items
        .map((item) => {
            const tags = normalizeTagList(item.tags)
                .slice(0, 4)
                .map((t) => `<span class="mm-item-tag">#${escapeHtml(t)}</span>`)
                .join("");
            const usage = item.usagecount ?? 0;
            const glyph = graphical(markUpdate(item, state.listVariant), item, state.listVariant, state.showHoverHint);
            return `<div class="mm-item${item.id === state.detailId ? " selected" : ""}" data-id="${item.id}">
                <div class="mm-item-pin-col">${item.pinned ? '<i class="fa-solid fa-thumbtack"></i>' : ""}</div>
                <div class="mm-item-main">
                    <div class="mm-item-title">${escapeHtml(item.title)}</div>
                    <div class="mm-item-preview">${escapeHtml(makePreview(item.text))}</div>
                    ${tags ? `<div class="mm-item-tags">${tags}</div>` : ""}
                </div>
                <div class="mm-item-meta">
                    <div class="mm-meta-stack">
                        <span class="mm-item-usage${usage === 0 ? " zero" : ""}" title="Used ${usage} time(s)">
                            <i class="fa-solid fa-repeat" aria-hidden="true"></i>${usage}
                        </span>
                        <span data-commontext-updated="">${glyph}</span>
                    </div>
                    <button type="button" class="mm-item-insert" data-insert="${item.id}"
                            aria-label="Insert this common text into the editor" title="Insert into editor">
                        <i class="fa-regular fa-paste"></i>
                    </button>
                </div>
            </div>`;
        })
        .join("");
}

function detailMetaMarkup(item) {
    const created = `<span title="Created ${compactDate(item.createdat, undefined)}">
            <i class="fa-regular fa-calendar-plus" aria-hidden="true"></i>${compactDate(item.createdat)}
        </span>`;

    let updated;
    if (state.detailVariant === "stamp") {
        updated = `<span title="Updated ${relTime(item.updatedat)}">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>${compactDate(item.updatedat)}
            </span>`;
    } else if (state.detailVariant === "meter") {
        const ghost = isNeverEdited(item);
        const word = ghost ? "Never edited" : LevelWord[freshnessLevel(item.updatedat) - 1];
        const segs = markSeg(item).replace('class="fh-seg', 'class="fh-seg');
        const hint = state.showHoverHint ? ` title="${escapeHtml(updateTitle(item))}"` : "";
        updated = `<span role="img" aria-label="${escapeHtml(updatedLabel(item))}"${hint}>
                <i class="fa-solid fa-pen" aria-hidden="true"></i><span class="fh-meter">${segs}<span class="fh-meter-word">${word}</span></span>
            </span>`;
    } else {
        updated = `<span title="Updated ${compactDate(item.updatedat)}">
                <i class="fa-solid fa-pen" aria-hidden="true"></i>${isNeverEdited(item) ? "—" : relTime(item.updatedat)}
            </span>`;
    }

    const lastused = `<span title="Last used ${item.lastusedat ? compactDate(item.lastusedat) : "never"}">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>${item.lastusedat ? relTime(item.lastusedat) : "never"}
        </span>`;

    const usage = `<span data-commontext-detail-usage="${item.usagecount ?? 0}" title="Used ${item.usagecount ?? 0} time(s)">
            <i class="fa-solid fa-repeat" aria-hidden="true"></i>${item.usagecount ?? 0}
        </span>`;

    return `<div class="md-detail-meta">${created}${updated}${lastused}${usage}</div>`;
}

function renderDetail() {
    const item = DATA.find((it) => it.id === state.detailId) ?? null;
    if (item == null) {
        detailEl.innerHTML = `<div class="md-detail-empty">
            <i class="fa-regular fa-square"></i>
            <div>No item selected — click a row to edit</div>
        </div>`;
        return;
    }
    const activeTags = new Set(normalizeTagList(item.tags).map((t) => t.toLowerCase()));
    const allTags = [...new Set(DATA.flatMap((it) => normalizeTagList(it.tags)))].sort();
    const tagHtml = allTags.length
        ? `<div class="md-detail-tag-list">${allTags
              .map((tag) => {
                  const active = activeTags.has(tag.toLowerCase());
                  const count = DATA.filter((it) =>
                      normalizeTagList(it.tags).some((t) => t.toLowerCase() === tag.toLowerCase())
                  ).length;
                  return `<button type="button" class="mm-chip${active ? " active" : ""}" data-detail-tag="${escapeHtml(tag)}">
                      <span>${escapeHtml(tag)}</span><span class="mm-chip-count">${count}</span>
                  </button>`;
              })
              .join("")}</div>`
        : `<div class="dim" style="font-size:11px">No tags yet — type <code>#tag</code> in Text to create one</div>`;

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
                <span class="hint">${allTags.length} tags · click to toggle</span>
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
            ${detailMetaMarkup(item)}
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
        setStatus("Deleted");
        renderAll();
    });
    document.getElementById("insertDetail").addEventListener("click", () => {
        // 真实实现在这里调 recordCommonTextUse：只动 lastusedat / usagecount，不动 updatedat
        item.lastusedat = Date.now();
        item.usagecount = (item.usagecount ?? 0) + 1;
        setStatus("Inserted · usage +1");
        renderAll();
    });
    // 编辑正文 = upsertCommonTextItem，会 bump updatedat → 该行立刻跳到 1 档
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

function renderChips() {
    const count = DATA.filter((it) => normalizeTagList(it.tags).length === 0).length;
    untaggedCountEl.textContent = String(count);
    const counts = new Map();
    for (const item of DATA) {
        for (const tag of normalizeTagList(item.tags)) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    tagChipsEl.innerHTML = [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(
            ([tag, n]) =>
                `<button type="button" class="mm-chip"><span>${escapeHtml(tag)}</span><span class="mm-chip-count">${n}</span></button>`
        )
        .join("");
}

/* ---------- 放大标本 ---------- */
function renderSpecimen() {
    // 用真实时间点造 5 档 + 边界，避免依赖 DATA 的分布
    const rows = [
        { name: "1 档", desc: "12 分钟前", item: { createdat: daysAgo(30), updatedat: minutesAgo(12) } },
        { name: "2 档", desc: "5 小时前", item: { createdat: daysAgo(30), updatedat: hoursAgo(5) } },
        { name: "3 档", desc: "2 天前", item: { createdat: daysAgo(30), updatedat: daysAgo(2) } },
        { name: "4 档", desc: "12 天前", item: { createdat: daysAgo(60), updatedat: daysAgo(12) } },
        { name: "5 档", desc: "45 天前", item: { createdat: daysAgo(90), updatedat: daysAgo(45) } },
        { name: "—", desc: "从未编辑", item: { createdat: daysAgo(40), updatedat: daysAgo(40) } },
    ];

    const head = `<div class="specimen-head">
        <span>档位</span>
        <span>当前变体 ×1</span>
        <span>A 条 ×4</span>
        <span>B 格 ×4</span>
        <span>C 点 ×4</span>
        <span>D 方块 ×4</span>
        <span>E 热力方块 ×4</span>
    </div>`;

    const body = rows
        .map((row) => {
            const live = markUpdate(row.item, state.listVariant);
            return `<div class="specimen-row">
                <span class="sp-name"><b>${row.name}</b> · ${row.desc}</span>
                <span class="sp-true">${live}</span>
                <div class="sp-cell"><span class="zoom4">${markBar(row.item)}</span></div>
                <div class="sp-cell"><span class="zoom4">${markSeg(row.item)}</span></div>
                <div class="sp-cell"><span class="zoom4">${markDot(row.item)}</span></div>
                <div class="sp-cell"><span class="zoom4">${markSq(row.item)}</span></div>
                <div class="sp-cell"><span class="zoom4">${markHeat(row.item)}</span></div>
            </div>`;
        })
        .join("");

    specimenEl.innerHTML = head + body;
    renderCalib();
}

/**
 * 编码方式对照表。统一回答一个问题：
 * **「4 档 = 12 天」和「5 档 = 45 天」在真实尺寸下能不能分开。**
 * 每行一种编码方式，给出 4 档与 5 档在 1× 与 5× 下的实际渲染。
 *
 * 5× 列不用 CSS transform —— 缩放会把绘制盒撑到相邻列上去（第一版就踩了这个坑）。
 * 直接按 5 倍真实像素写死尺寸，布局可预测。
 */
function renderCalib() {
    const lv4Item = { createdat: daysAgo(60), updatedat: daysAgo(12) };
    const lv5Item = { createdat: daysAgo(90), updatedat: daysAgo(45) };

    /** 按倍数直接出像素尺寸，避免 transform 溢列 */
    const big = (item, kind, k) => {
        const lv = freshnessLevel(item.updatedat);
        switch (kind) {
            case "bar":
                return `<span class="fh-bar" style="width:${26 * k}px;height:${5 * k}px"><span style="width:${barWidth(
                    "repo",
                    lv
                )}"></span></span>`;
            case "barTuned":
                return `<span class="fh-bar" style="width:${26 * k}px;height:${5 * k}px"><span style="width:${barWidth(
                    "tuned",
                    lv
                )}"></span></span>`;
            case "barQuad":
                return `<span class="fh-bar" style="width:${26 * k}px;height:${5 * k}px"><span style="width:${barWidth(
                    "quad",
                    lv
                )}"></span></span>`;
            case "seg":
                return `<span class="fh-seg" style="height:${5 * k}px;gap:${k}px">${Array.from(
                    { length: 5 },
                    (_, i) =>
                        `<span style="width:${4 * k}px;height:${5 * k}px;border-radius:${k}px" class="${
                            i < SegCountByLevel[lv - 1] ? "on" : ""
                        }"></span>`
                ).join("")}</span>`;
            case "dot":
                return `<span class="fh-dot lv${lv}" style="width:${6 * k}px;height:${6 * k}px"></span>`;
            case "sq":
                return `<span class="fh-sq lv${lv}" style="width:${10 * k}px;height:${10 * k}px;border-radius:${
                    2 * k
                }px"></span>`;
            case "heat":
                return `<span class="fh-heat lv${lv}" style="width:${12 * k}px;height:${12 * k}px;border-radius:${
                    3 * k
                }px"><span style="height:${HeatFillByLevel[lv - 1]};opacity:${HeatOpacityByLevel[lv - 1]}"></span></span>`;
            default:
                return "";
        }
    };

    const rows = [
        { name: "A 连续条 · 现有比例", kind: "bar", spec: "15% / 6%" },
        { name: "A 连续条 · 提议 A", kind: "barTuned", spec: "26% / 12%" },
        { name: "A 连续条 · 提议 B（4 档）", kind: "barQuad", spec: "12% / 12%" },
        { name: "B 信号格", kind: "seg", spec: "2 段 / 1 段" },
        { name: "C 色点", kind: "dot", spec: "muted / border" },
        { name: "D 纯色方块", kind: "sq", spec: "muted 80% / 45%" },
        { name: "E 热力方块", kind: "heat", spec: "填 46% / 28%" },
    ];

    const body = rows
        .map(
            (row) => `<div class="calib-row">
                <span class="calib-name">${row.name}</span>
                <span class="calib-cell">${big(lv4Item, row.kind, 1)}</span>
                <span class="calib-cell">${big(lv4Item, row.kind, 5)}</span>
                <span class="calib-cell">${big(lv5Item, row.kind, 1)}</span>
                <span class="calib-cell">${big(lv5Item, row.kind, 5)}</span>
                <span class="calib-nums">${row.spec}</span>
            </div>`
        )
        .join("");

    document.getElementById("calib").innerHTML = `
        <div class="calib-head">
            编码方式对照 · 检验点：<b>「4 档 = 12 天」和「5 档 = 45 天」在真实尺寸下能不能分开</b>
        </div>
        <div class="calib-head-row">
            <span>编码方式</span><span>4 档 1×</span><span>4 档 5×</span><span>5 档 1×</span><span>5 档 5×</span><span>档值 4 / 5</span>
        </div>
        ${body}`;
}

function renderAll() {
    renderChips();
    renderList();
    renderDetail();
    renderSpecimen();
}

function setStatus(text) {
    statusEl.textContent = text;
    window.setTimeout(() => {
        if (statusEl.textContent === text) statusEl.textContent = "";
    }, 1800);
}

/* ---------- 事件 ---------- */
document.getElementById("themeSwitch").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-theme-val]");
    if (btn == null) return;
    document.body.dataset.theme = btn.dataset.themeVal;
    document.querySelectorAll("#themeSwitch button").forEach((b) => b.classList.toggle("active", b === btn));
});

function bindSegmented(elId, onChange) {
    const el = document.getElementById(elId);
    el.addEventListener("click", (event) => {
        const btn = event.target.closest("button[data-v]");
        if (btn == null) return;
        setSegmented(el, btn);
        onChange(btn.dataset.v);
    });
}

function setSegmented(el, activeBtn) {
    el.querySelectorAll("button[data-v]").forEach((b) => {
        const on = b === activeBtn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
    });
}

/** 把 state 回写到开关上（hash 初始化用） */
function syncSwitches() {
    const listSw = document.getElementById("listVariant");
    const detailSw = document.getElementById("detailVariant");
    const scaleSw = document.getElementById("barScale");
    setSegmented(listSw, listSw.querySelector(`button[data-v="${state.listVariant}"]`));
    setSegmented(detailSw, detailSw.querySelector(`button[data-v="${state.detailVariant}"]`));
    setSegmented(scaleSw, scaleSw.querySelector(`button[data-v="${state.barScale}"]`));
    document.getElementById("showHoverHint").checked = state.showHoverHint;
}

bindSegmented("listVariant", (v) => {
    state.listVariant = v;
    renderList();
    renderSpecimen();
});
bindSegmented("barScale", (v) => {
    state.barScale = v;
    renderList();
    renderSpecimen();
});
bindSegmented("detailVariant", (v) => {
    state.detailVariant = v;
    renderDetail();
});

document.getElementById("sortGroup").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-sort]");
    if (btn == null) return;
    state.sortKey = btn.dataset.sort;
    document
        .querySelectorAll("#sortGroup button[data-sort]")
        .forEach((b) => b.classList.toggle("active", b === btn));
    renderList();
});

document.getElementById("showHoverHint").addEventListener("change", (event) => {
    state.showHoverHint = event.currentTarget.checked;
    renderAll();
});

searchInputEl.addEventListener("input", () => {
    state.query = searchInputEl.value;
    renderList();
});

listEl.addEventListener("click", (event) => {
    const insertBtn = event.target.closest("[data-insert]");
    if (insertBtn != null) {
        const item = DATA.find((it) => it.id === insertBtn.dataset.insert);
        if (item != null) {
            item.lastusedat = Date.now();
            item.usagecount = (item.usagecount ?? 0) + 1;
            setStatus(`Inserted · ${item.title}`);
            renderAll();
        }
        return;
    }
    const row = event.target.closest("[data-id]");
    if (row == null) return;
    state.detailId = row.dataset.id;
    renderList();
    renderDetail();
});

applyHashState();
syncSwitches();
renderAll();
