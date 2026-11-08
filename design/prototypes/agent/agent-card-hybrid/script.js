// Agent Card 合体版：C 的行骨架 + D 的头像/引用块 + 右上角状态·收藏·放大
// 数据取自真实会话（Pi / 未指定 / 2026-11-03 11:21 → 11:24）。

const B = {
    provider: "Pi",
    glyph: "π",
    model: "未指定",
    title: "功能问题：列表编辑时文本位置抖动、样式变化，多个列表条目会相互影响",
    titleLong:
        "功能问题：列表编辑时文本位置抖动、样式变化，多个列表条目会相互影响；切换列表后残留 2px 位移，怀疑 contenteditable 行高继承。",
    source: "first_user_message",
    createdRel: "3 天前",
    createdAbs: "Nov 3, 2026 11:21",
    updatedRel: "2 分钟前",
    updatedAbs: "Nov 3, 2026 11:24",
    tags: [],
    note: "",
    sid: "3ce67d75-0df0-4f56-b5d4-90f102e97ca2",
};

const FILLED = {
    ...B,
    state: "done",
    tags: ["ui", "list-edit", "bug"],
    note: "编辑列表项时文本整体下移 2px，切换列表后残留；复现路径：空列表回车 → 输入中文 → 切走再切回。",
};

const STATUS = {
    idle: { short: "Idle", full: "Idle · 空闲" },
    working: { short: "Working", full: "Working · 正在执行" },
    done: { short: "Done", full: "Done · 本轮完成" },
    blocked: { short: "Blocked", full: "Blocked · 等待批准" },
    error: { short: "Error", full: "Error · 执行失败" },
};

// 文本简化：裸 snake_case → 可读短语（真实实现可复用 humanizeKey）
const SOURCE_LABEL = {
    first_user_message: "First message",
    auto: "Auto",
    manual: "Manual",
};

const state = {
    state: "idle",
    width: 340,
    collapsed: false,
    starred: false,
    theme: "dark",
};

/* ── 图标 ── */

function svg(body, size = 11) {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const I = {
    copy: svg('<rect x="5.6" y="5.6" width="7.4" height="7.4" rx="1.5"/><path d="M10.4 3.6H4.3A1.3 1.3 0 0 0 3 4.9v6.1"/>', 11),
    expand: svg('<path d="M9.6 2.6h3.8v3.8M6.4 13.4H2.6V9.6M13.4 2.6L8.9 7.1M2.6 13.4l4.5-4.5"/>', 11),
    cal: svg('<rect x="2.6" y="3.7" width="10.8" height="9.7" rx="1.6"/><path d="M2.6 6.7h10.8M5.6 2.5v2.4M10.4 2.5v2.4"/>'),
    clock: svg('<circle cx="8" cy="8" r="5.4"/><path d="M8 4.9V8l2.2 1.4"/>'),
    tag: svg('<path d="M8.5 2.6H13v4.5l-5.5 5.5-4.5-4.5z"/><circle cx="10.9" cy="4.8" r=".85" fill="currentColor" stroke="none"/>'),
    note: svg('<path d="M3.4 3.4h9.2M3.4 6.6h9.2M3.4 9.8h6.2"/>'),
    dots: svg('<circle cx="4" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>'),
    plus: svg('<path d="M8 3.6v8.8M3.6 8h8.8"/>', 10),
    sparkle: svg('<path d="M8 2.6l1 2.9 2.9 1-2.9 1L8 10.4 7 7.5 4.1 6.5l2.9-1z"/>', 11),
    edit: svg('<path d="M10.9 2.9l2.2 2.2-7.1 7.1-2.9.7.7-2.9z"/>', 10),
};

function starIcon(on) {
    return `<svg class="ic" width="12" height="12" viewBox="0 0 16 16" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M8 2.3l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.3l-3.52 1.85.68-3.93L2.3 6.45l3.95-.55z"/></svg>`;
}

/* ── 渲染 ── */

function row(icon, label, value, vClass = "", rowClass = "") {
    return `<div class="hc-row ${rowClass}">
        <span class="hc-ico">${icon}</span>
        <span class="hc-k">${label}</span>
        <span class="hc-v ${vClass}">${value}</span>
        <span class="hc-edit">${I.edit}</span>
    </div>`;
}

function renderCard(o = {}) {
    const st = STATUS[o.state ?? state.state];
    const data = o.data ?? B;
    const collapsed = o.collapsed ?? state.collapsed;
    const glyph = o.glyph ?? data.glyph;
    const emoji = o.emoji === true;
    const title = o.title ?? data.title;

    const tagsRow = data.tags.length
        ? row(I.tag, "Tags", data.tags.map((t) => `<span class="hc-tag">${t}</span>`).join(""), "tags", "is-tags")
        : row(I.tag, "Tags", '<span class="hc-dash">—</span>');

    const noteRow = data.note
        ? row(I.note, "Note", `<span title="${data.note}">${data.note}</span>`, "", "is-note")
        : row(I.note, "Note", '<span class="hc-dash">—</span>');

    return `<div class="hc-card st-${o.state ?? state.state} ${collapsed ? "is-collapsed" : ""}">
    <div class="hc-head">
        <div class="hc-avatar ${emoji ? "is-emoji" : ""}">${glyph}</div>
        <div class="hc-id">
            <span class="hc-name">${data.provider}</span>
            <span class="hc-sub"><span class="m">${data.model}</span><span class="sep">·</span><span title="Title source: ${data.source}">${SOURCE_LABEL[data.source] ?? data.source}</span></span>
        </div>
        <div class="hc-actions">
            <span class="hc-status" title="${st.full}"><span class="dot"></span>${st.short}</span>
            <button class="hc-icon ${state.starred ? "on" : ""}" data-act="star" title="${state.starred ? "取消收藏" : "收藏"}">${starIcon(state.starred)}</button>
            <button class="hc-icon" data-act="expand" title="放大编辑">${I.expand}</button>
        </div>
    </div>
    <div class="hc-title" title="${data.titleLong ?? data.title}">${title}</div>
    <div class="hc-rows">
        ${row(I.clock, "Updated", `<span class="strong" title="${data.updatedAbs}">${data.updatedRel}</span>`)}
        ${row(I.cal, "Created", `<span title="${data.createdAbs}">${data.createdRel}</span>`)}
        ${tagsRow}
        ${noteRow}
    </div>
    <div class="hc-foot">
        <button class="hc-add" data-act="noop">${I.plus} Add property</button>
        <div class="right">
            <button class="hc-icon" data-act="noop" title="AI auto-fill">${I.sparkle}</button>
            <span class="hc-sid" title="${data.sid}">${data.sid.slice(0, 8)}…${data.sid.slice(-4)}</span>
            <button class="hc-icon hc-copy" data-act="copy" title="Copy session id">${I.copy}</button>
        </div>
    </div>
</div>`;
}

/* ── 页面装配 ── */

const stageSlot = document.getElementById("stage-slot");
const gridStates = document.getElementById("grid-states");
const gridShapes = document.getElementById("grid-shapes");

function renderStage() {
    stageSlot.innerHTML = renderCard();
    // 卡高实测，让「高度对比」自己说实话
    const h = stageSlot.querySelector(".hc-card")?.offsetHeight;
    const el = document.getElementById("metric-hybrid");
    if (h != null && el != null) {
        el.textContent = `${h}px`;
        document.documentElement.dataset.cardHeight = String(h);
        const inline = document.getElementById("inline-hybrid");
        if (inline != null) {
            inline.textContent = `${h}px`;
        }
    }
}

function renderStates() {
    gridStates.innerHTML = ["idle", "working", "done", "blocked", "error"]
        .map(
            (s) => `<div class="cell" style="width:340px">
                <span class="cap">${STATUS[s].short.toLowerCase()}</span>
                ${renderCard({ state: s })}
            </div>`
        )
        .join("");
}

function renderShapes() {
    const cells = [
        { cap: "300px · 极限窄", style: "width:300px", opts: {} },
        { cap: "380px · 舒适宽", style: "width:380px", opts: {} },
        { cap: "填充态 · tags + note", style: "width:340px", opts: { state: "done", data: FILLED } },
        { cap: "折叠属性", style: "width:340px", opts: { collapsed: true } },
        { cap: "emoji 人格头像", style: "width:340px", opts: { glyph: "🦊", emoji: true } },
        { cap: "超长标题（2 行截断）", style: "width:340px", opts: { title: B.titleLong } },
    ];
    gridShapes.innerHTML = cells
        .map(
            (c) => `<div class="cell" style="${c.style}">
                <span class="cap">${c.cap}</span>
                ${renderCard(c.opts)}
            </div>`
        )
        .join("");
}

function renderAll() {
    renderStage();
    renderStates();
    renderShapes();
}

/* ── 交互 ── */

document.body.addEventListener("click", (e) => {
    const target = e.target.closest("[data-act]");
    if (target == null) {
        return;
    }
    const act = target.dataset.act;
    if (act === "star") {
        state.starred = !state.starred;
        renderAll();
    } else if (act === "copy") {
        navigator.clipboard?.writeText(B.sid).catch(() => {});
        target.classList.add("is-copied");
        setTimeout(() => target.classList.remove("is-copied"), 1200);
    }
});

document.getElementById("ctrl-state").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-state]");
    if (btn == null) {
        return;
    }
    state.state = btn.dataset.state;
    document.querySelectorAll("#ctrl-state button").forEach((b) => b.classList.toggle("active", b === btn));
    renderStage();
});

document.getElementById("ctrl-width").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-width]");
    if (btn == null) {
        return;
    }
    state.width = Number(btn.dataset.width);
    document.documentElement.style.setProperty("--card-w", `${state.width}px`);
    document.querySelectorAll("#ctrl-width button").forEach((b) => b.classList.toggle("active", b === btn));
});

const collapseBtn = document.getElementById("ctrl-collapse");
collapseBtn.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    collapseBtn.classList.toggle("on", state.collapsed);
    collapseBtn.textContent = state.collapsed ? "展开属性" : "折叠属性";
    renderStage();
});

const hoverBtn = document.getElementById("ctrl-hover");
hoverBtn.addEventListener("click", () => {
    const on = document.body.classList.toggle("force-hover");
    hoverBtn.classList.toggle("on", on);
});

const themeBtn = document.getElementById("ctrl-theme");
themeBtn.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    themeBtn.textContent = state.theme === "dark" ? "浅色" : "深色";
});

/* ── init（支持 ?state/width/theme/collapsed/hover 深链） ── */

const params = new URLSearchParams(location.search);

const qState = params.get("state");
if (qState != null && STATUS[qState] != null) {
    state.state = qState;
    document.querySelectorAll("#ctrl-state button").forEach((b) => {
        b.classList.toggle("active", b.dataset.state === qState);
    });
}

const qWidth = Number(params.get("width"));
if (qWidth === 300 || qWidth === 340 || qWidth === 380) {
    state.width = qWidth;
    document.querySelectorAll("#ctrl-width button").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.width) === qWidth);
    });
}

if (params.get("collapsed") === "1") {
    state.collapsed = true;
    collapseBtn.classList.add("on");
    collapseBtn.textContent = "展开属性";
}

if (params.get("hover") === "1") {
    document.body.classList.add("force-hover");
    hoverBtn.classList.add("on");
}

if (params.get("theme") === "light") {
    state.theme = "light";
    document.documentElement.dataset.theme = "light";
    themeBtn.textContent = "深色";
}

document.documentElement.style.setProperty("--card-w", `${state.width}px`);
renderAll();
