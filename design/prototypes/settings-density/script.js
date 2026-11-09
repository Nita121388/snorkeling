// 设置界面去密化原型 — 交互脚本（纯 vanilla，无依赖）
// 只做演示需要的行为：面板切换、before/after、主题、开关、步进、RadioCard、折叠、搜索、保存模型。

(function () {
    "use strict";

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];


    /* 只有一个 h1：把当前可见面板的标题提升为 h1，其余降回 div。
       隐藏面板若保留 h1 会让无障碍/审计工具读到错误标题。 */
    function promoteH1() {
        $$(".wcfg-header .h-title").forEach((el) => {
            const d = document.createElement("div");
            d.className = el.className;
            d.innerHTML = el.innerHTML;
            el.replaceWith(d);
        });
        const visible = $$(".wcfg-header .h-title").find((el) => el.offsetParent !== null);
        if (visible) {
            const h = document.createElement("h1");
            h.className = visible.className;
            h.innerHTML = visible.innerHTML;
            visible.replaceWith(h);
        }
    }

    /* ---------- 面板切换 ---------- */
    const panelMap = {
        notify: "panel-notify",
        general: "panel-general",
        sync: "panel-sync",
    };

    function switchPanel(key) {
        const targetId = panelMap[key] || "panel-na";
        $$(".wcfg-panel").forEach((p) => p.classList.toggle("on", p.id === targetId));
        $$("#seg-panel button").forEach((b) => b.classList.toggle("on", b.dataset.panel === key));
        $$(".sb-item[data-panel]").forEach((it) => it.classList.toggle("on", it.dataset.panel === key));
        promoteH1();
    }

    $$("#seg-panel button").forEach((b) => b.addEventListener("click", () => switchPanel(b.dataset.panel)));
    $$(".sb-item[data-panel]").forEach((it) => it.addEventListener("click", () => switchPanel(it.dataset.panel)));

    /* ---------- 提案 / 现状 切换（面板 + 侧栏一起切） ---------- */
    function switchMode(mode) {
        $$("[data-render]").forEach((el) => {
            el.style.display = el.dataset.render === mode ? "" : "none";
        });
        $$("#seg-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
        $("#sidebar").classList.toggle("before", mode === "before");
        // 现状侧栏没有选中态同步需求，仅提案侧栏跟随
        if (mode === "before") {
            $$(".sb-before .sb-item").forEach((it) => it.classList.remove("on"));
        }
        promoteH1();
    }

    $$("#seg-mode button").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));

    /* ---------- 主题切换 ---------- */
    $$("#seg-theme button").forEach((b) =>
        b.addEventListener("click", () => {
            document.documentElement.dataset.theme = b.dataset.theme;
            $$("#seg-theme button").forEach((x) => x.classList.toggle("on", x === b));
        })
    );

    /* ---------- "已保存" 印章（即时保存反馈） ---------- */
    function flashStamp(id) {
        const stamp = document.getElementById(id);
        if (!stamp) return;
        stamp.classList.add("show");
        clearTimeout(stamp._t);
        stamp._t = setTimeout(() => stamp.classList.remove("show"), 1800);
    }

    let masterOn = true;

    /* ---------- 开关：即时保存 + 印章；通知面板跟随总开关禁用态 ---------- */
    $$('input[type="checkbox"][data-autosave]').forEach((cb) => {
        cb.addEventListener("change", () => {
            const panel = cb.closest(".wcfg-panel");
            if (panel && panel.id === "panel-notify") {
                // 第一枚开关是总开关：置灰其余行 + 更新徽标
                const rows = $$(".set-row", panel);
                const isMaster = rows[0] && rows[0].contains(cb);
                if (isMaster) {
                    masterOn = cb.checked;
                    rows.forEach((r, i) => {
                        if (i === 0) return;
                        r.classList.toggle("disabled", !masterOn);
                        const input = $("input", r);
                        if (input) input.disabled = !masterOn;
                    });
                    const badge = $(".row-badge", rows[0]);
                    if (badge) badge.textContent = masterOn ? "On" : "Off";
                    // 预览同步：总开关关掉后预览置灰并换成说明
                    const pv = $("#toast-preview");
                    if (pv) {
                        pv.classList.toggle("off", !masterOn);
                        const title = $(".tp-title", pv);
                        const body = $(".tp-body", pv);
                        const time = $(".tp-time", pv);
                        if (title) title.textContent = masterOn ? "Agent finished" : "Notifications off";
                        if (body) body.textContent = masterOn ? "“拉取最新代码” · T2" : "No toasts will be raised.";
                        if (time) time.style.visibility = masterOn ? "" : "hidden";
                    }
                }
            }
            flashStamp(panel && panel.id === "panel-general" ? "stamp-general" : "stamp-notify");
        });
    });

    /* ---------- 步进器 ---------- */
    $$(".stepper").forEach((st) => {
        const val = $(".st-val", st);
        const [minus, plus] = $$("button", st);
        minus.addEventListener("click", () => bump(st, -1));
        plus.addEventListener("click", () => bump(st, +1));
        st._val = val;
    });

    function bump(st, delta) {
        const el = st._val;
        const cur = parseInt(el.textContent, 10) || 0;
        el.textContent = String(Math.max(0, cur + delta));
        const panel = st.closest(".wcfg-panel");
        flashStamp(panel && panel.id === "panel-general" ? "stamp-general" : "stamp-notify");
        markSyncDirty(st);
    }

    /* ---------- RadioCard ---------- */
    $$("[data-rc]").forEach((card) => {
        card.addEventListener("click", () => {
            const deck = card.closest(".radiocards");
            if (!deck) return;
            $$(".rc", deck).forEach((c) => c.classList.remove("on"));
            card.classList.add("on");
            const panel = card.closest(".wcfg-panel");
            flashStamp(panel && panel.id === "panel-general" ? "stamp-general" : "stamp-notify");
            markSyncDirty(card);
        });
    });

    /* ---------- 折叠 ---------- */
    $$(".acc-head").forEach((head) => {
        head.addEventListener("click", () => head.parentElement.classList.toggle("open"));
    });

    /* ---------- General：Visual / Raw JSON 标签页 ---------- */
    function switchGTab(tab) {
        const visual = $("#gtab-visual");
        const json = $("#gtab-json");
        if (!visual || !json) return;
        visual.style.display = tab === "visual" ? "" : "none";
        json.style.display = tab === "json" ? "" : "none";
        $$(".wcfg-tabs .tab").forEach((t) => t.classList.toggle("on", t.dataset.gtab === tab));
    }

    $$(".wcfg-tabs .tab").forEach((t) => t.addEventListener("click", () => switchGTab(t.dataset.gtab)));
    $$("[data-gtab-jump]").forEach((b) =>
        b.addEventListener("click", () => switchGTab(b.dataset.gtabJump))
    );

    /* ---------- Raw JSON 代码墙（before 与 after 的 json 标签共用同一份示例） ---------- */
    const jsonLines = [
        "{",
        '  "ai:defaultprofile": "claude",',
        '  "agent:defaultprofile": "claude",',
        '  "app:theme": "light",',
        '  "app:confirmquit": true,',
        '  "app:ctrlvpaste": true,',
        '  "app:defaultnewblock": "term",',
        '  "app:globalhotkey": "CmdOrCtrl+Shift+Space",',
        '  "app:hideaibutton": false,',
        '  "app:showoverlayblocknums": false,',
        '  "autoupdate:channel": "stable",',
        '  "autoupdate:enabled": true,',
        '  "editor:fontsize": 13,',
        '  "editor:minimapenabled": false,',
        '  "markdown:fontsize": 14,',
        '  "note:autosave": true,',
        '  "term:fontfamily": "Hack",',
        '  "term:fontsize": 13,',
        '  "term:copyonselect": true,',
        '  "term:cursorblink": true,',
        '  "term:scrollback": 1000,',
        '  "tab:confirmclose": false,',
        '  "telemetry:enabled": true,',
        '  "web:defaultsearch": "google",',
        '  "window:opacity": 0.8,',
        '  "window:reducedmotion": false,',
        '  "window:savelastwindow": true,',
        '  "window:showmenubar": false,',
        '  "window:tilegapsize": 8',
        "}",
    ];

    function renderJsonWall(el) {
        if (!el || el._filled) return;
        el._filled = true;
        el.innerHTML = jsonLines
            .map((line, i) => {
                const esc = line.replace(/&/g, "&amp;").replace(/</g, "&lt;");
                let out;
                const kv = esc.match(/^(\s*)"([^"]+)":\s*(.*?),?$/);
                if (kv) {
                    out = `${kv[1]}<span style="color:#96d0ff">"${kv[2]}"</span>: ${kv[3]}`;
                } else if (esc.includes("//")) {
                    out = `<span style="color:#768390">${esc}</span>`;
                } else {
                    out = `<span style="color:#96d0ff">${esc.replace(/"(\w+)":/g, '"$1":')}</span>`;
                }
                return `<div><span class="ln">${i + 1}</span>${out}</div>`;
            })
            .join("");
    }

    renderJsonWall($("#gen-json-editor"));
    renderJsonWall($("#gen-json-editor-before"));

    /* ---------- Sync：草稿保存模型（唯一的 Save 型面板） ---------- */
    const syncSaveBtns = [$("#sync-save-btn"), $("#sync-save-btn-2")];
    const syncDirtyHint = $("#sync-dirty-hint");

    function markSyncDirty(el) {
        const panel = el && el.closest ? el.closest(".wcfg-panel") : null;
        if (!panel || panel.id !== "panel-sync") return;
        syncSaveBtns.forEach((b) => b && (b.disabled = false));
        if (syncDirtyHint) syncDirtyHint.style.display = "";
    }

    $$("[data-sync-dirty]").forEach((el) => {
        if (el.tagName === "INPUT") {
            el.addEventListener("input", markSyncDirty);
        }
    });

    syncSaveBtns.forEach((b) =>
        b &&
        b.addEventListener("click", () => {
            syncSaveBtns.forEach((x) => x && (x.disabled = true));
            if (syncDirtyHint) syncDirtyHint.style.display = "none";
        })
    );

    // segmented（冲突策略 / 推送模式）
    $$(".acc .seg button").forEach((b) => {
        b.addEventListener("click", () => {
            $$("button", b.parentElement).forEach((x) => x.classList.remove("on"));
            b.classList.add("on");
            markSyncDirty(b);
        });
    });

    /* ---------- 侧栏搜索（提案） ---------- */
    const searchInput = $("#sb-search-input");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            const q = searchInput.value.trim().toLowerCase();
            $$(".sb-after .sb-item").forEach((it) => {
                it.style.display = it.textContent.toLowerCase().includes(q) ? "" : "none";
            });
            $$(".sb-after .sb-group-label").forEach((label) => {
                let hasVisible = false;
                let sib = label.nextElementSibling;
                while (sib && !sib.classList.contains("sb-group-label")) {
                    if (sib.classList.contains("sb-item") && sib.style.display !== "none") hasVisible = true;
                    sib = sib.nextElementSibling;
                }
                label.style.display = hasVisible ? "" : "none";
            });
        });
    }

    /* 初始：默认提案 + 通知面板；支持 URL hash 直链
       #panel=general&mode=after&theme=dark 等 */
    function readHash() {
        const p = new URLSearchParams(location.hash.replace(/^#/, ""));
        const panel = p.get("panel");
        const mode = p.get("mode");
        const theme = p.get("theme");
        if (theme === "light" || theme === "dark") {
            document.documentElement.dataset.theme = theme;
            $$("#seg-theme button").forEach((b) => b.classList.toggle("on", b.dataset.theme === theme));
        }
        if (mode === "before" || mode === "after") switchMode(mode);
        if (panel) switchPanel(panel);
    }

    switchMode("after");
    readHash();
    promoteH1();
    window.addEventListener("hashchange", readHash);
})();
