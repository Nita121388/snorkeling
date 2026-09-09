// ============ Block Info Cards 原型交互 ============
const $ = (sel, root) => (root ?? document).querySelector(sel);
const $$ = (sel, root) => [...(root ?? document).querySelectorAll(sel)];

const CIRCUMFERENCE = 254.5; // 2πr, r=40.5

// ============ 每张卡的状态变体文案 ============
const CARD_STATES = {
    "card-conn": {
        connected: (c) => {
            $("#conn-status", c).textContent = "Connected · 23 ms";
            $("#conn-uptime", c).textContent = "Uptime 3h 12m · 1 shell";
            $("#conn-avail", c).textContent = "99.2%";
            setStamp(c, false);
            setPulse(c, false);
        },
        connecting: (c) => {
            $("#conn-status", c).textContent = "Connecting…";
            $("#conn-uptime", c).textContent = "—";
            $("#conn-avail", c).textContent = "—";
            setStamp(c, false);
            setPulse(c, true);
        },
        dropped: (c) => {
            $("#conn-status", c).textContent = "Disconnected";
            $("#conn-uptime", c).textContent = "Last session 3h 12m";
            $("#conn-avail", c).textContent = "96.8%";
            setStamp(c, true, "Dropped");
            setPulse(c, false);
        },
    },
    "card-site": {
        secure: (c) => {
            $("#site-security", c).textContent = "HTTPS · certificate valid";
            $("#site-trackers", c).textContent = "3 blocked on this page";
            setStamp(c, false);
        },
        mixed: (c) => {
            $("#site-security", c).textContent = "HTTPS · mixed content on page";
            $("#site-trackers", c).textContent = "3 blocked · 2 insecure assets";
            setStamp(c, true, "Not secure");
        },
        insecure: (c) => {
            $("#site-security", c).textContent = "No TLS · credentials at risk";
            $("#site-trackers", c).textContent = "2 blocked";
            setStamp(c, true, "Not secure");
        },
    },
    "card-file": {
        clean: (c) => {
            $("#file-edits span:last-child", c).textContent = "Saved · in sync";
            $("#file-modified", c).textContent = "12m ago · by you";
            $("#file-edittotal", c).textContent = "9 edits";
            setStamp(c, false);
        },
        dirty: (c) => {
            $("#file-edits span:last-child", c).textContent = "Unsaved draft · 2 hunks";
            $("#file-modified", c).textContent = "just now · by you";
            $("#file-edittotal", c).textContent = "9 edits";
            setStamp(c, true, "Draft");
        },
        readonly: (c) => {
            $("#file-edits span:last-child", c).textContent = "Read-only · owned by root";
            $("#file-modified", c).textContent = "2d ago";
            $("#file-edittotal", c).textContent = "—";
            setStamp(c, false);
        },
    },
    "card-repo": {
        insync: (c) => {
            $("#repo-branch", c).textContent = "main";
            $("#repo-sync", c).textContent = "In sync with origin";
            $("#repo-pipeline span:last-child", c).textContent = "CI passed · 4m 12s";
            $("#repo-pipeline .status-dot", c).style.background = "var(--c-done)";
            setStamp(c, false);
        },
        ahead: (c) => {
            $("#repo-branch", c).textContent = "main";
            $("#repo-sync", c).textContent = "↑2 ↓3 · fetched 4m ago";
            $("#repo-pipeline span:last-child", c).textContent = "CI running · 1m 03s";
            $("#repo-pipeline .status-dot", c).style.background = "var(--c-working)";
            setStamp(c, false);
        },
        conflict: (c) => {
            $("#repo-branch", c).textContent = "feature/remote-sync";
            $("#repo-sync", c).textContent = "Merge conflict · 2 files";
            $("#repo-pipeline span:last-child", c).textContent = "CI blocked";
            $("#repo-pipeline .status-dot", c).style.background = "var(--c-error)";
            setStamp(c, true, "Conflict");
        },
    },
    "card-sys": {
        calm: (c) => setSystem(c, 34, "34% · 8 cores · M-series", "6.2 GB", "512 GB · 71% used", "avg 34%"),
        busy: (c) => setSystem(c, 67, "67% · 8 cores · M-series", "12.4 GB", "512 GB · 78% used", "avg 52%"),
        overload: (c) => setSystem(c, 91, "91% · 8 cores · throttled", "29.8 GB", "512 GB · 93% used", "avg 81%"),
    },
};

function setStamp(card, visible, text) {
    const stamp = $(".card-stamp", card);
    stamp.hidden = !visible;
    if (text) stamp.textContent = text;
}

function setPulse(card, pulsing) {
    const ring = $(".photo-ring", card);
    const dot = $(".status-dot", card);
    ring.classList.toggle("is-pulsing", pulsing);
    dot.classList.toggle("is-pulsing", pulsing);
}

function setSystem(card, pct, cpuDetail, mem, disk, avg) {
    $("#sys-cpu", card).firstChild.textContent = pct;
    $("#sys-cpudetail", card).textContent = cpuDetail;
    $("#sys-mem", card).textContent = mem;
    $("#sys-disk", card).textContent = disk;
    $("#sys-avg", card).textContent = avg;
    $("#sys-gauge", card).style.strokeDashoffset = (CIRCUMFERENCE * (1 - pct / 100)).toFixed(1);
    setStamp(card, pct > 80, pct > 80 ? "Overload" : "");
    if (pct <= 80) stampHiddenOnly(card);
}

function stampHiddenOnly(card) {
    // overload 是唯一盖章的 sysinfo 状态；其余隐藏
    const stamp = $(".card-stamp", card);
    if (card.dataset.state !== "overload") stamp.hidden = true;
    else stamp.hidden = false;
}

// ============ 状态 pills ============
function wireStatePills() {
    $$(".state-pills").forEach((group) => {
        const card = document.getElementById(group.dataset.card);
        $$(".state-pill", group).forEach((pill) => {
            pill.addEventListener("click", () => {
                card.dataset.state = pill.dataset.state;
                $$(".state-pill", group).forEach((p) => p.classList.toggle("is-active", p === pill));
                CARD_STATES[group.dataset.card]?.[pill.dataset.state]?.(card);
            });
        });
    });
}

// ============ 评审控件 ============
function wireReviewControls() {
    $("#theme-select").addEventListener("change", (e) => {
        document.body.dataset.theme = e.target.value;
    });
    $("#desk-toggle").addEventListener("change", (e) => {
        $$(".desk").forEach((d) => d.classList.toggle("is-dark", e.target.checked));
    });
}

// ============ 复制按钮 + toast ============
function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 1800);
}

function wireCopyButtons() {
    $$(".copy-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            navigator.clipboard?.writeText(btn.dataset.copy).then(
                () => toast("Copied: " + btn.dataset.copy.slice(0, 40)),
                () => toast("Clipboard unavailable (prototype)")
            );
        });
    });
}

wireStatePills();
wireReviewControls();
wireCopyButtons();
