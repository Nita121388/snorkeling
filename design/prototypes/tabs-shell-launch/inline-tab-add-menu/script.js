/* Inline Tab Add Menu 原型交互
 * 菜单数据源 = pkg/wconfig/defaultconfig/widgets.json（display:order 排序，与 WidgetsBar 同源）
 * 调用链日志标注真实 API：createTerminalBlockDef / createDefaultAgentBlockDef /
 *   ObjectService.CreateBlock / layoutModel.addBlockToInlineTab
 */

"use strict";

/* ---------- widget 注册表（镜像 widgets.json，含 display:order） ---------- */
const WIDGETS = [
    { id: "defwidget@terminal", order: -5, icon: "fa-sharp fa-solid fa-square-terminal", label: "Terminal",
      kind: "terminal", special: true },
    { id: "defwidget@agent", order: -4, icon: "fa-solid fa-robot", label: "Agent",
      kind: "agent", special: true },
    { id: "defwidget@files", order: -3, icon: "fa-solid fa-folder-open", label: "Files",
      kind: "files", special: true },
    { id: "defwidget@sessions", order: -2, icon: "fa-sharp fa-regular fa-comments", label: "Sessions" },
    // action 型 widget（无 blockdef，点击弹搜索弹窗不产 block）——本期跳过，菜单里以禁用态示意
    { id: "defwidget@commontext", order: -1.5, icon: "fa-sharp fa-solid fa-quote-left", label: "Text",
      actionOnly: true },
    { id: "defwidget@web", order: -1, icon: "fa-sharp fa-solid fa-globe", label: "Web" },
    { id: "defwidget@sysinfo", order: 0, icon: "fa-sharp fa-solid fa-chart-line", label: "Sysinfo" },
    { id: "defwidget@processviewer", order: 1, icon: "fa-sharp fa-solid fa-list-tree", label: "Processes" },
];

/* ---------- 演示组初始数据（title/icon 镜像 InlineTabLabel 的 defaultTitle 推导） ---------- */
const DEMO_CONTEXT = { connection: null, cwd: "~/code/snorkeling" };

const GROUPS = {
    "group-1": {
        context: DEMO_CONTEXT,
        tabs: [
            { blockId: "b1-term", view: "term", title: "snorkeling" },
            { blockId: "b2-agent", view: "term", agent: true, working: true, title: "snorkeling · local" },
            { blockId: "b3-files", view: "preview", title: "snorkeling" },
        ],
        activeId: "b2-agent",
    },
    "group-2": {
        context: DEMO_CONTEXT,
        tabs: [
            { blockId: "c1", view: "term", title: "zsh" },
            { blockId: "c2", view: "preview", title: "AGENTS.md" },
            { blockId: "c3", view: "term", title: "prod-box · ssh://nita" },
            { blockId: "c4", view: "web", title: "web" },
            { blockId: "c5", view: "aisessions", title: "sessions" },
            { blockId: "c6", view: "term", agent: true, title: "snorkeling" },
            { blockId: "c7", view: "sysinfo", title: "sysinfo" },
            { blockId: "c8", view: "preview", title: "block.scss" },
            { blockId: "c9", view: "processviewer", title: "processes" },
        ],
        activeId: "c2",
    },
};

let blockSeq = 100;

/* ---------- 工具 ---------- */
const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
};
const basename = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || p;
const now = () => new Date().toTimeString().slice(0, 8);

function log(html) {
    const line = el("div", null, `<span class="t">${now()}</span> ▸ ${html}`);
    document.getElementById("log").appendChild(line);
    line.scrollIntoView({ block: "nearest" });
}

/* duplicateIndex 模拟真实 getDuplicateIndexes：同名 tab 追加序号 */
function renumberTabs(group) {
    const counts = new Map();
    for (const tab of group.tabs) {
        const c = (counts.get(tab.title) ?? 0) + 1;
        counts.set(tab.title, c);
        tab.dup = c;
    }
}

/* ---------- 渲染 ---------- */
function renderGroup(groupId) {
    const group = GROUPS[groupId];
    const root = document.getElementById(groupId);
    const strip = root.querySelector(".inline-tab-block-tabs");
    const activeWrap = root.querySelector(".inline-tab-block-active");
    renumberTabs(group);

    /* tabs */
    strip.querySelectorAll(".inline-tab-block-tab").forEach((n) => n.remove());
    for (const tab of group.tabs) {
        const item = el("div", "inline-tab-block-tab" + (tab.blockId === group.activeId ? " active" : ""));
        item.dataset.blockId = tab.blockId;

        const mainWrapper = el("div", "inline-tab-block-tab-main-wrapper");
        const main = el("div", "inline-tab-block-tab-main");
        const btn = el("button", null);
        btn.type = "button";
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", String(tab.blockId === group.activeId));
        const iconCls = tab.agent ? "fa-solid fa-robot tab-agentlogo" : viewIcon(tab.view);
        let inner = `<i class="${iconCls}"></i><span>${tab.title}${tab.dup > 1 ? " " + tab.dup : ""}</span>`;
        if (tab.working) inner += `<span class="inline-tab-block-tab-statusdot is-working"></span>`;
        btn.innerHTML = inner;
        main.appendChild(btn);
        mainWrapper.appendChild(main);
        item.appendChild(mainWrapper);

        const closeBtn = el("button", "inline-tab-block-tab-close", '<i class="fa-sharp fa-solid fa-xmark"></i>');
        closeBtn.type = "button";
        closeBtn.title = "Close Block";
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            closeTab(groupId, tab.blockId);
        });
        item.appendChild(closeBtn);

        btn.addEventListener("click", () => {
            group.activeId = tab.blockId;
            renderGroup(groupId);
        });
        strip.appendChild(item);
    }
    strip.scrollTo({ left: strip.scrollWidth });

    /* 激活块内容 */
    const active = group.tabs.find((t) => t.blockId === group.activeId) ?? group.tabs[0];
    activeWrap.replaceChildren(renderActiveBlock(group, active));
}

function viewIcon(view) {
    return (
        {
            term: "fa-sharp fa-solid fa-square-terminal",
            preview: "fa-solid fa-folder-open",
            web: "fa-sharp fa-solid fa-globe",
            aisessions: "fa-sharp fa-regular fa-comments",
            sysinfo: "fa-sharp fa-solid fa-chart-line",
            processviewer: "fa-sharp fa-solid fa-list-tree",
        }[view] ?? "fa-sharp fa-solid fa-square"
    );
}

function renderActiveBlock(group, tab) {
    const frag = document.createDocumentFragment();

    /* header（镜像 BlockFrame_Header 简化形：icon+viewName … ⚙ ⼗ ✕） */
    const header = el("div", "block-frame-default-header");
    const iconView = el(
        "div",
        "block-frame-default-header-iconview",
        `<i class="${tab.agent ? "fa-solid fa-robot tab-agentlogo" : viewIcon(tab.view)}"></i>` +
            `<div class="block-frame-view-type">${tab.agent ? "agent · codex" : tab.title}</div>`
    );
    const endIcons = el(
        "div",
        "block-frame-end-icons",
        `<button type="button" class="iconbutton"><i class="fa-sharp fa-solid fa-cog"></i></button>
         <button type="button" class="iconbutton"><i class="fa-sharp fa-solid fa-box"></i></button>
         <button type="button" class="iconbutton"><i class="fa-sharp fa-solid fa-xmark-large"></i></button>`
    );
    header.append(iconView, endIcons);

    /* 假内容区 */
    const body = el("div", "block-content");
    if (tab.view === "preview") {
        body.innerHTML =
            `<span class="dim">explorer</span>  ~/code/snorkeling\n` +
            `├─ frontend/\n├─ pkg/\n├─ Taskfile.yml\n└─ <span class="ok">README.md</span>\n` +
            `<span class="cursor"></span>`;
    } else if (tab.agent) {
        body.innerHTML =
            `<span class="dim">$ codex --model gpt-5.2</span>\n` +
            `▸ reading frontend/app/block/block.tsx …\n` +
            `<span class="ok">✔ patch applied</span> blockframe-header.tsx (+42 −8)\n` +
            `<span class="cursor"></span>`;
    } else {
        body.innerHTML =
            `<span class="dim">nita@local</span>:~/code/snorkeling$ <span class="ok">task --list</span>\n` +
            `build     build the app\n test      run vitest\n` +
            `<span class="cursor"></span>`;
    }

    frag.append(header, body);
    return frag;
}

/* ---------- 关闭 tab（≤1 时禁止，模拟单 block 无 tab 条） ---------- */
function closeTab(groupId, blockId) {
    const group = GROUPS[groupId];
    if (group.tabs.length <= 1) {
        log(`<span class="warn">最后一个 tab —— 真实实现走 uxCloseBlock 关闭整个 Block，此处拦截演示</span>`);
        return;
    }
    group.tabs = group.tabs.filter((t) => t.blockId !== blockId);
    if (group.activeId === blockId) group.activeId = group.tabs[group.tabs.length - 1].blockId;
    log(`uxCloseBlock(<span class="api">${blockId}</span>) → removeBlockIdFromInlineTabNode`);
    renderGroup(groupId);
}

/* ---------- 「＋」菜单（新增②核心交互） ---------- */
let openMenu = null;

function closeMenu() {
    if (openMenu) {
        openMenu.menu.remove();
        openMenu.addbtn.classList.remove("open");
        openMenu = null;
    }
}

function openAddMenu(addbtn, groupId) {
    closeMenu();
    const group = GROUPS[groupId];
    const ctxHint = `${group.context.connection ?? "local"} · ${group.context.cwd}`;

    const menu = el("div", "ctxmenu");
    menu.appendChild(el("div", "ctxmenu-group-label", "New in this group"));
    for (const w of WIDGETS) {
        const item = el("div", "ctxmenu-item" + (w.actionOnly ? " disabled" : ""));
        item.dataset.widgetId = w.id;
        item.innerHTML =
            `<i class="${w.icon}"></i><span class="lbl">${w.label}</span>` +
            (w.actionOnly
                ? `<span class="skipbadge">action 型 · 本期跳过</span>`
                : w.special
                  ? `<span class="hint">→ ${ctxHint}</span>`
                  : "");
        item.addEventListener("click", () => {
            if (w.actionOnly) {
                log(`<span class="warn">${w.label}: action 型 widget 无 blockdef，不产 block —— 本期跳过</span>`);
                return;
            }
            addWidgetToGroup(groupId, w);
            closeMenu();
        });
        menu.appendChild(item);
        if (w.id === "defwidget@files") menu.appendChild(el("div", "ctxmenu-sep"));
    }

    document.body.appendChild(menu);
    const r = addbtn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    menu.style.top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8) + "px";
    menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + "px";
    addbtn.classList.add("open");
    openMenu = { menu, addbtn };
}

/* 点击菜单项 → 模拟「创建并加入本组」的真实调用链 */
function addWidgetToGroup(groupId, w) {
    const group = GROUPS[groupId];
    const ctx = `{connection:${group.context.connection ? `"${group.context.connection}"` : "null"}, "cmd:cwd":"${group.context.cwd}"}`;
    let defDesc = "";
    let newTab = null;

    switch (w.kind) {
        case "terminal":
            defDesc = `createTerminalBlockDef(${ctx})`;
            newTab = { blockId: "nb" + ++blockSeq, view: "term", title: basename(group.context.cwd) };
            break;
        case "agent":
            defDesc = `createDefaultAgentBlockDef(settings, ${ctx})  <span class="dim">// profile=settings["agent:defaultprofile"] ?? codex</span>`;
            newTab = { blockId: "nb" + ++blockSeq, view: "term", agent: true, working: true, title: `${basename(group.context.cwd)} · local` };
            break;
        case "files":
            defDesc = `widget.blockdef + file→cwd  <span class="dim">// {view:"preview","preview:pathisdir":true}</span>`;
            newTab = { blockId: "nb" + ++blockSeq, view: "preview", title: basename(group.context.cwd) };
            break;
        default:
            defDesc = `widget.blockdef <span class="dim">// 直通</span>`;
            newTab = { blockId: "nb" + ++blockSeq, view: w.id.replace("defwidget@", ""), title: w.label.toLowerCase() };
    }

    log(
        `<span class="act">[${w.label}]</span> ${defDesc}<br>` +
            `&nbsp;&nbsp;→ <span class="api">ObjectService.CreateBlock(blockDef)</span>` +
            ` → <span class="api">layoutModel.addBlockToInlineTab(nodeId, blockId)</span>` +
            ` <span class="dim">// 追加到组尾并激活聚焦</span>`
    );

    group.tabs.push(newTab);
    group.activeId = newTab.blockId;
    renderGroup(groupId);
}

/* ---------- 绑定 ---------- */
document.querySelectorAll("[data-addbtn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (openMenu && openMenu.addbtn === btn) {
            closeMenu();
            return;
        }
        openAddMenu(btn, btn.closest(".inline-tab-block").id);
    });
});

document.addEventListener("click", (e) => {
    if (openMenu && !openMenu.menu.contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
});

log(`menu 数据源：<span class="api">fullConfig.widgets</span> → shouldIncludeWidgetForWorkspace → sortByDisplayOrder`);
log(`特判三项继承激活 tab 的 connection/cmd:cwd；其余直通 widget.blockdef`);

/* 初始渲染 */
for (const id of Object.keys(GROUPS)) renderGroup(id);
