// Tab Hover Card 变体原型 — 交互脚本
// 同一份数据，8 套视觉/图标体系，切换左侧条目即可对比。

const DATA = {
    workspace: "PPT",
    counts: { agent: 4, chat: 2, file: 12, note: 1 },
    agents: [
        { provider: "pi", abbr: "PI", glyph: "◈", emoji: "🛠️", kind: "working", state: "Tool · bash", short: "bash", elapsed: "12s" },
        { provider: "pi", abbr: "PI", glyph: "◈", emoji: "🧙", kind: "thinking", state: "Thinking", short: "think", elapsed: "4s" },
        { provider: "pi", abbr: "PI", glyph: "◈", emoji: "📊", kind: "idle", state: "Idle", short: "idle", elapsed: "3m" },
        { provider: "pi", abbr: "PI", glyph: "◈", emoji: "🖥️", kind: "done", state: "Done", short: "done", elapsed: "1m" },
    ],
};

const VARIANTS = [
    {
        id: "github",
        name: "GitHub Hovercard",
        ref: "GitHub · PR/Issue 悬停卡",
        desc: "标题 + 1px 分隔线 + 键值元数据；信息用 muted label 与等宽数字，不堆图标。",
        steal: "最值得抄：<b>分隔线 + 键值行</b>。把「4 agents · 12 files」变成 header 右侧的等宽计数，卡片立刻少两行。图标退成单色小字形。",
        render: renderGithub,
    },
    {
        id: "linear",
        name: "Linear Issue List",
        ref: "Linear · Issue 列表 / Command Menu",
        desc: "高密度 22px 行、全大写小标题、状态点 + 文本，无多余边框。",
        steal: "最值得抄：<b>密度与分组</b>。行高压到 22px，分组标题写成大写小字，卡片在同样高度里能塞下两倍条目。",
        render: renderLinear,
    },
    {
        id: "raycast",
        name: "Raycast 命令面板",
        ref: "Raycast · 玻璃面板 + 行内快捷键",
        desc: "毛玻璃底、内行 7px 圆角可 hover、20px tinted 图标容器。",
        steal: "最值得抄：<b>图标容器</b>。emoji 外面套一层带 tint 的圆角方块，任意 emoji 的尺寸与底色都被框住，混排也不再像贴纸。",
        render: renderRaycast,
    },
    {
        id: "notion",
        name: "Notion / Things 3",
        ref: "Notion 属性面板 · Things 3 侧栏",
        desc: "emoji 原样放行、状态用浅底 pill、底部属性 chips。",
        steal: "最值得抄：<b>状态 pill</b>。Idle / Thinking / Done 用浅色胶囊，比右侧贴边文字更稳，也不怕长状态撑宽卡片。",
        render: renderNotion,
    },
    {
        id: "geist",
        name: "Vercel Geist / shadcn",
        ref: "Geist Popover · shadcn/ui HoverCard",
        desc: "12px 字号、hairline、等宽计数、描边胶囊状态，极简无装饰。",
        steal: "最值得抄：<b>克制的边界</b>。全部用 1px rgba 细线与等宽数字，没有任何底色块，最贴近本仓现有 InfoCard 的中性基调。",
        render: renderGeist,
    },
    {
        id: "discord",
        name: "Discord 成员列表",
        ref: "Discord · 成员侧栏状态环",
        desc: "22px 圆形头像 + 右下角状态环，分组标题带计数。",
        steal: "最值得抄：<b>状态环</b>。状态点挂在头像右下角，与身份图标合成一个视觉单元，左侧不再需要两个并排的信号。",
        render: renderDiscord,
    },
    {
        id: "warp",
        name: "Warp 终端",
        ref: "Warp · Block 列表 / 本仓 terminal 语言",
        desc: "等宽字体、2px 状态竖条、19px 行高、全小写状态。",
        steal: "最值得抄：<b>竖条代替圆点</b>。左侧 2px 竖条比 7px 圆点更像终端原生语言，也和 Tab 上已有的 agent 竖条呼应。",
        render: renderWarp,
    },
    {
        id: "fluent",
        name: "Windows Fluent 2",
        ref: "Fluent 2 · Card / 亚克力浮层",
        desc: "亚克力模糊、20px 方块图标、描边胶囊状态带内部圆点。",
        steal: "最值得抄：<b>亚克力层</b>。桌面端浮层用轻微模糊比纯色底更容易与 Tab 栏区分，且浅色/深色主题都能自动跟随。",
        render: renderFluent,
    },
];

const agentKindClass = (k) => (k === "idle" ? "" : ` is-${k}`);

function renderGithub() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="dot ${a.kind}"></span>
                <span class="ico">${a.glyph}</span>
                <span class="name">${a.provider}</span>
                <span class="state mono">${a.state}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-github">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="flag"></span>
            <span class="count mono">${DATA.counts.agent} agents · ${DATA.counts.file} files</span>
        </div>
        <div class="rule"></div>
        <div class="kv">
            <dt>Workspace</dt><dd>default</dd>
            <dt>Content</dt><dd>${DATA.counts.agent} agent · ${DATA.counts.chat} chat · ${DATA.counts.file} file · ${DATA.counts.note} note</dd>
        </div>
        <div class="rule"></div>
        <div class="sub">Agents · pi ×4</div>
        ${rows}
    </div>`;
}

function renderLinear() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="dot ${a.kind}"></span>
                <span class="bd">${a.abbr}</span>
                <span class="name">${a.provider}</span>
                <span class="state">${a.state}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-linear">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count mono">${DATA.counts.agent}a · ${DATA.counts.file}f</span>
        </div>
        <div class="sub">Agents <span>${DATA.agents.length}</span></div>
        ${rows}
        <div class="foot">
            <span>${DATA.counts.chat} chat</span>
            <span>${DATA.counts.file} file</span>
            <span>${DATA.counts.note} note</span>
        </div>
    </div>`;
}

function renderRaycast() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="chip">${a.emoji}</span>
                <span class="name">${a.provider}</span>
                <span class="state">${a.state}<span class="kbd">${a.elapsed}</span></span>
            </div>`
        )
        .join("");
    return `<div class="card v-raycast">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count">${DATA.counts.agent} agents · ${DATA.counts.file} files</span>
        </div>
        <div class="cap">Agents</div>
        ${rows}
        <div class="foot">
            <span>Open tab</span><span>·</span><span>Close tab</span>
        </div>
    </div>`;
}

function renderNotion() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="em">${a.emoji}</span>
                <span class="name">${a.provider}</span>
                <span class="pill">${a.state}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-notion">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count">${DATA.agents.length} agents</span>
        </div>
        <div class="sub">Agents</div>
        ${rows}
        <div class="props">
            <span class="prop">${DATA.counts.chat} chat</span>
            <span class="prop">${DATA.counts.file} file</span>
            <span class="prop">${DATA.counts.note} note</span>
        </div>
    </div>`;
}

function renderGeist() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="logo">π</span>
                <span class="name">${a.provider}</span>
                <span class="tag">${a.state}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-geist">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count">${DATA.counts.agent}a/${DATA.counts.file}f</span>
        </div>
        <div class="rule"></div>
        <div class="cap">Agents</div>
        ${rows}
    </div>`;
}

function renderDiscord() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="avatar">${a.emoji}<span class="ring"></span></span>
                <span class="name">${a.provider}</span>
                <span class="state">${a.state}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-discord">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count">${DATA.counts.agent} agents · ${DATA.counts.file} files</span>
        </div>
        <div class="sub">Agents — ${DATA.agents.length}</div>
        ${rows}
    </div>`;
}

function renderWarp() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="bar"></span>
                <span class="em">${a.emoji}</span>
                <span class="name">${a.provider}</span>
                <span class="state">${a.state.toLowerCase()}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-warp">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count">${DATA.counts.agent}a · ${DATA.counts.file}f</span>
        </div>
        <div class="rule"></div>
        <div class="sub">agents</div>
        ${rows}
    </div>`;
}

function renderFluent() {
    const rows = DATA.agents
        .map(
            (a) => `<div class="row${agentKindClass(a.kind)}">
                <span class="tile">${a.emoji}</span>
                <span class="name">${a.provider}</span>
                <span class="pill"><i></i>${a.state}</span>
            </div>`
        )
        .join("");
    return `<div class="card v-fluent">
        <div class="head">
            <span class="ws">▤</span>
            <span class="title">${DATA.workspace}</span>
            <span class="count">${DATA.counts.agent} agents · ${DATA.counts.file} files</span>
        </div>
        <div class="rule"></div>
        ${rows}
    </div>`;
}

/* ─────────── 页面装配 ─────────── */

const navList = document.getElementById("nav-list");
const slot = document.getElementById("card-slot");
const titleEl = document.getElementById("v-title");
const refEl = document.getElementById("v-ref");
const stealEl = document.getElementById("v-steal");
const stage = document.getElementById("stage");

let current = VARIANTS[0].id;

function select(id) {
    const v = VARIANTS.find((x) => x.id === id) || VARIANTS[0];
    current = v.id;
    slot.innerHTML = v.render();
    titleEl.textContent = v.name;
    refEl.textContent = v.ref;
    stealEl.innerHTML = v.steal;
    [...navList.querySelectorAll(".item")].forEach((el) => {
        el.classList.toggle("active", el.dataset.id === v.id);
    });
}

VARIANTS.forEach((v, i) => {
    const btn = document.createElement("button");
    btn.className = "item";
    btn.dataset.id = v.id;
    btn.innerHTML = `<span class="name"><span class="num">${i + 1}</span>${v.name}</span>
        <span class="ref">${v.ref}</span>
        <span class="desc">${v.desc}</span>`;
    btn.addEventListener("click", () => select(v.id));
    navList.appendChild(btn);
});

/* tab 栏 hover 联动：pointer 进入 PPT tab 显示卡片 */
const hotTab = document.getElementById("tab-hot");
const slotWrap = document.getElementById("card-slot-wrap");

hotTab.addEventListener("mouseenter", () => {
    slotWrap.classList.remove("hidden");
    hotTab.classList.add("hot");
});
hotTab.addEventListener("mouseleave", () => {
    hotTab.classList.remove("hot");
});

/* 首帧固定展示，避免用户以为页面空白 */
slotWrap.classList.remove("hidden");

/* 主题切换 */
document.getElementById("theme").addEventListener("click", () => {
    document.body.classList.toggle("light");
    const light = document.body.classList.contains("light");
    document.getElementById("theme").textContent = light ? "深色" : "浅色";
});

/* ←/→ 切换变体 */
document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const idx = VARIANTS.findIndex((v) => v.id === current);
    const next = (idx + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1) + VARIANTS.length) % VARIANTS.length;
    select(VARIANTS[next].id);
});

select(VARIANTS[0].id);
