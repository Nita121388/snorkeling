/* AI Sessions 运行指示原型 —— 纯静态，无构建。
 *
 * 行 DOM 逐字段对齐 frontend/app/view/aisessions/session-row.tsx：
 *   .row > .row-lead(chevron / mark / 左侧状态点) + .row-main(.row-top, .row-meta, .snippet)
 *
 * 结构主张（用户澄清）：
 *   左侧保留（chevron / 星标 / 粗粒度状态点），
 *   右侧新增细粒度运行徽章（元信息行最右，ml-auto），带 label 与跑时。
 *
 * 两个维度独立可选：
 *   L 左侧状态点   L0 无 / L1 单点★ / L2 单点+静态环 / L3 三点 / L4 现状 4 点旋转
 *   R 右侧运行徽章 R0 无 / R1 chip★ / R2 胶囊 / R3 纯文本 / R4 扫光条 / R5 波形 / R6 三点 / R7 跑时优先
 */

// ── 数据：字段名对齐 SessionSummary ────────────────────────────────
const SESSIONS = [
    {
        title: "重构 session-row 的运行中图标",
        source: "codex",
        updated: "2m",
        recency: 96,
        messages: 42,
        size: "318 KB",
        snippet: "把四点旋转换成单点呼吸，并把位置从左侧孤立列移到标题行首，绿色换蓝色…",
        live: "working",
        runtime: "2min14s",
        phase: "thinking",
        chat: false,
        selected: true,
    },
    {
        title: "Trellis 任务树评审 + 门链对齐",
        source: "claude",
        updated: "18m",
        recency: 72,
        messages: 88,
        size: "1.2 MB",
        snippet: "G2 器具还没齐，prove 会直接拒；先把判据写成「命令 → 期望输出」再取件。",
        live: "working",
        runtime: "18min03s",
        phase: "tool",
        chat: true,
        selected: false,
    },
    {
        title: "wsh 远端安装超时排查",
        source: "codex",
        updated: "1h",
        recency: 48,
        messages: 31,
        size: "204 KB",
        snippet: "scp 到 ~/.snorkeling/bin/wsh 后版本号仍不匹配，怀疑是打包时漏了新二进制。",
        live: "done",
        runtime: "",
        phase: "none",
        chat: false,
        selected: false,
    },
    {
        title: "Common Text 云同步 transport 选型",
        source: "pi",
        updated: "3h",
        recency: 34,
        messages: 57,
        size: "512 KB",
        snippet: "先云盘目录，后自建服务；冲突粒度走行级自动合并 + 标记。",
        live: "idle",
        runtime: "",
        phase: "none",
        chat: false,
        selected: false,
    },
    {
        title: "Overview 看板 5 列常显回归",
        source: "claude",
        updated: "1d",
        recency: 18,
        messages: 64,
        size: "780 KB",
        snippet: "拖拽后列宽塌陷，怀疑是 snap 与 useLayoutEffect 的 rect 采样时序冲突。",
        live: "stale",
        runtime: "2h41min",
        phase: "unknown",
        chat: false,
        selected: false,
    },
];

// ── L：左侧状态点 ─────────────────────────────────────────────────
const LEFTS = {
    L0: {
        label: "L0 无",
        note: "左侧只有 chevron 与星标，状态完全交给右侧徽章。最干净，但扫视时左列没有锚点。",
        spec: ["左列", "chevron / 星标，无状态点"],
    },
    L1: {
        label: "L1 单点 ★",
        note: "6px 单点，working 时 1.6s 呼吸。粗粒度：只回答「活着 / 完事 / 闲着」，细粒度交给右侧徽章。",
        spec: ["左列", "6×6 单点，breathe 1.6s"],
        rec: true,
    },
    L2: {
        label: "L2 单点+静态环",
        note: "6px 实心点 + 一圈静态光环。零动画但比裸点更「有存在感」，适合不想让左列动起来的场景。",
        spec: ["左列", "14×14，core + halo，零动画"],
    },
    L3: {
        label: "L3 三点跳动",
        note: "即时通讯的「正在输入」语言。比旋转更易读成「活着」而非「载入中」，但在左列 20px 宽度里偏挤。",
        spec: ["左列", "3 × 3px 点，typing-bounce"],
    },
    L4: {
        label: "L4 现状 4 点旋转",
        note: "现状基线：4 个绿点方框整体 1s 旋转。animate-spin 在本仓的既定语义是「请求未完成」，语义错位。",
        spec: ["左列", "16×16，4 点，spin 1s"],
        warn: "loading 语义 ≠ 运行中",
    },
};

// ── R：右侧运行徽章 ───────────────────────────────────────────────
const RIGHTS = {
    R0: {
        label: "R0 无",
        note: "元信息行只保留来源 / 时间 / 消息数 / 大小，不显示运行徽章。用于 A/B 对照。",
        spec: ["右侧", "无"],
    },
    R1: {
        label: "R1 chip 完整 ★",
        note: "icon + 状态词（Working / Thinking / Tool: Bash）+ 跑时，15px 高带边框。信息最全：既回答「在不在跑」，也回答「跑到哪一步、跑了多久」。",
        spec: ["右侧", "15px chip，icon + label + 跑时"],
        rec: true,
    },
    R2: {
        label: "R2 胶囊无边框",
        note: "R1 的轻量版：淡底胶囊 + 4px 点 + 状态词，去掉边框与跑时。视觉重量介于裸点与 chip 之间。",
        spec: ["右侧", "15px 胶囊，点 + 状态词"],
    },
    R3: {
        label: "R3 纯文本",
        note: "完全不用图形，只写 `Working 2min`。零动画、零边框，与元信息同字号，密度最高。",
        spec: ["右侧", "纯文本，10px，零动画"],
        warn: "可能与元信息混为一类",
    },
    R4: {
        label: "R4 扫光条 + 文字",
        note: "20×2px 细轨道 + 来回扫的光块 + 状态词。高度只有 2px，是最不改变行高的一档。",
        spec: ["右侧", "2px 轨道 + 状态词，sweep 1.9s"],
    },
    R5: {
        label: "R5 波形条 + 文字",
        note: "4 根跳动竖条 + 状态词，传达「有输出在持续产生」。比圆点更有「活动量」感，但并发动画最多。",
        spec: ["右侧", "4 × 1.5px 条 + 状态词，eq-bounce"],
    },
    R6: {
        label: "R6 三点 + 文字",
        note: "3 个跳动点 + 状态词。typing 语义，比波形更轻，比单点更有「正在产出」的暗示。",
        spec: ["右侧", "3 × 3px 点 + 状态词，typing-bounce"],
    },
    R7: {
        label: "R7 跑时优先",
        note: "只显示跑时（`2min14s`）+ 一个 3px 呼吸点，不写状态词。最省宽度，适合窄面板。",
        spec: ["右侧", "3px 点 + 跑时，无状态词"],
    },
};

const LEFT_ORDER = Object.keys(LEFTS);
const RIGHT_ORDER = Object.keys(RIGHTS);

let stateOverride = null;
let leftKey = "L1";
let rightKey = "R1";
/** 真实左栏宽度范围 240–520，默认 320（aisessions.tsx:1673-1675）。 */
let panelWidth = 384;
/** 元信息行换行策略：wrap（现状，徽章放不下就换行）/ nowrap（强制单行 + 省略号）。 */
let wrapPolicy = "wrap";

function liveStateOf(session) {
    return stateOverride != null ? stateOverride : session.live;
}

function stateClass(state) {
    return state === "idle" ? " is-idle" : state === "done" ? " is-done" : state === "stale" ? " is-stale" : "";
}

// ── 图标 ──────────────────────────────────────────────────────────
const ICON_CHEVRON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>`;
const ICON_STAR = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2.4l1.7 3.5 3.9.5-2.8 2.7.7 3.8L8 11.1l-3.5 1.8.7-3.8L2.4 6.4l3.9-.5z"/></svg>`;
const ICON_SPARK = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.6l1.1 3.4L12.6 6l-3.5 1-1.1 3.4L6.9 7 3.4 6l3.5-1z"/><path d="M12.4 9.6l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z"/></svg>`;
const ICON_WRENCH = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M10.6 2.6a3.4 3.4 0 00-4.2 4.3l-3.6 3.6a1.4 1.4 0 002 2l3.6-3.6a3.4 3.4 0 004.3-4.2l-2 2-1.9-.5-.5-1.9z"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 8.4l3 3 6.2-6.6"/></svg>`;
const ICON_CLOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="5.4"/><path d="M8 5v3.2l2 1.4"/></svg>`;

/** 状态词 + 图标（与 agent-status-derive 的 agentStatusPresentation 一致） */
function presentation(state, phase) {
    switch (state) {
        case "working":
            if (phase === "tool") return { label: "Tool: Bash", icon: ICON_WRENCH };
            if (phase === "thinking") return { label: "Thinking", icon: ICON_SPARK };
            return { label: "Working", icon: ICON_SPARK };
        case "done":
            return { label: "Done", icon: ICON_CHECK };
        case "stale":
            return { label: "Stale", icon: ICON_CLOCK };
        case "idle":
            return { label: "Idle", icon: "" };
        default:
            return { label: "Working", icon: ICON_SPARK };
    }
}

// ── L 渲染 ────────────────────────────────────────────────────────
function renderLeft(key, state) {
    const cls = stateClass(state);
    switch (key) {
        case "L0":
            return "";
        case "L1":
            if (state === "none") return "";
            return `<span class="ld${cls} is-breathe" aria-hidden="true"></span>`;
        case "L2":
            if (state === "none") return "";
            return `<span class="ld-ring${cls}" aria-hidden="true"><span class="core"></span><span class="halo"></span></span>`;
        case "L3":
            if (state !== "working") return "";
            return `<span class="rb-dots" style="color:var(--agent-working)" aria-hidden="true"><span class="dots"><span></span><span></span><span></span></span></span>`;
        case "L4":
            if (state === "none") return "";
            return `<span class="ld-spin" aria-hidden="true"><span class="d1"></span><span class="d2"></span><span class="d3"></span><span class="d4"></span></span>`;
        default:
            return "";
    }
}

// ── R 渲染 ────────────────────────────────────────────────────────
function renderRight(key, state, session) {
    if (state === "none") return "";
    const cls = stateClass(state);
    const p = presentation(state, session.phase);
    const rt = state === "working" || state === "stale" ? session.runtime : "";

    switch (key) {
        case "R0":
            return "";
        case "R1": {
            const icon = p.icon ? `<i>${p.icon}</i>` : "";
            const runtime = rt ? `<span class="rt">${rt}</span>` : "";
            return `<span class="rb-chip${cls}${state === "working" ? " is-working" : ""}" aria-label="${p.label}">${icon}<span class="label">${p.label}</span>${runtime}</span>`;
        }
        case "R2":
            return `<span class="rb-pill${cls}"><span class="pip"></span><span class="label">${p.label}</span></span>`;
        case "R3": {
            const runtime = rt ? `<span class="rt">${rt}</span>` : "";
            return `<span class="rb-text${cls}">${p.label}${runtime}</span>`;
        }
        case "R4": {
            const runtime = rt ? `<span class="rt">${rt}</span>` : "";
            return `<span class="rb-sweep${cls}"><span class="track"><i></i></span><span class="label">${p.label}</span>${runtime}</span>`;
        }
        case "R5":
            return `<span class="rb-eq${cls}"><span class="bars"><span></span><span></span><span></span><span></span></span><span class="label">${p.label}</span></span>`;
        case "R6":
            return `<span class="rb-dots${cls}"><span class="dots"><span></span><span></span><span></span></span><span class="label">${p.label}</span></span>`;
        case "R7":
            return `<span class="rb-rt${cls}"><span class="tick"></span>${rt || p.label}</span>`;
        default:
            return "";
    }
}

// ── 行渲染 ────────────────────────────────────────────────────────
function sourceLabel(src) {
    return src === "codex" ? "codex" : src === "claude" ? "claude" : "pi";
}

function heatCell(title, pct) {
    return `<span class="heat" title="${title}"><i style="height:${pct}%"></i></span>`;
}

function renderRow(session, left, right, opts = {}) {
    const state = liveStateOf(session);
    const leftIcon = renderLeft(left, state);
    const rightIcon = renderRight(right, state, session);

    const leadSlot =
        leftIcon === ""
            ? ""
            : `<button class="lead-status" aria-label="Jump to live block" title="This session has a live block — click to jump">${leftIcon}</button>`;

    const metaSlot = rightIcon === "" ? "" : `<span class="meta-right">${rightIcon}</span>`;

    const chat = session.chat ? `<span class="chat-running"><span class="spin-icon"></span>GUI Chat</span>` : "";

    return `<div class="row${session.selected && opts.selected !== false ? " selected" : ""}">
    <div class="row-lead">
        <button class="lead-btn" aria-label="Expand sub-sessions">${ICON_CHEVRON}</button>
        <button class="lead-btn" aria-label="Mark session">${ICON_STAR}</button>
        ${leadSlot}
    </div>
    <div class="row-main">
        <div class="row-top">
            <span class="row-title">${session.title}</span>
            ${opts.actions === false ? "" : `<button class="row-action">Resume</button><button class="row-action">Copy</button>`}
        </div>
        <div class="row-meta" data-policy="${wrapPolicy}">
            <div class="meta-left">
                <span class="meta-src"><span class="src-dot ${session.source}"></span>${sourceLabel(session.source)}</span>
                ${chat}
                <span class="recency" title="Updated ${session.updated} ago">
                    <span class="recency-bar"><i style="width:${session.recency}%"></i></span>
                    <span>${session.updated}</span>
                </span>
                <span>Created 11-06 09:59</span>
                ${heatCell(`${session.messages} messages`, 80)}
                ${heatCell(session.size, 80)}
            </div>
            ${metaSlot}
        </div>
        <div class="snippet">${session.snippet}</div>
    </div>
</div>`;
}

function renderPanel(left, right, opts = {}) {
    const rows = SESSIONS.map((s) => renderRow(s, left, right, opts)).join("");
    const narrow = panelWidth <= 260 ? "true" : "false";
    return `<div class="panel-head">
        <div class="title">AI Sessions</div>
        <div class="search">搜索会话…</div>
    </div>
    <div class="list">${rows}</div>`;
}

// ── 右侧栏 ────────────────────────────────────────────────────────
function renderZoom(left, right) {
    const state = stateOverride === "none" ? "working" : (stateOverride ?? "working");
    const s = { ...SESSIONS[0], live: state };
    const l = renderLeft(left, state);
    const r = renderRight(right, state, s);
    const cell = (label, html) =>
        `<div class="cell"><span>${label}</span><div class="inner">${html === "" ? '<span style="color:var(--secondary-text);font-size:8px">—</span>' : html}</div></div>`;
    return cell("左侧状态点", l) + cell("右侧运行徽章", r);
}

function renderSpec(left, right) {
    const l = LEFTS[left];
    const r = RIGHTS[right];
    const rows = [...l.spec.map(([k, v]) => `<div><span class="k">左 · ${k}</span> · ${v}</div>`),
                  ...r.spec.map(([k, v]) => `<div><span class="k">右 · ${k}</span> · ${v}</div>`)].join("");
    const warns = [l.warn, r.warn].filter(Boolean).map((w) => `<div class="warn">! ${w}</div>`).join("");
    return rows + warns;
}

function renderNotes(left, right) {
    const items = [LEFTS[left].note, RIGHTS[right].note].map((n) => `<li>${n}</li>`).join("");
    return items;
}

// ── 全部对比 ──────────────────────────────────────────────────────
function renderAllLeft() {
    return LEFT_ORDER.map(
        (key) => `<div class="cellwrap">
        <h3>${LEFTS[key].label}</h3>
        <div class="hint">${LEFTS[key].note}</div>
        <div class="panel">${renderPanel(key, rightKey, { actions: false, selected: false })}</div>
    </div>`
    ).join("");
}

function renderAllRight() {
    return RIGHT_ORDER.map(
        (key) => `<div class="cellwrap">
        <h3>${RIGHTS[key].label}</h3>
        <div class="hint">${RIGHTS[key].note}</div>
        <div class="panel">${renderPanel(leftKey, key, { actions: false, selected: false })}</div>
    </div>`
    ).join("");
}

// ── 主渲染 ────────────────────────────────────────────────────────
function paint() {
    const mainPanel = document.getElementById("panel-main");
    mainPanel.dataset.narrow = panelWidth <= 260 ? "true" : "false";
    mainPanel.style.setProperty("--panel-w", `${panelWidth}px`);
    mainPanel.innerHTML = renderPanel(leftKey, rightKey);
    document.getElementById("main-caption").textContent =
        `${LEFTS[leftKey].label} + ${RIGHTS[rightKey].label}`;
    document.getElementById("legend-main").textContent =
        `${LEFTS[leftKey].note} ${RIGHTS[rightKey].note}`;
    document.getElementById("zoom").innerHTML = renderZoom(leftKey, rightKey);
    document.getElementById("spec").innerHTML = renderSpec(leftKey, rightKey);
    document.getElementById("notes").innerHTML = renderNotes(leftKey, rightKey);
    document.getElementById("allleft").innerHTML = renderAllLeft();
    document.getElementById("allright").innerHTML = renderAllRight();
    document.documentElement.dataset.state = stateOverride ?? "working";
}

// ── 控件 ──────────────────────────────────────────────────────────
function bindSeg(id, attr, onPick) {
    const root = document.getElementById(id);
    if (!root) return;
    root.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        root.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        onPick(btn.dataset[attr]);
    });
}

bindSeg("ctrl-left", "left", (v) => {
    leftKey = v;
    paint();
});

bindSeg("ctrl-right", "right", (v) => {
    rightKey = v;
    paint();
});

bindSeg("ctrl-state", "state", (v) => {
    stateOverride = v;
    paint();
});

bindSeg("ctrl-policy", "policy", (v) => {
    wrapPolicy = v;
    paint();
});

bindSeg("ctrl-width", "width", (v) => {
    panelWidth = Number(v);
    paint();
});

document.getElementById("ctrl-theme").addEventListener("click", (e) => {
    const html = document.documentElement;
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    e.currentTarget.textContent = next === "dark" ? "浅色" : "深色";
});

document.getElementById("ctrl-all").addEventListener("click", (e) => {
    const wrap = document.getElementById("allwrap");
    const stage = document.getElementById("stage");
    const showing = !wrap.hidden;
    wrap.hidden = showing;
    stage.hidden = !showing;
    e.currentTarget.textContent = showing ? "全部对比" : "回到单方案";
});

paint();
