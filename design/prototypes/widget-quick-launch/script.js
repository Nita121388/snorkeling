/* Widget Quick Launch 原型交互
 * 镜像源：widgets.tsx / keymodel.ts / inlinetab-addmenu.tsx / inlineTabs.ts
 * 调用链日志标注真实 API：openWidgetQuickLaunch / pickGroupAddableWidgets /
 *   ObjectService.CreateBlock / layoutModel.addBlockToInlineTab /
 *   requestLaunchPopup(terminal/agent → target selector)
 */

"use strict";

/* ---------- widget 注册表（镜像 widgets.json + pickGroupAddableWidgets 过滤规则） ---------- */
const WIDGETS = [
    { id: "defwidget@terminal", order: -5, icon: "fa-sharp fa-solid fa-square-terminal",
      label: "Terminal", kind: "terminal", special: true, color: "" },
    { id: "defwidget@agent", order: -4, icon: "fa-solid fa-robot",
      label: "Agent", kind: "agent", special: true, color: "#74a7cb" },
    { id: "defwidget@files", order: -3, icon: "fa-solid fa-folder-open",
      label: "Files", kind: "files", special: true, color: "" },
    { id: "defwidget@sessions", order: -2, icon: "fa-sharp fa-regular fa-comments",
      label: "Sessions", kind: null, color: "" },
    { id: "defwidget@commontext", order: -1.5, icon: "fa-sharp fa-solid fa-quote-left",
      label: "Text", kind: null, actionOnly: true, color: "" },
    { id: "defwidget@web", order: -1, icon: "fa-sharp fa-solid fa-globe",
      label: "Web", kind: null, color: "" },
    { id: "defwidget@sysinfo", order: 0, icon: "fa-sharp fa-solid fa-chart-line",
      label: "Sysinfo", kind: null, color: "" },
    { id: "defwidget@processviewer", order: 1, icon: "fa-sharp fa-solid fa-list-tree",
      label: "Processes", kind: null, color: "" },
];

/* ---------- 初始 Tab 布局（三个 pane：1 单 Block + 1 组 + 1 单 Block） ---------- */
let blockSeq = 200;
const INITIAL_TAB = {
    panes: [
        { id: "p-term", type: "block", view: "term", title: "snorkeling", agent: false },
        {
            id: "p-grp", type: "group", activeId: "g1-a", tabs: [
                { id: "g1-a", view: "preview", title: "AGENTS.md", agent: false },
                { id: "g1-b", view: "term", title: "prod · ssh", agent: false },
            ],
        },
        { id: "p-files", type: "block", view: "preview", title: "~/code/snorkeling", agent: false },
    ],
    focusedId: "p-grp",
};
let tabState = JSON.parse(JSON.stringify(INITIAL_TAB));

/* ---------- 工具 ---------- */
const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
};
const now = () => new Date().toTimeString().slice(0, 8);

function log(html) {
    const line = el("div", null, `<span class="t">${now()}</span> ▸ ${html}`);
    document.getElementById("log").appendChild(line);
    line.scrollIntoView({ block: "nearest" });
}

/* ---------- 渲染 Tab 布局（结果预览） ---------- */
function renderTab() {
    const win = document.getElementById("tabWindow");
    win.innerHTML = "";
    for (const pane of tabState.panes) {
        const div = el("div", "pane" + (pane.id === tabState.focusedId ? " focused" : ""));
        div.dataset.paneId = pane.id;

        if (pane.type === "group") {
            const tabs = el("div", "pane-tabs");
            for (const tab of pane.tabs) {
                const t = el("div", "pane-tab" + (tab.id === pane.activeId ? " active" : ""));
                t.innerHTML = `<i class="${tab.agent ? "fa-solid fa-robot" : viewIcon(tab.view)}"></i><span>${tab.title}</span>`;
                t.addEventListener("click", (e) => { e.stopPropagation(); pane.activeId = tab.id; renderTab(); });
                tabs.appendChild(t);
            }
            const active = pane.tabs.find((t) => t.id === pane.activeId) ?? pane.tabs[0];
            const block = el("div", "pane-block");
            block.append(renderPaneHeader(active), renderPaneBody(active));
            div.append(tabs, block);
        } else {
            const block = el("div", "pane-block");
            block.append(renderPaneHeader(pane), renderPaneBody(pane));
            div.appendChild(block);
        }

        div.addEventListener("click", () => { tabState.focusedId = pane.id; renderTab(); });
        win.appendChild(div);
    }
}

function viewIcon(view) {
    return {
        term: "fa-sharp fa-solid fa-square-terminal",
        preview: "fa-solid fa-folder-open",
        web: "fa-sharp fa-solid fa-globe",
        sessions: "fa-sharp fa-regular fa-comments",
        sysinfo: "fa-sharp fa-solid fa-chart-line",
        processviewer: "fa-sharp fa-solid fa-list-tree",
    }[view] ?? "fa-sharp fa-solid fa-square";
}

function renderPaneHeader(tab) {
    const h = el("div", "pane-header");
    h.innerHTML = `<i class="${tab.agent ? "fa-solid fa-robot" : viewIcon(tab.view)}"></i>` +
        `<span>${tab.title}</span><span class="dim">${tab.view}</span>`;
    return h;
}

function renderPaneBody(tab) {
    const b = el("div", "pane-body");
    if (tab.view === "preview") {
        b.innerHTML = `<span class="dim">explorer</span>  ~/code/snorkeling\n├─ frontend/\n├─ pkg/\n└─ <span class="ok">README.md</span>\n<span class="cursor"></span>`;
    } else if (tab.agent) {
        b.innerHTML = `<span class="dim">$ codex --model gpt-5.2</span>\n▸ reading frontend/app/block/block.tsx …\n<span class="ok">✔ patch applied</span> (+42 −8)\n<span class="cursor"></span>`;
    } else {
        b.innerHTML = `<span class="dim">nita@local</span>:~/code/snorkeling$ <span class="ok">task --list</span>\nbuild     build the app\n test      run vitest\n<span class="cursor"></span>`;
    }
    return b;
}

/* ---------- Quick Launch 面板 ---------- */
let paletteState = { open: false, selected: null, highlightIdx: -1 };

function renderList() {
    const list = document.getElementById("qlaunchList");
    list.innerHTML = "";
    paletteState.highlightIdx = paletteState.selected ? -1 : 0;
    WIDGETS.forEach((w, idx) => {
        const item = el("div", "qlaunch-item");
        item.dataset.idx = idx;
        const hint = w.kind ? "→ 新建" : "";
        const badge = w.actionOnly ? `<span class="action-badge">action · 无 blockdef</span>` : "";
        item.innerHTML =
            `<i class="${w.icon} qlaunch-item-icon" style="color:${w.color || "inherit"}"></i>` +
            `<span class="lbl">${w.label}</span>` +
            (w.actionOnly ? badge : `<span class="hint">${hint}</span>`);
        item.addEventListener("click", () => selectWidget(idx));
        list.appendChild(item);
    });
    updateHighlight();
}

function updateHighlight() {
    document.querySelectorAll(".qlaunch-item").forEach((el, idx) => {
        el.classList.toggle("highlight", idx === paletteState.highlightIdx);
    });
}

function openPalette() {
    if (paletteState.open) return;
    paletteState.open = true;
    paletteState.selected = null;
    paletteState.highlightIdx = 0;
    document.getElementById("qlaunchOverlay").hidden = false;
    document.getElementById("qlaunchFooter").hidden = true;
    renderList();
    log(`<span class="act">⌘⇧P</span> → <span class="api">openWidgetQuickLaunch()</span>`);
}

function closePalette() {
    paletteState.open = false;
    paletteState.selected = null;
    document.getElementById("qlaunchOverlay").hidden = true;
}

function selectWidget(idx) {
    const w = WIDGETS[idx];
    paletteState.selected = w;

    if (w.actionOnly) {
        log(`<span class="act">[${w.label}]</span> <span class="api">openCommonTextSearch()</span> <span class="dim">// action 型，无 blockdef，不产 block</span>`);
        closePalette();
        return;
    }

    /* 高亮选中行，显示 footer 放置按钮 */
    document.querySelectorAll(".qlaunch-item").forEach((el, i) => {
        el.classList.toggle("highlight", i === idx);
    });
    const footer = document.getElementById("qlaunchFooter");
    footer.hidden = false;
    document.getElementById("footerLabel").textContent = `放置「${w.label}」到`;
}

function handlePlacement(place) {
    const w = paletteState.selected;
    if (!w) return;
    if (w.kind === "terminal" || w.kind === "agent") {
        openTargetSelector(w, place);   // 二级弹窗：New Agent / New Terminal 目标选择器
        return;
    }
    doCreate(w, place, null);
    closePalette();
}

/* 通用创建 + 布局放置（Terminal/Agent 经二级弹窗后也走这里） */
function doCreate(w, place, info) {
    const focusedPane = tabState.panes.find((p) => p.id === tabState.focusedId);
    const newId = "nb" + ++blockSeq;
    const newTab = { id: newId, view: w.kind === "agent" ? "term" : (w.kind === "files" ? "preview" : w.label.toLowerCase()), title: w.label, agent: w.kind === "agent" };

    let createExpr = "";
    if (w.kind === "terminal") createExpr = `createTerminalBlockDefForTarget(target)`;
    else if (w.kind === "agent") createExpr = `createAgentBlockDefForProfile(settings["agent:defaultprofile"], settings)`;
    else if (w.kind === "files") createExpr = `widget.blockdef + file→cwd <span class="dim">// {view:"preview","preview:pathisdir":true}</span>`;
    else createExpr = `widget.blockdef <span class="dim">// 直通</span>`;

    const placeLabel = place === "group" ? "Current Group" : "New Block";
    if (info) {
        const sink = place === "group"
            ? `<span class="api">sinkNodeId:"${focusedPane.id}"</span> <span class="dim">// 创建漏斗改道进组</span>`
            : "null";
        log(
            `<span class="act">[${w.label}]</span> 放置=<b>${placeLabel}</b>` +
            `<br>&nbsp;&nbsp;→ <span class="api">requestLaunchPopup({mode:"${w.kind}", anchorEl, sinkNodeId:${sink}})</span>` +
            `<br>&nbsp;&nbsp;→ 目标 <span class="ok">${info.path}</span>${info.profile ? ` · profile=<span class="ok">${info.profile}</span>` : ""}` +
            `<br>&nbsp;&nbsp;→ ${createExpr}` +
            `<br>&nbsp;&nbsp;→ <span class="api">ObjectService.CreateBlock(blockDef)</span>`
        );
    } else {
        log(
            `<span class="act">[${w.label}]</span> 放置=<b>${placeLabel}</b>` +
            `<br>&nbsp;&nbsp;→ ${createExpr}` +
            `<br>&nbsp;&nbsp;→ <span class="api">ObjectService.CreateBlock(blockDef)</span>`
        );
    }

    /* 布局放置 */
    if (place === "group") {
        if (focusedPane.type === "group") {
            log(`<br>&nbsp;&nbsp;→ <span class="api">layoutModel.addBlockToInlineTab("${focusedPane.id}", "${newId}")</span> <span class="dim">// 追加为新 Tab</span>`);
            focusedPane.tabs.push(newTab);
            focusedPane.activeId = newId;
        } else {
            log(`<br>&nbsp;&nbsp;→ <span class="api">layoutModel.addBlockToInlineTab("${focusedPane.id}", "${newId}")</span> <span class="dim">// 单 Block → 升级为组</span>`);
            const origTab = { id: focusedPane.id + "-orig", view: focusedPane.view, title: focusedPane.title, agent: focusedPane.agent };
            const newGroup = { id: focusedPane.id, type: "group", activeId: newId, tabs: [origTab, newTab] };
            const idx = tabState.panes.indexOf(focusedPane);
            tabState.panes[idx] = newGroup;
        }
    } else {
        log(`<br>&nbsp;&nbsp;→ <span class="dim">env.createBlock(blockDef) // 当前 Tab 新建兄弟 Block</span>`);
        const newPane = { id: newId, type: "block", view: newTab.view, title: newTab.title, agent: newTab.agent };
        const idx = tabState.panes.indexOf(focusedPane);
        tabState.panes.splice(idx + 1, 0, newPane);
        tabState.focusedId = newId;
    }

    renderTab();
    const added = document.querySelector(`.pane[data-pane-id="${newId}"]`);
    if (added) added.classList.add("just-added");
}

/* ---------- 二级弹窗：New Agent / New Terminal 目标选择器 ---------- */
const TARGET_PROFILES = ["codex", "claude", "gemini", "opencode", "pi"];
const TARGET_PATHS = [
    { label: "~", detail: "Home", source: "home", icon: "fa-sharp fa-regular fa-house" },
    { label: "~/code/snorkeling", detail: "Current Workspace", source: "files", icon: "fa-sharp fa-regular fa-folder" },
    { label: "prod-box · ssh://nita", detail: "Remote", source: "agent", icon: "fa-sharp fa-regular fa-terminal" },
];
const PROFILE_COLORS = { codex: "#74a7cb", claude: "#cc685c", gemini: "#8e7cc3", opencode: "#e0b956", pi: "#888" };
let tState = { mode: null, place: null, profileIdx: 0, pathIdx: 0 };

function openTargetSelector(w, place) {
    tState = { mode: w.kind, place, profileIdx: 0, pathIdx: 0 };
    const title = document.getElementById("qtargetTitle");
    title.innerHTML = w.kind === "agent"
        ? `<i class="fa-solid fa-robot"></i> New Agent`
        : `<i class="fa-sharp fa-solid fa-square-terminal"></i> New Terminal`;
    document.getElementById("qtargetProfiles").hidden = w.kind !== "agent";
    document.getElementById("qtargetFooterHint").textContent = place === "group" ? "Add to Group" : "New Block";
    renderTargetSelector();
    document.getElementById("qtargetOverlay").hidden = false;
    log(`<span class="act">[${w.label}]</span> 放置=<b>${place === "group" ? "Current Group" : "New Block"}</b> → <span class="dim">打开二级弹窗（${w.kind === "agent" ? "New Agent" : "New Terminal"} 目标选择器）</span>`);
}

function renderTargetSelector() {
    const prow = document.getElementById("qtargetProfilesRow");
    prow.innerHTML = "";
    TARGET_PROFILES.forEach((p, i) => {
        const b = el("div", "qprofile" + (i === tState.profileIdx ? " active" : ""));
        b.innerHTML = `<span class="dot" style="background:${PROFILE_COLORS[p] || "#888"}"></span>${p}`;
        b.addEventListener("click", () => { tState.profileIdx = i; renderTargetSelector(); });
        prow.appendChild(b);
    });
    const pwrap = document.getElementById("qtargetPaths");
    pwrap.innerHTML = "";
    TARGET_PATHS.forEach((p, i) => {
        const row = el("div", "qpath" + (i === tState.pathIdx ? " active" : ""));
        row.innerHTML = `<i class="qpath-icon ${p.icon}"></i><div class="qpath-main"><div class="qpath-label">${p.label}</div><div class="qpath-detail">${p.detail}</div></div>`;
        row.addEventListener("click", () => { tState.pathIdx = i; renderTargetSelector(); });
        pwrap.appendChild(row);
    });
}

function confirmTarget() {
    const w = paletteState.selected;
    if (!w) return;
    const path = TARGET_PATHS[tState.pathIdx];
    const profile = tState.mode === "agent" ? TARGET_PROFILES[tState.profileIdx] : null;
    doCreate(w, tState.place, { path: path.label, profile });
    document.getElementById("qtargetOverlay").hidden = true;
    closePalette();
}

function closeTargetSelector() {
    document.getElementById("qtargetOverlay").hidden = true;
}


/* ---------- 键盘事件 ---------- */
document.addEventListener("keydown", (e) => {
    /* Cmd/Ctrl+Shift+P：打开/关闭面板（二级弹窗打开时不触发） */
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyP") {
        e.preventDefault();
        e.stopPropagation();
        if (!document.getElementById("qtargetOverlay").hidden) return;
        if (paletteState.open) closePalette(); else openPalette();
        return;
    }
    /* 二级弹窗优先响应 */
    if (!document.getElementById("qtargetOverlay").hidden) {
        if (e.key === "Escape") { e.preventDefault(); closeTargetSelector(); }
        if (e.key === "Enter") { e.preventDefault(); confirmTarget(); }
        return;
    }
    if (!paletteState.open) return;
    const count = WIDGETS.length;
    if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); paletteState.highlightIdx = (paletteState.highlightIdx + 1) % count; updateHighlight(); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); paletteState.highlightIdx = (paletteState.highlightIdx - 1 + count) % count; updateHighlight(); return; }
    if (e.key === "Enter") { e.preventDefault(); if (paletteState.highlightIdx >= 0) selectWidget(paletteState.highlightIdx); return; }
});

/* ---------- 按钮绑定 ---------- */
document.getElementById("openPalette").addEventListener("click", () => { if (paletteState.open) closePalette(); else openPalette(); });
document.getElementById("qlaunchOverlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) closePalette(); });
document.getElementById("footerBack").addEventListener("click", () => { paletteState.selected = null; document.getElementById("qlaunchFooter").hidden = true; updateHighlight(); });

document.querySelectorAll("[data-place]").forEach((btn) => {
    btn.addEventListener("click", () => handlePlacement(btn.dataset.place));
});

/* 二级弹窗（New Agent / New Terminal 目标选择器）绑定 */
document.getElementById("qtargetOverlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeTargetSelector(); });
document.getElementById("qtargetCreate").addEventListener("click", () => confirmTarget());
document.getElementById("qtargetCancel").addEventListener("click", () => closeTargetSelector());
document.getElementById("qtargetEnv").addEventListener("click", () => {
    log(`<span class="act">[Env]</span> <span class="api">openEnvModal(launchEnv)</span> <span class="dim">// 本次启动自定义变量，浮窗关闭不丢失</span>`);
});

/* ---------- 初始渲染 ---------- */
renderTab();
log(`数据源：<span class="api">fullConfig.widgets</span> → <span class="api">pickGroupAddableWidgets()</span> → 居中浮层（无搜索框，widget 数量少）`);
log(`按 <span class="act">⌘⇧P</span> 或点上方按钮打开面板`);
