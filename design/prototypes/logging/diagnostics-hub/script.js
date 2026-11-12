// 诊断中心（Diagnostics Hub）融合原型 —— 纯 DOM，无依赖。
// 数据为固定 mock（时间基准固定，便于 smoke test 断言）。
// 设计依据：design/plans/project-logging.md（§7 读取面 / §8 域清单 / §9 与 AI Audit 边界）

const NOW = Date.parse("2026-11-12T14:20:00");
const H = 3600 * 1000;
const M = 60 * 1000;

// ───────────────────────── mock：AI 调用审计（业务审计，对应 aiaudit 表） ─────────────────────────
const AUDITS = [
    {
        id: "a18",
        createdAt: NOW - 3 * M,
        feature: "title",
        sessionTitle: "snorkeling 终端主题改造",
        sessionKey: "fnv1a64:9a1c2b3d4e5f6071",
        model: "claude-sonnet-4",
        state: "running",
        durationMs: 14_000,
        blockId: "blk-7f3a",
        resultCount: 0,
        anchorTotal: 0,
        anchorKept: 0,
    },
    {
        id: "a17",
        createdAt: NOW - 21 * M,
        feature: "annotation-timeline",
        sessionTitle: "CommonText 后台发送",
        sessionKey: "fnv1a64:1122334455667788",
        model: "claude-sonnet-4",
        state: "failed",
        durationMs: 61_000,
        blockId: "blk-7f3a",
        resultCount: 0,
        anchorTotal: 0,
        anchorKept: 0,
        error: "timeout after 60s · rpc:AISessions.GenerateTimeline",
    },
    {
        id: "a16",
        createdAt: NOW - 48 * M,
        feature: "metadata",
        sessionTitle: "日志系统设计讨论",
        sessionKey: "fnv1a64:aabbccddeeff0011",
        model: "gpt-5.1-codex",
        state: "done",
        durationMs: 8_400,
        blockId: "blk-2c91",
        resultCount: 3,
        anchorTotal: 0,
        anchorKept: 0,
    },
    {
        id: "a15",
        createdAt: NOW - 2 * H,
        feature: "annotation-field",
        sessionTitle: "AISessions 虚拟行稳定",
        sessionKey: "fnv1a64:ffeeddccbbaa9988",
        model: "claude-sonnet-4",
        state: "done",
        durationMs: 5_200,
        blockId: null,
        resultCount: 7,
        anchorTotal: 7,
        anchorKept: 6,
    },
    {
        id: "a14",
        createdAt: NOW - 3 * H,
        feature: "title",
        sessionTitle: "批注时间线 v2 原型",
        sessionKey: "fnv1a64:0f1e2d3c4b5a6978",
        model: "gpt-5.1-codex",
        state: "failed",
        durationMs: 30_000,
        blockId: "blk-2c91",
        resultCount: 0,
        anchorTotal: 0,
        anchorKept: 0,
        error: "429 rate_limited · provider=openai",
    },
    {
        id: "a13",
        createdAt: NOW - 5 * H,
        feature: "metadata",
        sessionTitle: "VCS 目录树标记",
        sessionKey: "fnv1a64:8877665544332211",
        model: "claude-sonnet-4",
        state: "cancelled",
        durationMs: 1_200,
        blockId: null,
        resultCount: 0,
        anchorTotal: 0,
        anchorKept: 0,
    },
    {
        id: "a12",
        createdAt: NOW - 26 * H,
        feature: "title",
        sessionTitle: "Overview 看板跨列动画",
        sessionKey: "fnv1a64:4455667788990011",
        model: "gpt-5.1-codex",
        state: "queued",
        durationMs: 0,
        blockId: "blk-5d20",
        resultCount: 0,
        anchorTotal: 0,
        anchorKept: 0,
    },
    {
        id: "a11",
        createdAt: NOW - 28 * H,
        feature: "annotation-timeline",
        sessionTitle: "Agent 卡片 chip 收口",
        sessionKey: "fnv1a64:2233445566778899",
        model: "claude-sonnet-4",
        state: "done",
        durationMs: 12_600,
        blockId: "blk-5d20",
        resultCount: 12,
        anchorTotal: 0,
        anchorKept: 0,
    },
    {
        id: "a10",
        createdAt: NOW - 30 * H,
        feature: "annotation-field",
        sessionTitle: "同步冲突弹窗",
        sessionKey: "fnv1a64:6677889900112233",
        model: "claude-sonnet-4",
        state: "done",
        durationMs: 4_100,
        blockId: null,
        resultCount: 2,
        anchorTotal: 9,
        anchorKept: 9,
    },
];

// ───────────────────────── mock：运行日志（pslog v2 事件行） ─────────────────────────
function ev(o) {
    return Object.assign({ v: 2, ts: NOW, level: "info", comp: "srv", domain: "misc", outcome: "ok" }, o);
}

const EVENTS = [
    ev({ ts: NOW - 3 * M, level: "info", comp: "web", domain: "commontext.send", event: "send-start", blockid: "blk-7f3a", reason: "background" }),
    ev({ ts: NOW - 3 * M + 400, level: "info", comp: "srv", domain: "commontext.send", event: "send-queued", blockid: "blk-7f3a", durationms: 380 }),
    ev({ ts: NOW - 2 * M, level: "info", comp: "web", domain: "commontext.send", event: "send-inject", blockid: "blk-7f3a", durationms: 59_600, outcome: "ok", reason: "tui-ready" }),
    ev({ ts: NOW - 21 * M, level: "error", comp: "srv", domain: "commontext.send", event: "send-fail", blockid: "blk-7f3a", durationms: 60_000, outcome: "timeout", reason: "tui-not-ready" }),
    ev({ ts: NOW - 20 * M, level: "error", comp: "srv", domain: "agent.status", event: "recv-report", blockid: "blk-7f3a", outcome: "fail", reason: "hook-parse" }),
    ev({ ts: NOW - 48 * M, level: "warn", comp: "srv", domain: "sync.folder", event: "conflict", blockid: "blk-2c91", outcome: "skip", reason: "mtime-equal" }),
    ev({ ts: NOW - 47 * M, level: "info", comp: "srv", domain: "sync.folder", event: "conflict-resolved", blockid: "blk-2c91", durationms: 1_100 }),
    ev({ ts: NOW - 2 * H, level: "debug", comp: "srv", domain: "ps", event: "ps-route", blockid: null, traceid: "4821-77", durationms: 3 }),
    ev({ ts: NOW - 2 * H - 30 * M, level: "info", comp: "web", domain: "term.failure", event: "spawn-fail", blockid: "blk-2c91", outcome: "fail", reason: "elevated-pty-denied" }),
    ev({ ts: NOW - 3 * H, level: "error", comp: "srv", domain: "update.check", event: "check-fail", outcome: "fail", reason: "dns-lookup" }),
    ev({ ts: NOW - 4 * H, level: "warn", comp: "emain", domain: "emain.window", event: "restore-skip", outcome: "skip", reason: "missing-display" }),
    ev({ ts: NOW - 5 * H, level: "info", comp: "srv", domain: "commontext.send", event: "send-start", blockid: "blk-5d20", reason: "background" }),
    ev({ ts: NOW - 5 * H + 200, level: "info", comp: "srv", domain: "commontext.send", event: "send-queued", blockid: "blk-5d20" }),
    ev({ ts: NOW - 5 * H + 900, level: "warn", comp: "web", domain: "commontext.send", event: "send-fallback", blockid: "blk-5d20", outcome: "timeout", reason: "ttl-60s" }),
    ev({ ts: NOW - 6 * H, level: "info", comp: "wsh", domain: "agent.status", event: "ack", blockid: "blk-5d20", traceid: "4821-91" }),
    ev({ ts: NOW - 26 * H, level: "info", comp: "srv", domain: "ps", event: "ps-publish", traceid: "4808-12", durationms: 1 }),
    ev({ ts: NOW - 27 * H, level: "debug", comp: "web", domain: "ps", event: "ps-recv", traceid: "4808-12" }),
    ev({ ts: NOW - 28 * H, level: "error", comp: "srv", domain: "agentdata.backup", event: "backup-fail", durationms: 302_000, outcome: "fail", reason: "vacuum-into-locked" }),
    ev({ ts: NOW - 30 * H, level: "warn", comp: "srv", domain: "sync.git", event: "push-retry", durationms: 4_200, outcome: "ok", reason: "transient-net" }),
];

// 失败风暴场景：错误事件成批 + 限流聚合行 + 预算告警行
function stormEvents() {
    const out = [];
    for (let i = 0; i < 16; i++) {
        out.push(
            ev({
                ts: NOW - (2 + i) * M,
                level: "error",
                comp: "srv",
                domain: "commontext.send",
                event: "send-fail",
                blockid: "blk-7f3a",
                durationms: 60_000,
                outcome: "timeout",
                reason: "tui-not-ready",
            })
        );
    }
    return out;
}

// ───────────────────────── 状态 ─────────────────────────
const S = {
    view: "audit",
    scenario: "normal",
    theme: "dark",
    audit: { feature: "", state: "", query: "" },
    log: { level: "", comp: "", domain: "", query: "" },
    tl: { query: "" },
    drawer: null,
    banner: null,
    clearArmed: false,
    exportFor: null,
};

const FeatureLabels = {
    "": "All features",
    title: "Title",
    metadata: "Note & Tags",
    "annotation-timeline": "Timeline",
    "annotation-field": "Field",
};
const StateOptions = [
    ["", "All states"],
    ["done", "done"],
    ["failed", "failed"],
    ["running", "running"],
    ["queued", "queued"],
    ["cancelled", "cancelled"],
];

function audits() {
    const list = S.scenario === "empty" ? [] : AUDITS.slice();
    if (S.scenario === "failstorm") {
        return list.map((a) => (a.state === "running" ? { ...a, state: "failed", error: "timeout after 60s · rpc:AISessions.GenerateTimeline" } : a));
    }
    return list;
}

function events() {
    if (S.scenario === "empty" || S.scenario === "off") return [];
    if (S.scenario === "failstorm") return stormEvents().concat(EVENTS);
    return EVENTS.slice();
}

// ───────────────────────── 格式化 ─────────────────────────
const pad = (n) => String(n).padStart(2, "0");
function clock(ms) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayLabel(ms) {
    const d = new Date(ms);
    const key = dayKey(ms);
    const today = dayKey(NOW);
    const yst = dayKey(NOW - 24 * H);
    const base = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} 周${"日一二三四五六"[d.getDay()]}`;
    if (key === today) return `今天 · ${base}`;
    if (key === yst) return `昨天 · ${base}`;
    return base;
}
function dur(ms) {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m${pad(Math.round((ms % 60_000) / 1000))}s`;
}
function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function groupByDay(items, getTs) {
    const out = [];
    for (const item of items) {
        const key = dayKey(getTs(item));
        let g = out[out.length - 1];
        if (g == null || g.key !== key) {
            g = { key, label: dayLabel(getTs(item)), items: [] };
            out.push(g);
        }
        g.items.push(item);
    }
    return out;
}

// ───────────────────────── 关联：审计 ⇄ 日志 ─────────────────────────
function relatedEvents(audit) {
    return events().filter((e) => {
        if (audit.blockId != null && e.blockid === audit.blockId) return true;
        return e.sessionref != null && e.sessionref === audit.sessionKey;
    });
}
function relatedAudit(e) {
    const list = audits();
    if (e.blockid != null) {
        const byBlock = list.filter((a) => a.blockId === e.blockid);
        if (byBlock.length > 0) return byBlock[0];
    }
    if (e.sessionref != null) return list.find((a) => a.sessionKey === e.sessionref) ?? null;
    return null;
}

// ───────────────────────── 渲染：工具栏 ─────────────────────────
const el = (id) => document.getElementById(id);

function viewCounts() {
    return {
        audit: audits().length,
        log: events().length,
        timeline: audits().length + events().length,
    };
}

function renderToolbar() {
    const counts = viewCounts();
    const tabs = [
        ["audit", "AI 调用审计", counts.audit],
        ["log", "运行日志", counts.log],
        ["timeline", "联合时间线", counts.timeline],
    ];
    let html = `<span class="toolbar-title">Diagnostics</span><div class="view-tabs" role="tablist" aria-label="诊断视图">`;
    for (const [id, label, n] of tabs) {
        html += `<button class="view-tab" role="tab" data-view-tab="${id}" aria-selected="${S.view === id}">${label}<span class="tab-count">${n}</span></button>`;
    }
    html += `</div>`;

    if (S.view === "audit") {
        html += `<select class="toolbar-select" id="fFeature" aria-label="Filter by feature">`;
        for (const [v, label] of Object.entries(FeatureLabels)) {
            html += `<option value="${v}" ${S.audit.feature === v ? "selected" : ""}>${label}</option>`;
        }
        html += `</select>`;
        html += `<select class="toolbar-select" id="fState" aria-label="Filter by state">`;
        for (const [v, label] of StateOptions) {
            html += `<option value="${v}" ${S.audit.state === v ? "selected" : ""}>${label}</option>`;
        }
        html += `</select>`;
        html += searchBox("查询 session / model / error / key", S.audit.query);
        html += `<button class="icon-btn" title="Refresh" aria-label="Refresh">⟳</button>`;
        html += `<button class="danger-btn ${S.clearArmed ? "armed" : ""}" data-act="clear30">${S.clearArmed ? "Confirm clear 30d" : "Clear 30d"}</button>`;
    } else if (S.view === "log") {
        html += `<select class="toolbar-select" id="fLevel" aria-label="Filter by level">
            ${["", "error", "warn", "info", "debug"].map((v) => `<option value="${v}" ${S.log.level === v ? "selected" : ""}>${v === "" ? "All levels" : v}</option>`).join("")}
        </select>`;
        html += `<select class="toolbar-select" id="fComp" aria-label="Filter by component">
            ${["", "web", "srv", "emain", "wsh"].map((v) => `<option value="${v}" ${S.log.comp === v ? "selected" : ""}>${v === "" ? "All comps" : v}</option>`).join("")}
        </select>`;
        html += `<select class="toolbar-select" id="fDomain" aria-label="Filter by domain">
            ${["", "commontext.send", "agent.status", "sync.folder", "term.failure", "update.check", "ps"]
                .map((v) => `<option value="${v}" ${S.log.domain === v ? "selected" : ""}>${v === "" ? "All domains" : v}</option>`)
                .join("")}
        </select>`;
        html += searchBox("查询 blockid / trace / reason", S.log.query);
        html += `<button class="icon-btn" title="Tail 跟随" aria-label="Tail follow">⇣</button>`;
        html += `<button class="danger-btn accent" data-act="openLogs" title="第一版只有文件目录，没有应用内面板">打开日志目录</button>`;
    } else {
        html += searchBox("查询 session / blockid / event", S.tl.query);
        html += `<button class="icon-btn" title="Refresh" aria-label="Refresh">⟳</button>`;
    }
    el("toolbar").innerHTML = html;
}

function searchBox(placeholder, value) {
    return `<div class="toolbar-search">
        <span class="search-ic">⌕</span>
        <input id="fQuery" type="search" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-label="Search" />
    </div>`;
}

function renderBanner() {
    const node = el("banner");
    if (S.banner == null) {
        node.hidden = true;
        node.innerHTML = "";
        return;
    }
    node.hidden = false;
    node.innerHTML = `<span class="banner-ic">↔</span><span>${esc(S.banner.text)}</span>
        <button class="proto-btn" data-act="clearBanner">${esc(S.banner.clearLabel || "清除筛选")}</button>`;
}

// ───────────────────────── 渲染：统计条 ─────────────────────────
function renderStats() {
    if (S.view === "audit") {
        const list = audits();
        const last24 = list.filter((a) => a.createdAt >= NOW - 24 * H);
        const failed = last24.filter((a) => a.state === "failed").length;
        const done = last24.filter((a) => a.durationMs > 0);
        const avg = done.length === 0 ? 0 : Math.round(done.reduce((s, a) => s + a.durationMs, 0) / done.length);
        const buckets = Array.from({ length: 24 }, (_, i) => {
            const from = NOW - (24 - i) * H;
            const bucket = list.filter((a) => a.createdAt >= from && a.createdAt < from + H);
            return { count: bucket.length, failed: bucket.filter((a) => a.state === "failed").length };
        });
        const max = Math.max(1, ...buckets.map((b) => b.count));
        const featureChips = Object.entries(
            last24.reduce((acc, a) => {
                acc[a.feature] = (acc[a.feature] ?? 0) + 1;
                return acc;
            }, {})
        ).slice(0, 4);
        el("stats").innerHTML = `
            <span class="metric"><b>${last24.length}</b><span class="metric-label">24h calls</span></span>
            <span class="metric error-metric" data-act="pickFailed" title="${failed > 0 ? "只看失败条目" : "近 24h 无失败"}"><b>${failed}</b><span class="metric-label">failed</span></span>
            <span class="metric"><b>${dur(avg)}</b><span class="metric-label">avg</span></span>
            <div class="hourly-bars" role="img" aria-label="近 24 小时每小时调用量">${buckets
                .map((b) => `<i class="${b.failed > 0 ? "failed" : ""}" style="height:${Math.max(2, Math.round((b.count / max) * 18))}px" title="${b.count} calls${b.failed > 0 ? ` · ${b.failed} failed` : ""}"></i>`)
                .join("")}</div>
            ${featureChips.map(([f, n]) => `<span class="stat-chip">${esc(FeatureLabels[f] ?? f)} ${n}</span>`).join("")}
        `;
        return;
    }
    if (S.view === "log") {
        const list = events();
        const by = (lvl) => list.filter((e) => e.level === lvl).length;
        const domains = Object.entries(
            list.reduce((acc, e) => {
                acc[e.domain] = (acc[e.domain] ?? 0) + 1;
                return acc;
            }, {})
        )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);
        const synthetic = S.scenario === "failstorm" ? `<span class="stat-chip">限流丢弃 82 · 预算 41%</span>` : "";
        el("stats").innerHTML = `
            <span class="metric"><b>${list.length}</b><span class="metric-label">events</span></span>
            <span><span class="lvl-chip lvl-error">error ${by("error")}</span><span class="lvl-chip lvl-warn">warn ${by("warn")}</span><span class="lvl-chip lvl-info">info ${by("info")}</span></span>
            ${domains.map(([d, n]) => `<span class="stat-chip">${esc(d)} ${n}</span>`).join("")}
            ${synthetic}
            <span class="metric"><b>${S.scenario === "off" ? "off" : "warn"}</b><span class="metric-label">log:level</span></span>
        `;
        return;
    }
    const a = audits();
    const e = events();
    const linked = a.filter((x) => relatedEvents(x).length > 0).length;
    el("stats").innerHTML = `
        <span class="metric"><b>${a.length}</b><span class="metric-label">audit</span></span>
        <span class="metric"><b>${e.length}</b><span class="metric-label">log</span></span>
        <span class="metric"><b>${linked}</b><span class="metric-label">可互链条目</span></span>
        <span class="stat-chip">同一时间轴 · 浅色=日志 · 蓝色=审计</span>
    `;
}

// ───────────────────────── 渲染：列表 ─────────────────────────
function filteredAudits() {
    const q = S.audit.query.trim().toLowerCase();
    return audits()
        .filter((a) => (S.audit.feature === "" ? true : a.feature === S.audit.feature))
        .filter((a) => (S.audit.state === "" ? true : a.state === S.audit.state))
        .filter((a) => q === "" || [a.sessionTitle, a.model, a.error, a.sessionKey].filter(Boolean).join(" ").toLowerCase().includes(q))
        .sort((x, y) => y.createdAt - x.createdAt);
}

function filteredEvents() {
    const q = S.log.query.trim().toLowerCase();
    let list = events()
        .filter((e) => (S.log.level === "" ? true : e.level === S.log.level))
        .filter((e) => (S.log.comp === "" ? true : e.comp === S.log.comp))
        .filter((e) => (S.log.domain === "" ? true : e.domain === S.log.domain));
    if (q !== "") {
        const m = q.match(/^block:(.+)$/);
        list = list.filter((e) =>
            m ? String(e.blockid ?? "").toLowerCase() === m[1] : [e.blockid, e.traceid, e.reason, e.event, e.domain].filter(Boolean).join(" ").toLowerCase().includes(q)
        );
    }
    return list.sort((x, y) => y.ts - x.ts);
}

function statePill(state) {
    return `<span class="state-pill pill-${state}"><span class="dot"></span>${state}</span>`;
}

function renderList() {
    const node = el("list");
    if (S.view === "audit") return renderAuditList(node);
    if (S.view === "log") return renderLogList(node);
    return renderTimeline(node);
}

function renderAuditList(node) {
    const list = filteredAudits();
    if (list.length === 0) {
        node.innerHTML = `<div class="empty-state"><div class="big">没有审计条目</div><div>当前筛选无结果；AI 生成任务记录会出现在这里。</div></div>`;
        return;
    }
    let html = "";
    for (const g of groupByDay(list, (a) => a.createdAt)) {
        html += `<div class="day-head">${esc(g.label)}</div>`;
        for (const a of g.items) {
            const links = relatedEvents(a).length;
            html += `<div class="row row-audit" data-row-kind="audit" data-row-id="${a.id}" tabindex="0" role="button" aria-label="审计条目 ${a.id}">
                <div class="cell mono c-dim">${clock(a.createdAt)}</div>
                <div class="cell">${esc(FeatureLabels[a.feature] ?? a.feature)}</div>
                <div class="cell">${esc(a.sessionTitle)}
                    ${links > 0 ? `<span class="link-hint">· ${links} 条关联日志</span>` : ""}
                </div>
                <div class="cell mono c-dim">${esc(a.model)}</div>
                <div class="cell c-dim">${dur(a.durationMs)}</div>
                <div class="cell">${statePill(a.state)}</div>
                <div class="cell c-dim">›</div>
            </div>`;
        }
    }
    node.innerHTML = html + `<button class="load-more" data-act="loadMore">Load more · 共 ${list.length} 条</button>`;
}

function renderLogList(node) {
    if (S.scenario === "off") {
        node.innerHTML = `<div class="empty-state"><div class="big">运行日志已关闭</div>
            <div class="off-note">设置 <b class="mono">log:level = off</b> 是隐私总退出：包括 error / warn 在内全部不写。
            本次会话只留下一条 <b class="mono">log-disabled</b> 标记行，供你确认开关生效。<br />
            AI 调用审计不受影响——它是业务数据（DB），不是运行日志。</div></div>`;
        return;
    }
    const list = filteredEvents();
    if (list.length === 0) {
        node.innerHTML = `<div class="empty-state"><div class="big">没有匹配的事件</div><div>试着放宽级别 / 组件 / 域筛选，或用 blockid 精确查询。</div></div>`;
        return;
    }
    let html = "";
    if (S.scenario === "failstorm") {
        html += `<div class="sysrow"><span>⚠</span><span>前端限流生效：1 秒内 102 条，已丢 <b class="mono">82</b> 条，聚合为一条 <b class="mono">log-dropped count=82</b></span></div>`;
        html += `<div class="sysrow"><span>▣</span><span>日志目录预算 41% / 200MB · 保留 7 天 · 文件 18 / 200</span></div>`;
    }
    for (const g of groupByDay(list, (e) => e.ts)) {
        html += `<div class="day-head">${esc(g.label)}</div>`;
        for (const e of g.items) {
            const audit = relatedAudit(e);
            html += `<div class="row row-log" data-row-kind="log" data-row-id="${esc(e.ts)}-${esc(e.event)}-${esc(e.comp)}" tabindex="0" role="button"
                aria-label="日志事件 ${esc(e.event)}">
                <div class="cell mono c-dim">${clock(e.ts)}</div>
                <div class="cell lvl-text-${e.level}">${e.level}</div>
                <div class="cell"><span class="comp-tag">${e.comp}</span></div>
                <div class="cell mono">${esc(e.domain)}/${esc(e.event)}
                    ${audit ? `<span class="link-hint">· 来自审计 ${audit.id}</span>` : ""}
                </div>
                <div class="cell c-dim">${esc(e.outcome ?? "—")}</div>
                <div class="cell c-dim mono">${dur(e.durationms)}</div>
                <div class="cell c-dim">›</div>
            </div>`;
        }
    }
    node.innerHTML = html;
}

function timelineRows() {
    const q = S.tl.query.trim().toLowerCase();
    const rows = [];
    for (const a of audits()) {
        rows.push({
            kind: "audit",
            ts: a.createdAt,
            id: a.id,
            main: `${esc(a.sessionTitle)} · ${esc(FeatureLabels[a.feature] ?? a.feature)}`,
            meta: `${esc(a.model)} · ${dur(a.durationMs)} · ${a.state}`,
            ref: a,
        });
    }
    for (const e of events()) {
        rows.push({
            kind: "log",
            ts: e.ts,
            id: `${e.ts}-${e.event}`,
            main: `${esc(e.domain)}/${esc(e.event)}${e.reason ? ` · <span class="c-dim">${esc(e.reason)}</span>` : ""}`,
            meta: `${e.level} · ${e.comp}${e.blockid ? ` · ${esc(e.blockid)}` : ""}`,
            ref: e,
        });
    }
    const filtered = q === "" ? rows : rows.filter((r) => `${r.main} ${r.meta} ${r.id}`.toLowerCase().includes(q));
    return filtered.sort((x, y) => y.ts - x.ts);
}

function renderTimeline(node) {
    const rows = timelineRows();
    if (rows.length === 0) {
        node.innerHTML = `<div class="empty-state"><div class="big">时间线为空</div><div>审计条目与运行日志会按时间合并在这一条轴上。</div></div>`;
        return;
    }
    let html = "";
    for (const g of groupByDay(rows, (r) => r.ts)) {
        html += `<div class="day-head">${esc(g.label)}</div>`;
        for (const r of g.items) {
            html += `<div class="row row-tl" data-row-kind="${r.kind}" data-row-id="${esc(r.id)}" tabindex="0" role="button">
                <div class="cell mono c-dim">${clock(r.ts)}</div>
                <div class="cell"><span class="tl-badge ${r.kind}">${r.kind === "audit" ? "AI 审计" : "日志"}</span></div>
                <div class="cell">${r.main}</div>
                <div class="cell c-dim truncate">${r.meta}</div>
                <div class="cell c-dim">›</div>
            </div>`;
        }
    }
    node.innerHTML = html;
}

// ───────────────────────── 渲染：共享详情抽屉 ─────────────────────────
function openDrawer(kind, id) {
    S.drawer = { kind, id };
    renderDrawer();
}

function closeDrawer() {
    S.drawer = null;
    el("drawer").hidden = true;
    el("drawer").innerHTML = "";
}

function findAuditById(id) {
    return audits().find((a) => a.id === id) ?? null;
}

function findEventById(kind, id) {
    if (kind === "audit") return null;
    const list = events();
    return list.find((e) => `${e.ts}-${e.event}-${e.comp}` === id) ?? list.find((e) => `${e.ts}-${e.event}` === id) ?? null;
}

function renderDrawer() {
    const node = el("drawer");
    if (S.drawer == null) return closeDrawer();
    node.hidden = false;
    if (S.drawer.kind === "audit") renderAuditDrawer(node, findAuditById(S.drawer.id));
    else renderEventDrawer(node, findEventById("log", S.drawer.id));
}

function renderAuditDrawer(node, a) {
    if (a == null) return closeDrawer();
    const links = relatedEvents(a);
    node.innerHTML = `
        <div class="drawer-head">
            <div>
                <div class="drawer-kicker">AI 调用审计 · ${esc(a.id)}</div>
                <div style="font-weight:600">${esc(a.sessionTitle)}</div>
            </div>
            <button class="icon-btn drawer-close" data-act="closeDrawer" aria-label="关闭">✕</button>
        </div>
        <div class="drawer-body">
            <div>
                <div class="section-title">概要</div>
                <dl class="kv">
                    <dt>时间</dt><dd class="mono">${clock(a.createdAt)}</dd>
                    <dt>功能</dt><dd>${esc(FeatureLabels[a.feature] ?? a.feature)}</dd>
                    <dt>状态</dt><dd>${statePill(a.state)}</dd>
                    <dt>模型</dt><dd class="mono">${esc(a.model)}</dd>
                    <dt>耗时</dt><dd>${dur(a.durationMs)}</dd>
                    <dt>结果</dt><dd>${a.anchorTotal > 0 ? `${a.resultCount} 条 · 锚点 ${a.anchorKept}/${a.anchorTotal}` : `${a.resultCount} 条`}</dd>
                    <dt>session</dt><dd class="mono">${esc(a.sessionKey)}</dd>
                    ${a.blockId ? `<dt>blockid</dt><dd class="mono">${esc(a.blockId)}</dd>` : ""}
                </dl>
            </div>
            ${a.error ? `<div class="err-box"><b>失败原因</b><br />${esc(a.error)}</div>` : ""}
            <div>
                <div class="section-title">关联运行日志 <span class="count">${links.length}</span></div>
                ${
                    links.length === 0
                        ? `<div class="c-dim" style="font-size:11px;padding:6px 2px">该条目没有可关联的日志事件（可能发生在日志关闭期间）。</div>`
                        : links
                              .map(
                                  (e) => `<div class="mini-row" data-act="openEvent" data-event-id="${esc(e.ts)}-${esc(e.event)}-${esc(e.comp)}">
                            <span class="mr-time mono">${clock(e.ts)}</span>
                            <span class="lvl-text-${e.level}">${e.level}</span>
                            <span class="mr-main mono">${esc(e.domain)}/${esc(e.event)}${e.reason ? ` · ${esc(e.reason)}` : ""}</span>
                        </div>`
                              )
                              .join("")
                }
            </div>
        </div>
        <div class="drawer-actions">
            <button class="proto-btn" data-act="viewLogsFor" data-audit-id="${a.id}" ${links.length === 0 ? "disabled" : ""}>查看相关日志</button>
            <button class="proto-btn" data-act="export" data-audit-id="${a.id}" ${a.state === "failed" ? "" : "disabled"}>导出诊断包</button>
            <button class="proto-btn" data-act="retry" data-audit-id="${a.id}" ${a.state === "failed" ? "" : "disabled"}>重试</button>
        </div>
    `;
}

function renderEventDrawer(node, e) {
    if (e == null) return closeDrawer();
    const audit = relatedAudit(e);
    const record = {
        v: e.v,
        ts: new Date(e.ts).toISOString(),
        level: e.level,
        comp: e.comp,
        domain: e.domain,
        event: e.event,
        blockid: e.blockid ?? undefined,
        traceid: e.traceid ?? undefined,
        durationms: e.durationms ?? undefined,
        outcome: e.outcome ?? undefined,
        reason: e.reason ?? undefined,
    };
    node.innerHTML = `
        <div class="drawer-head">
            <div>
                <div class="drawer-kicker">运行日志 · ${esc(e.comp)} / ${esc(e.level)}</div>
                <div style="font-weight:600" class="mono">${esc(e.domain)}/${esc(e.event)}</div>
            </div>
            <button class="icon-btn drawer-close" data-act="closeDrawer" aria-label="关闭">✕</button>
        </div>
        <div class="drawer-body">
            <div>
                <div class="section-title">原始事件行（JSONL）</div>
                <div class="json-block mono">${esc(JSON.stringify(record, null, 2))}</div>
            </div>
            <div>
                <div class="section-title">关联 AI 调用审计</div>
                ${
                    audit == null
                        ? `<div class="c-dim" style="font-size:11px;padding:6px 2px">无关联审计条目（该事件不涉及 AI 调用）。</div>`
                        : `<div class="mini-row" data-act="openAudit" data-audit-id="${audit.id}">
                            <span class="mr-time mono">${clock(audit.createdAt)}</span>
                            ${statePill(audit.state)}
                            <span class="mr-main">${esc(audit.sessionTitle)}</span>
                        </div>`
                }
            </div>
        </div>
        <div class="drawer-actions">
            <button class="proto-btn" data-act="filterBlock" data-block="${esc(e.blockid ?? "")}" ${e.blockid ? "" : "disabled"}>按 blockid 过滤</button>
            <button class="proto-btn" data-act="copyEvent">复制事件行</button>
            ${audit ? `<button class="proto-btn" data-act="openAudit" data-audit-id="${audit.id}">回到审计条目</button>` : ""}
        </div>
    `;
}

// ───────────────────────── 渲染：总入口 ─────────────────────────
function render() {
    document.documentElement.dataset.theme = S.theme;
    renderToolbar();
    renderBanner();
    renderStats();
    renderList();
    if (S.drawer != null) renderDrawer();
}

// ───────────────────────── 交互：融合动作 ─────────────────────────
function goView(view, banner) {
    S.view = view;
    if (banner !== undefined) S.banner = banner;
    render();
}

function viewLogsFor(auditId) {
    const a = findAuditById(auditId);
    if (a == null || a.blockId == null) return;
    // 融合动作一：审计 → 日志（带 blockid 预设 + 来路横幅）
    S.log = { level: "", comp: "", domain: "", query: `block:${a.blockId}` };
    goView("log", { text: `已按 blockid=${a.blockId} 筛选 · 来自审计 ${a.id}「${a.sessionTitle}」` });
    closeDrawer();
}

function backToAudit(auditId) {
    // 融合动作二：日志 → 审计（切回审计视图并直接打开该条目详情）
    S.audit = { feature: "", state: "", query: "" };
    goView("audit", { text: `来自运行日志 · 已定位审计条目 ${auditId}`, clearLabel: "清除定位" });
    openDrawer("audit", auditId);
}

function exportBundle(auditId) {
    const a = findAuditById(auditId);
    if (a == null) return;
    const links = relatedEvents(a);
    const lines = [];
    lines.push("# 诊断包 · AI 调用失败");
    lines.push("");
    lines.push("## 审计条目");
    lines.push("```json");
    lines.push(JSON.stringify({ id: a.id, createdAt: new Date(a.createdAt).toISOString(), feature: a.feature, state: a.state, model: a.model, durationMs: a.durationMs, error: a.error ?? null, sessionKey: a.sessionKey, blockId: a.blockId }, null, 2));
    lines.push("```");
    lines.push("");
    lines.push(`## 关联运行日志（${links.length} 条）`);
    lines.push("```jsonl");
    for (const e of links) lines.push(JSON.stringify({ ts: new Date(e.ts).toISOString(), level: e.level, comp: e.comp, domain: e.domain, event: e.event, blockid: e.blockid, durationms: e.durationms, outcome: e.outcome, reason: e.reason }));
    lines.push("```");
    lines.push("");
    lines.push("> 由 Diagnostics Hub「导出诊断包」生成 · 仅含不透明引用，无正文与凭据");
    S.exportFor = auditId;
    el("exportBody").textContent = lines.join("\n");
    el("exportModal").hidden = false;
}

// ───────────────────────── 事件绑定（委托） ─────────────────────────
document.addEventListener("click", (event) => {
    const target = event.target;
    const actEl = target.closest("[data-act]");
    const tabEl = target.closest("[data-view-tab]");
    const rowEl = target.closest("[data-row-kind]");

    if (tabEl != null) return goView(tabEl.dataset.viewTab, null);

    if (actEl != null) {
        const act = actEl.dataset.act;
        if (act === "clearBanner") {
            S.banner = null;
            if (S.view === "log" && S.log.query.startsWith("block:")) S.log.query = "";
            return render();
        }
        if (act === "pickFailed") {
            S.audit.state = S.audit.state === "failed" ? "" : "failed";
            return render();
        }
        if (act === "clear30") {
            S.clearArmed = !S.clearArmed;
            return renderToolbar();
        }
        if (act === "openLogs") {
            S.banner = { text: "打开 <dataDir>/logs/（waveapp.log + pslog-*.log 同目录）", clearLabel: "知道了" };
            return renderBanner();
        }
        if (act === "loadMore") {
            S.banner = { text: "原型：真实实现为游标分页（AuditPageSize=100）", clearLabel: "知道了" };
            return renderBanner();
        }
        if (act === "closeDrawer") return closeDrawer();
        if (act === "viewLogsFor") return viewLogsFor(actEl.dataset.auditId);
        if (act === "export") return exportBundle(actEl.dataset.auditId);
        if (act === "retry") {
            S.banner = { text: "原型：真实实现走 AISessions 重试 RPC", clearLabel: "知道了" };
            return renderBanner();
        }
        if (act === "openEvent") return openDrawer("log", actEl.dataset.eventId);
        if (act === "openAudit") {
            closeDrawer();
            return backToAudit(actEl.dataset.auditId);
        }
        if (act === "filterBlock") {
            S.log.query = `block:${actEl.dataset.block}`;
            S.banner = { text: `已按 blockid=${actEl.dataset.block} 筛选`, clearLabel: "清除筛选" };
            closeDrawer();
            return goView("log");
        }
        if (act === "copyEvent") {
            S.banner = { text: "已复制事件行（原型）", clearLabel: "知道了" };
            return renderBanner();
        }
        return;
    }

    if (rowEl != null) {
        const kind = rowEl.dataset.rowKind;
        const id = rowEl.dataset.rowId;
        if (kind === "audit") return openDrawer("audit", id);
        return openDrawer("log", id);
    }
});

document.addEventListener("change", (event) => {
    const t = event.target;
    if (t.id === "scenario") {
        S.scenario = t.value;
        S.clearArmed = false;
        S.drawer = null;
        S.banner = null;
        el("exportModal").hidden = true;
        return render();
    }
    if (t.id === "fFeature") {
        S.audit.feature = t.value;
        return renderStats() || renderList();
    }
    if (t.id === "fState") {
        S.audit.state = t.value;
        return renderStats() || renderList();
    }
    if (t.id === "fLevel") {
        S.log.level = t.value;
        return renderList();
    }
    if (t.id === "fComp") {
        S.log.comp = t.value;
        return renderList();
    }
    if (t.id === "fDomain") {
        S.log.domain = t.value;
        return renderList();
    }
});

document.addEventListener("input", (event) => {
    const t = event.target;
    if (t.id !== "fQuery") return;
    if (S.view === "audit") S.audit.query = t.value;
    else if (S.view === "log") S.log.query = t.value;
    else S.tl.query = t.value;
    renderList();
    renderStats();
});

el("themeToggle").addEventListener("click", () => {
    S.theme = S.theme === "dark" ? "light" : "dark";
    render();
});

el("exportClose").addEventListener("click", () => {
    el("exportModal").hidden = true;
    S.exportFor = null;
});

el("scenario").addEventListener("change", () => {});

// 键盘：Esc 关抽屉/弹窗；行上 Enter/Space 打开
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        if (!el("exportModal").hidden) {
            el("exportModal").hidden = true;
            return;
        }
        if (S.drawer != null) return closeDrawer();
    }
    if (event.key === "Enter" || event.key === " ") {
        const row = event.target.closest ? event.target.closest("[data-row-kind]") : null;
        if (row != null) {
            event.preventDefault();
            openDrawer(row.dataset.rowKind === "audit" ? "audit" : "log", row.dataset.rowId);
        }
    }
});

// 初始渲染
S.scenario = document.getElementById("scenario").value;
render();

// 供 smoke test 使用
window.__diag = { S, audits, events, relatedEvents, relatedAudit, goView, openDrawer };
