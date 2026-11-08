// Agent Card 美化方案集 · 渲染逻辑
// 数据取自真实会话（截图同一条）：Pi / deepseek-v4.1 / 2026-11-03 11:21 → 11:24。
// 每个 renderV* 只产出一张卡的 DOM，类名与真实组件保持可对应关系（见 README 镜像源）。

const S = {
    provider: "Pi",
    glyph: "π",
    model: "未指定",
    title: "功能问题：列表编辑时文本位置抖动、样式变化，多个列表条目会相互影响",
    titleSource: "first_user_message",
    createdAbs: "Nov 3, 2026 11:21",
    updatedAbs: "Nov 3, 2026 11:24",
    createdRel: "3 天前",
    updatedRel: "2 分钟前",
    tags: [],
    note: "",
    sid: "3ce67d75-0df0-4f56-b5d4-90f102e97ca2",
    stat: { dur: "32m", cost: "$0.014", ctx: "62k", cache: "99.7%", out: "5.4k" },
};

const state = {
    state: "idle",
    width: 360,
    theme: "dark",
    zoom: false,
    guides: false,
    starred: false,
    openB: true,
};

/* ── 图标：统一 16 格 stroke 图标，跟真实卡里的 Font Awesome 视觉重量接近 ── */
function svg(body, size = 12) {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const I = {
    star: svg('<path d="M8 2.3l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.3l-3.52 1.85.68-3.93L2.3 6.45l3.95-.55z"/>'),
    copy: svg('<rect x="5.6" y="5.6" width="7.4" height="7.4" rx="1.5"/><path d="M10.4 3.6H4.3A1.3 1.3 0 0 0 3 4.9v6.1"/>', 11),
    expand: svg('<path d="M9.6 2.6h3.8v3.8M6.4 13.4H2.6V9.6M13.4 2.6L8.9 7.1M2.6 13.4l4.5-4.5"/>', 11),
    warn: svg('<path d="M8 2.9l5.3 9.2H2.7z"/><path d="M8 6.5v2.6M8 11v.1"/>', 11),
    tag: svg('<path d="M8.5 2.6H13v4.5l-5.5 5.5-4.5-4.5z"/><circle cx="10.9" cy="4.8" r=".85" fill="currentColor" stroke="none"/>', 11),
    cal: svg('<rect x="2.6" y="3.7" width="10.8" height="9.7" rx="1.6"/><path d="M2.6 6.7h10.8M5.6 2.5v2.4M10.4 2.5v2.4"/>', 11),
    clock: svg('<circle cx="8" cy="8" r="5.4"/><path d="M8 4.9V8l2.2 1.4"/>', 11),
    chev: svg('<path d="M6.2 3.6L10.4 8l-4.2 4.4"/>', 10),
    sparkle: svg('<path d="M8 2.4l1.1 3.1 3.1 1.1-3.1 1.1L8 10.8 6.9 7.7 3.8 6.6l3.1-1.1z"/><path d="M12.1 10.7l.5 1.4 1.4.5-1.4.5-.5 1.4"/>', 11),
    dots: svg('<circle cx="4" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>', 11),
    plus: svg('<path d="M8 3.4v9.2M3.4 8h9.2"/>', 11),
    edit: svg('<path d="M10.9 2.9l2.2 2.2-7.1 7.1-2.9.7.7-2.9z"/>', 11),
    check: svg('<path d="M3.3 8.4l3 3 6.4-6.4"/>', 9),
    open: svg('<path d="M9.4 2.6h4v4M6.6 13.4h-4v-4M13.4 2.6L8.7 7.3M2.6 13.4l4.7-4.7"/>', 10),
    label: svg('<path d="M3.2 3.2h5.1l4.5 4.5-5.1 5.1L3.2 8.3z"/>', 10),
};

function starIcon(on) {
    return `<svg class="ic${on ? " ic-star-on" : ""}" width="12" height="12" viewBox="0 0 16 16" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M8 2.3l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.3l-3.52 1.85.68-3.93L2.3 6.45l3.95-.55z"/></svg>`;
}

const STATUS = {
    idle: { short: "Idle", full: "Idle" },
    working: { short: "Working", full: "Working · 正在执行" },
    done: { short: "Done", full: "Done · 本轮完成" },
    blocked: { short: "Blocked", full: "Blocked · 等待批准" },
    error: { short: "Error", full: "Error · 执行失败" },
};

const st = () => STATUS[state.state];
const sidShort = () => `${S.sid.slice(0, 8)}…${S.sid.slice(-4)}`;
const copyBtn = (size = 16) =>
    `<button class="iconbtn" data-act="copy" title="Copy session id" style="width:${size}px;height:${size}px">${I.copy}</button>`;

/* ───────────────────────── 0 · 现状基线 ───────────────────────── */

function renderV0() {
    const on = state.starred;
    return `<div class="card v0 st-${state.state}">
    <div class="v0-head">
        <span class="v0-logo">${S.glyph}</span>
        <span class="v0-provider">Pi</span>
        <span class="v0-model">${S.model}</span>
        <button class="iconbtn v0-expand" data-act="expand" title="Open card in dialog">${I.expand}</button>
    </div>
    <div class="v0-status"><span class="dot"></span><b>${st().short}</b></div>
    <div class="v0-title">
        <span class="warn">${I.warn}</span>
        <span class="txt">${S.title}</span>
        <button class="iconbtn" data-act="expand" title="Open card in dialog">${I.expand}</button>
    </div>
    <div class="v0-prop"><span class="k">Title Source</span><span class="v">${S.titleSource}</span></div>
    <div class="v0-prop"><span class="k">Starred</span><button class="v0-check ${on ? "on" : ""}" data-act="star" title="Starred">${on ? I.check : ""}</button></div>
    <div class="v0-prop"><span class="k">Created</span><span class="v">${S.createdAbs}</span></div>
    <div class="v0-prop"><span class="k">Updated</span><span class="v">${S.updatedAbs}</span></div>
    <div class="v0-prop"><span class="k">Tags</span><span class="v"><span class="empty">Empty</span></span></div>
    <div class="v0-prop"><span class="k">Note</span><span class="v"><span class="empty">Empty</span></span></div>
    <button class="v0-add">${I.plus} Add a property</button>
    <button class="v0-ai">${I.sparkle} AI auto-fill</button>
    <div class="v0-sid"><span class="txt">${S.sid}</span>${copyBtn()}</div>
</div>`;
}

/* ───────────────────────── A · Linear 密度 ───────────────────────── */

function renderVA() {
    const on = state.starred;
    const row = (k, v, extra = "") =>
        `<div class="vA-row"><span class="k">${k}</span><span class="v ${extra}">${v}</span><span class="act iconbtn" data-act="edit">${I.edit}</span></div>`;
    return `<div class="card vA st-${state.state}">
    <div class="vA-head">
        <span class="vA-logo">${S.glyph}</span>
        <span class="vA-name">Pi</span>
        <span class="vA-sep">·</span>
        <span class="vA-model">${S.model}</span>
        <div class="vA-right">
            <span class="vA-status"><span class="dot"></span><b>${st().short}</b></span>
            <button class="iconbtn ${on ? "on" : ""}" data-act="star" title="Starred">${starIcon(on)}</button>
            <button class="iconbtn" data-act="expand" title="Open card in dialog">${I.expand}</button>
        </div>
    </div>
    <div class="vA-title">${S.title}</div>
    <div class="vA-props">
        ${row("Updated", `<span title="${S.updatedAbs}">${S.updatedRel}</span>`, "strong")}
        ${row("Created", `<span title="${S.createdAbs}">${S.createdRel}</span>`)}
        ${row("Tags", `<span class="empty">Empty</span>`)}
        ${row("Note", `<span class="empty">Empty</span>`)}
        ${row("Title source", S.titleSource)}
    </div>
    <div class="vA-foot"><span>session</span><span class="sid">${sidShort()}</span>${copyBtn(18)}</div>
</div>`;
}

/* ───────────────────────── B · Vercel 状态条 ───────────────────────── */

function renderVB() {
    const cells = [
        ["Title source", S.titleSource],
        ["Starred", state.starred ? "Yes" : "No"],
        ["Created", S.createdAbs],
        ["Updated", S.updatedAbs],
        ["Tags", "Empty"],
        ["Note", "Empty"],
    ];
    return `<div class="card vB st-${state.state} ${state.openB ? "open" : ""}">
    <div class="vB-head">
        <span class="vB-logo">${S.glyph}</span>
        <span class="vB-name">Pi</span>
        <span class="vB-model">${S.model}</span>
        <span class="vB-status" title="${st().full}"><span class="dot"></span>${st().short}</span>
    </div>
    <div class="vB-title">${S.title}</div>
    <div class="vB-metarow">
        <b>created</b> ${S.createdRel}<span class="s"></span><b>updated</b> ${S.updatedRel}<span class="s"></span><b>${S.stat.out} out</b>
    </div>
    <div class="vB-disc" data-act="toggleB">
        <span>Properties</span><span class="count">${cells.length}</span><span class="chev">${I.chev}</span>
    </div>
    <div class="vB-grid">
        ${cells.map(([k, v]) => `<div class="vB-cell"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}
    </div>
    <div class="sidrow"><span class="txt">${sidShort()}</span>${copyBtn()}</div>
</div>`;
}

/* ───────────────────────── C · Raycast 分组 ───────────────────────── */

function renderVC() {
    const row = (icon, k, v, extra = "") =>
        `<div class="vC-row ${extra}">${icon}<span class="k">${k}</span><span class="v">${v}</span></div>`;
    return `<div class="card vC st-${state.state}">
    <div class="vC-sect">Agent<span class="r">Pi · ${S.model}</span></div>
    ${row('<span class="dot"></span>', "Status", st().short, "hl")}
    ${row(starIcon(state.starred), "Starred", state.starred ? "Yes" : "No")}
    <div class="vC-title">${S.title}</div>
    <div class="vC-div"></div>
    <div class="vC-sect">Properties<span class="r">6</span></div>
    ${row(I.cal, "Created", S.createdRel)}
    ${row(I.clock, "Updated", S.updatedRel)}
    ${row(I.tag, "Tags", '<span class="empty">Empty</span>')}
    ${row(I.edit, "Note", '<span class="empty">Empty</span>')}
    ${row(I.dots, "Title source", S.titleSource)}
    <div class="vC-div"></div>
    <div class="vC-row"><span class="mono" style="color:var(--text-3)">3ce67d75…7ca2</span><span class="k"></span><span class="kbd">⌘C</span></div>
    <div class="vC-foot"><span><span class="kbd">⏎</span> Open card</span><span><span class="kbd">⌘C</span> Copy id</span><span class="r">hover</span></div>
</div>`;
}

/* ───────────────────────── D · GitHub 头像卡 ───────────────────────── */

function renderVD() {
    const labels = S.tags.length
        ? S.tags.map((t) => `<span class="vD-label">${I.label}${t}</span>`).join("")
        : `<span class="vD-label"><span class="empty">no labels</span></span>`;
    return `<div class="card vD st-${state.state}">
    <div class="vD-head">
        <div class="vD-avatar">${S.glyph}</div>
        <div class="vD-id">
            <span class="vD-name">Pi</span>
            <span class="vD-state"><span class="dot"></span>${st().short} · ${S.model}</span>
        </div>
        <div class="vD-tools">
            <button class="iconbtn ${state.starred ? "on" : ""}" data-act="star" title="Starred">${starIcon(state.starred)}</button>
            <button class="iconbtn" data-act="expand" title="Open card in dialog">${I.expand}</button>
            <button class="iconbtn" data-act="copy" title="Copy session id">${I.copy}</button>
        </div>
    </div>
    <div class="vD-title">${S.title}</div>
    <div class="vD-labels">${labels}<span class="vD-label add">${I.plus} label</span></div>
    <div class="vD-meta">
        <div>${I.cal} created <b>${S.createdRel}</b></div>
        <div>${I.clock} updated <b>${S.updatedRel}</b></div>
        <div>${I.dots} title source <b>${S.titleSource}</b></div>
    </div>
    <div class="vD-foot"><span class="txt">${S.sid}</span>${copyBtn()}</div>
</div>`;
}

/* ───────────────────────── E · Warp 指标优先 ───────────────────────── */

function renderVE() {
    const stat = (k, v) => `<div class="vE-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const cell = (k, v) => `<div class="vE-cell"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    return `<div class="card vE st-${state.state}">
    <div class="vE-head">
        <span class="vE-live"><span class="dot"></span>${st().short}</span>
        <span class="vE-ident"><span class="lg">${S.glyph}</span>Pi · ${S.model}</span>
    </div>
    <div class="vE-stats">
        ${stat("Duration", S.stat.dur)}${stat("Cost", S.stat.cost)}${stat("Context", S.stat.ctx)}
    </div>
    <div class="vE-caps">Task</div>
    <div class="vE-task">${S.title}</div>
    <div class="vE-caps">Details</div>
    <div class="vE-grid">
        ${cell("Created", S.createdRel)}${cell("Updated", S.updatedRel)}
        ${cell("Tags", '<span class="empty">Empty</span>')}${cell("Cache hit", S.stat.cache)}
    </div>
    <div class="vE-foot"><span class="txt">${sidShort()}</span>${copyBtn()}</div>
</div>`;
}

/* ───────────────────────── F · Arc 品牌玻璃 ───────────────────────── */

function renderVF() {
    const row = (k, v) => `<div class="vF-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    return `<div class="card vF st-${state.state}">
    <div class="vF-head">
        <div class="vF-badge">${S.glyph}</div>
        <div class="vF-id"><span class="vF-name">Pi</span><span class="vF-sub">${S.model}</span></div>
        <span class="vF-chip" title="${st().full}"><span class="dot"></span>${st().short}</span>
    </div>
    <div class="vF-title">${S.title}</div>
    ${row("Created", S.createdRel)}
    ${row("Updated", S.updatedRel)}
    ${row("Tags", '<span class="empty">Empty</span>')}
    ${row("Title source", S.titleSource)}
    <div class="vF-foot">
        <span class="vF-pill"><span class="txt">${S.sid}</span><button class="iconbtn" data-act="copy" title="Copy session id">${I.copy}</button></span>
    </div>
</div>`;
}

/* ───────────────────────── G · Stripe 仪表 ───────────────────────── */

function renderVG() {
    const cell = (k, v, mono = false) => `<div class="vG-cell"><div class="k">${k}</div><div class="v ${mono ? "mono" : ""}">${v}</div></div>`;
    return `<div class="card vG st-${state.state}">
    <div class="vG-head">
        <span class="vG-name">Pi</span>
        <span class="vG-pill" title="${st().full}"><span class="dot"></span>${st().short}</span>
        <button class="vG-open" data-act="expand">Open ${I.open}</button>
    </div>
    <div class="vG-body">
        <div class="vG-caps">Summary</div>
        <p class="vG-summary">${S.title}</p>
        <div class="vG-caps">Properties</div>
        <div class="vG-dl">
            ${cell("Created", S.createdRel)}${cell("Updated", S.updatedRel)}
            ${cell("Title source", S.titleSource)}${cell("Model", S.model, true)}
            ${cell("Tags", '<span class="empty">Empty</span>')}${cell("Starred", state.starred ? "Yes" : "No")}
        </div>
        <div class="vG-foot">
            <button class="vG-btn primary">Edit note</button>
            <button class="vG-btn" data-act="copy">Copy id</button>
            <button class="vG-btn">Add property</button>
        </div>
    </div>
</div>`;
}

/* ───────────────────────── 方案元数据 ───────────────────────── */

const VARIANTS = [
    {
        id: "v0",
        no: "0",
        name: "现状 · 基线",
        ref: "当前实现",
        concept: "左侧 3px 状态条 + 6 行 Notion 属性 + 两个按钮 + session id，卡片高约 300px。",
        metrics: "行高 24 · 字号 11.5/13 · 分割线 2 · 属性 6 行",
        render: renderV0,
        notes: [
            "这是真实组件的还原：`info-card.agent-card::before` 色条、`.agent-card-head`、`.agent-card-status-row`，属性区来自 `PropertyList mode=detail`。",
            "问题不是丑，是<b>信息密度失衡</b>：Title Source / Starred 各占一整行，贡献接近 0，却把标题挤到只有一行。",
            "空值 `Empty` 占了两行（Tags / Note）；`+ Add a property` 与 `AI auto-fill` 常驻底部，进一步拉高。",
        ],
        css: `/* 现状：无需改动，作为高度/信息量对照 */`,
        cost: "对照基线",
        costWarn: false,
    },
    {
        id: "vA",
        no: "A",
        name: "Linear 式密度",
        ref: "Linear · Issue panel",
        concept: "星标上行到头部，空值行不占高度，时间改相对值，整体行高收紧到 26px。",
        metrics: "行高 26 · 字号 11.5/12.5 · 分割线 2 · 可见行 5",
        rec: true,
        render: renderVA,
        notes: [
            "<b>Starred 从属性行搬进头部</b>：星标是 toggle，不是「key→value」，独占一行纯浪费。",
            "<b>时间用相对值 + hover 绝对值</b>：视线需要的是「刚才改过」，不是 `Nov 3, 2026 11:24`。",
            "<b>空值行保留但不给高度</b>：Tags/Note 的 `Empty` 仍然可见（可发现性），但行高 26 且无逐行分割线，卡片总高从 ~300 降到 ~210。",
            "行 hover 才出编辑铅笔，静止态没有第二个视觉焦点与标题竞争。",
        ],
        css: `.info-card.agent-card { padding: 12px; }
/* 星标搬进头部，不再占一行属性 */
.agent-card-head .star-btn { margin-left: auto; }

/* 属性行：26px、无逐行分割线 */
.property-list .property-row { height: 26px; }
.property-list .property-row .property-name {
    width: 74px; flex: none; color: var(--secondary-text-color);
}
.property-row .row-actions { margin-left: auto; opacity: 0; }
.property-row:hover .row-actions { opacity: 1; }`,
        cost: "CSS + 小改 JSX（星标位置、相对时间）· 低风险",
        costWarn: false,
    },
    {
        id: "vB",
        no: "B",
        name: "Vercel 状态条 + mono meta",
        ref: "Vercel · Deployment card",
        concept: "顶部 2px 渐变状态条，状态收成右上 chip，属性区折叠成一行 disclosure，meta 走等宽小字 + 圆点分隔。",
        metrics: "折叠后 3 行 · 字号 11/12.5 · 分割线 1 · 状态条 2px",
        rec: false,
        render: renderVB,
        notes: [
            "<b>状态从「一行文字」变「一条状态条 + 一枚 chip」</b>，同一信息占 0 行高度：卡面顶部 2px 渐变条把 working/done/error 变成余光可读的信号。",
            "<b>Properties 默认折叠</b>：卡片第一屏只留标题 + meta，需要时点开 6 格网格。hover 卡本来就该是「摘要」，编辑走放大弹窗。",
            "<b>mono meta 行</b>是 Vercel 的核心语言：`created 3d ago · updated 2m ago · 5.4k out`，三段时间/计数一眼扫完。",
            "模型名用虚线 chip：`未指定` 是「缺失值」语义，虚线正好表达不确定性，比灰色斜体更强。",
        ],
        css: `.info-card.agent-card { border-radius: 9px; padding: 13px; }

/* 顶部状态条（替代左侧 3px 竖条） */
.info-card.agent-card::before {
    left: 0; right: 0; top: -1px; bottom: auto; height: 2px;
    border-radius: 9px 9px 0 0;
    background: linear-gradient(90deg, transparent,
        var(--info-card-accent), transparent);
}

/* 缺失值用虚线 chip */
.agent-card-model { border: 1px dashed var(--border-color);
    border-radius: 4px; padding: 0 6px; height: 18px; }`,
        cost: "CSS + 折叠状态（局部 useState）· 中低",
        costWarn: false,
    },
    {
        id: "vC",
        no: "C",
        name: "Raycast 分组键盘浮层",
        ref: "Raycast · Command palette",
        concept: "大写分组头 + 30px 行 + 选中行左侧 accent 线 + 底栏键盘提示。",
        metrics: "行高 30 · 字号 9.5 分组头/12 · 分组 2 · 分割线 2",
        rec: false,
        render: renderVC,
        notes: [
            "<b>分组头（AGENT / PROPERTIES）替代分割线</b>：结构靠留白与 9.5px 大写字重表达，不靠边框，卡面更「浮」。",
            "<b>行高 30px</b> 是键盘可达的最小高度；选中行用 inset 2px accent + 10% 底色，和 Raycast 一致。",
            "底栏给 `⏎ / ⌘C` 提示，把「这张卡能做什么」写在不占正文高度的位置。",
            "缺点：<b>hover 卡里分组头偏重</b>，一屏多卡时视觉噪声大。更适合 AgentCardModal（弹窗整卡编辑）。",
        ],
        css: `.agent-card .section-label {
    font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--secondary-text-color); padding: 8px 12px 3px;
}
.property-row { height: 30px; border-radius: 6px; margin: 0 4px; padding: 0 8px; }
.property-row:hover, .property-row.is-selected {
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
    box-shadow: inset 2px 0 0 var(--accent-color);
}`,
        cost: "CSS 为主 · 建议只用于 AgentCardModal",
        costWarn: true,
    },
    {
        id: "vD",
        no: "D",
        name: "GitHub 头像卡",
        ref: "GitHub · Copilot / Actions",
        concept: "32px 品牌头像块、标签 pill、标题引用块、hover 工具组、mono footer。",
        metrics: "字号 10.5/13 · 标签 1 行 · 头像 32px · 分割线 2",
        rec: false,
        render: renderVD,
        notes: [
            "<b>头像是身份，不是图标</b>：32px 渐变方块 + 白色 π，比 18px 裸 logo 更像「谁在跟我说话」，也和 emoji 人格（agent-emoji-persona）天然兼容。",
            "<b>标题做引用块</b>（左 2px 状态色）：把会话摘要从「一行灰字」升级成卡片主体，与属性区形成明确主次。",
            "<b>标签 pill + `+ label` 虚线占位</b>：空标签不再显示 `Empty`，而是给出可执行动作。",
            "工具组（star / expand / copy）hover 才出现，静止态干净；footer 只留 session id + 复制。",
        ],
        css: `.agent-card-logo {
    width: 32px; height: 32px; border-radius: 8px; color: #fff;
    background: linear-gradient(150deg, #b9a3ff, #6d4bd6);
}
.agent-card-title {
    padding-left: 9px;
    border-left: 2px solid color-mix(in srgb,
        var(--info-card-accent) 55%, transparent);
}
.agent-card-tag { border-radius: 999px; background: transparent;
    border: 1px solid var(--border-color); }
.agent-card-actions { margin-left: auto; opacity: 0; }
.info-card.agent-card:hover .agent-card-actions { opacity: 1; }`,
        cost: "CSS + JSX（头像块 / 工具组 / 标签占位）· 中",
        costWarn: false,
    },
    {
        id: "vE",
        no: "E",
        name: "Warp 指标优先",
        ref: "Warp · Agent pane",
        concept: "状态头 + 三列指标（Duration / Cost / Context）上抬，TASK / DETAILS 大写分区。",
        metrics: "行高 21 · 字号 9.5 caps/12.5 · 指标格 1 · 分割线 1",
        rec: true,
        render: renderVE,
        notes: [
            "数据其实已经有了：底栏状态栏就是 `↑62k ↓5.4k R598k CH99.7% $0.014 6.7%/1.0M`。<b>指标上抬</b>让「这轮花了多少、上下文多满」在卡上一眼可见。",
            "<b>三列等宽指标格</b>用 1px 细边框包裹（唯一的重边框），成为卡片的视觉锚点；其余部分全靠留白。",
            "TASK / DETAILS 大写小标题 + 右侧延伸线，替代 title 与 properties 之间的分割线。",
            "title 用左 2px 竖线引用块（Warp 的 block 语言）。",
        ],
        css: `.agent-card-stats {
    display: grid; grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--border-color); border-radius: 6px;
    overflow: hidden; margin: 10px 0 2px;
}
.agent-card-stats > div { padding: 7px 8px;
    border-right: 1px solid var(--border-color); }
.agent-card-stats > div:last-child { border-right: 0; }
.agent-card-stats .k { font-size: 9.5px; letter-spacing: .08em;
    text-transform: uppercase; color: var(--secondary-text-color); }
.agent-card-stats .v { font: 12.5px var(--mono-font); }`,
        cost: "TSX（需把 session usage 接进卡）· 数据侧改动最大",
        costWarn: true,
    },
    {
        id: "vF",
        no: "F",
        name: "Arc 品牌玻璃",
        ref: "Arc · Spaces / Amie",
        concept: "品牌色渐变底 + 30px 发光徽标 + 呼吸状态 chip，属性右对齐 mono。",
        metrics: "行高 25 · 字号 11/13.5 · 分割线 0 · 徽标 30px",
        rec: false,
        render: renderVF,
        notes: [
            "<b>品牌色进场</b>：整卡 15% 品牌色渐变（左上 → 右下淡出），边框同色 26%，状态色只出现在徽标外发光与 chip 上。",
            "属性全部右对齐 mono：标签灰、值等宽，像一张「卡片背面」的规格表。",
            "缺点：<b>一屏多卡时品牌色会变成噪声</b>；且需要 provider → brand color 映射（现在只有 logo SVG 自带色）。建议仅用在新会话的开篇卡（agent-id-card 场景）。",
        ],
        css: `.info-card.agent-card {
    border: 1px solid color-mix(in srgb, var(--brand-color) 26%, var(--border-color));
    background: linear-gradient(158deg,
        color-mix(in srgb, var(--brand-color) 15%, var(--panel-bg-color)),
        var(--panel-bg-color) 52%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
}`,
        cost: "CSS + provider 品牌色映射 · 中",
        costWarn: true,
    },
    {
        id: "vG",
        no: "G",
        name: "Stripe 仪表卡",
        ref: "Stripe · Dashboard detail",
        concept: "头部一条 + 两列 key/value 网格 + 底部主按钮，表单化、可扫读。",
        metrics: "字号 9.5 caps/12 · 2 列 6 格 · 分割线 3",
        rec: false,
        render: renderVG,
        notes: [
            "<b>两列网格</b>把 6 条属性压成 3 行高度，代价是每格宽度变窄（长值要截断）。",
            "<b>主按钮 `Edit note`</b>取代 `+ Add a property`：Stripe 的原则是「一张卡只有一个主行动」，其余进 secondary。",
            "分区靠 caps 小标题 + 1px hairline，不用背景块 —— 在 hover 卡里最省视觉预算。",
            "适合 <b>AgentCardModal</b>（宽度 520–640），在 320–360 的 hover 卡里两列会挤。",
        ],
        css: `.info-card.agent-card { padding: 0; overflow: hidden; }
.info-card.agent-card .agent-card-head {
    padding: 11px 12px; border-bottom: 1px solid var(--border-color);
}
.agent-card-dl {
    display: grid; grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--border-color);
}
.agent-card-dl > div { padding: 7px 0;
    border-bottom: 1px solid var(--border-color); }
.agent-card-dl > div:nth-child(even) {
    padding-left: 10px; border-left: 1px solid var(--border-color);
}`,
        cost: "CSS + JSX（属性渲染改网格、主按钮）· 中",
        costWarn: false,
    },
];

/* ───────────────────────── 渲染 ───────────────────────── */

const grid = document.getElementById("grid");

function renderGrid() {
    grid.innerHTML = VARIANTS.map((v) => {
        const head = `<div class="cell-head">
            <div class="cell-title">
                <span class="no">${v.no}</span>
                <span class="name">${v.name}</span>
                <span class="ref">${v.ref}</span>
                ${v.rec ? '<span class="rec">推荐</span>' : ""}
            </div>
            <p class="concept">${v.concept}</p>
            <div class="cell-actions">
                <button data-act="notes" data-id="${v.id}">落地要点与 CSS</button>
                <span class="metrics">${v.metrics}</span>
            </div>
        </div>`;
        return `<div class="cell" data-cell="${v.id}">${head}${v.render()}</div>`;
    }).join("");

    // 供评审/对齐用的卡高实测（不参与渲染决策）
    const heights = {};
    grid.querySelectorAll(".cell[data-cell]").forEach((cell) => {
        const card = cell.querySelector(".card");
        if (card != null) {
            heights[cell.dataset.cell] = card.offsetHeight;
        }
    });
    document.documentElement.dataset.cardHeights = JSON.stringify(heights);
}

/* ───────────────────────── 交互 ───────────────────────── */

function statusButtons() {
    document.querySelectorAll("#ctrl-state button").forEach((b) => {
        b.classList.toggle("active", b.dataset.state === state.state);
    });
}

function toastCopied(el) {
    el.classList.add("is-copied");
    setTimeout(() => el.classList.remove("is-copied"), 1200);
}

grid.addEventListener("click", (e) => {
    const target = e.target.closest("[data-act]");
    if (target == null) {
        return;
    }
    const act = target.dataset.act;
    if (act === "star") {
        state.starred = !state.starred;
        renderGrid();
    } else if (act === "toggleB") {
        state.openB = !state.openB;
        renderGrid();
    } else if (act === "copy") {
        navigator.clipboard?.writeText(S.sid).catch(() => {});
        toastCopied(target);
    } else if (act === "notes") {
        openDrawer(target.dataset.id);
    }
    // expand / edit 在原型里不打开弹窗，仅保留可点击感
});

document.getElementById("ctrl-state").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-state]");
    if (btn == null) {
        return;
    }
    state.state = btn.dataset.state;
    statusButtons();
    renderGrid();
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

const themeBtn = document.getElementById("ctrl-theme");
themeBtn.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    themeBtn.textContent = state.theme === "dark" ? "浅色" : "深色";
});

const zoomBtn = document.getElementById("ctrl-zoom");
zoomBtn.addEventListener("click", () => {
    state.zoom = !state.zoom;
    grid.classList.toggle("zoom", state.zoom);
    zoomBtn.classList.toggle("on", state.zoom);
});

const guidesBtn = document.getElementById("ctrl-guides");
guidesBtn.addEventListener("click", () => {
    state.guides = !state.guides;
    document.body.classList.toggle("guides", state.guides);
    guidesBtn.classList.toggle("on", state.guides);
});

/* ───────────────────────── 要点抽屉 ───────────────────────── */

const drawer = document.getElementById("drawer");

function openDrawer(id) {
    const v = VARIANTS.find((x) => x.id === id);
    if (v == null) {
        return;
    }
    document.getElementById("drawer-title").textContent = `${v.no} · ${v.name}`;
    document.getElementById("drawer-ref").textContent = `参考：${v.ref} ｜ ${v.metrics}`;
    document.getElementById("drawer-notes").innerHTML = v.notes.map((n) => `<li>${n}</li>`).join("");
    document.getElementById("drawer-css").textContent = v.css;
    const cost = document.getElementById("drawer-cost");
    cost.textContent = v.cost;
    cost.classList.toggle("warn", v.costWarn);
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
}

document.getElementById("drawer-close").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        closeDrawer();
    }
});

/* ───────────────────────── init ───────────────────────── */

// 深链（评审用）：?state=working&theme=light&width=420&zoom=1&guides=1&notes=vB
const params = new URLSearchParams(location.search);
const qState = params.get("state");
if (qState != null && STATUS[qState] != null) {
    state.state = qState;
}
const qWidth = Number(params.get("width"));
if (qWidth === 320 || qWidth === 360 || qWidth === 420) {
    state.width = qWidth;
    document.querySelectorAll("#ctrl-width button").forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.width) === qWidth);
    });
}
if (params.get("theme") === "light") {
    state.theme = "light";
    document.documentElement.dataset.theme = "light";
    themeBtn.textContent = "深色";
}
if (params.get("zoom") === "1") {
    state.zoom = true;
    grid.classList.add("zoom");
    zoomBtn.classList.add("on");
}
if (params.get("guides") === "1") {
    state.guides = true;
    document.body.classList.add("guides");
    guidesBtn.classList.add("on");
}

document.documentElement.style.setProperty("--card-w", `${state.width}px`);
statusButtons();
renderGrid();

const qNotes = params.get("notes");
if (qNotes != null) {
    openDrawer(qNotes);
}
