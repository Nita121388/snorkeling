/* Tab Agent Status prototype — pure DOM, no build step.
 * Data fields mirror AgentStatus / Tab / Block where practical.
 */

const AGENT_SEEDS = [
    { id: "a1", blockId: "block-1042", emoji: "🦊", name: "架构拆分", provider: "pi", state: "working", phase: "thinking", runtime: "02:14", seen: false },
    { id: "a2", blockId: "block-1043", emoji: "🐼", name: "状态聚合", provider: "codex", state: "working", phase: "tool", runtime: "00:42", seen: false },
    { id: "a3", blockId: "block-1044", emoji: "🦦", name: "Tab 原型", provider: "claude", state: "blocked", phase: "approval", runtime: "05:08", seen: false },
    { id: "a4", blockId: "block-1045", emoji: "🐦‍⬛", name: "回归测试", provider: "pi", state: "done", phase: "none", runtime: "3m", seen: false },
    { id: "a5", blockId: "block-1046", emoji: "🐺", name: "远端安装", provider: "codex", state: "stale", phase: "none", runtime: "12m", seen: false },
    { id: "a6", blockId: "block-1047", emoji: "🐝", name: "文档同步", provider: "claude", state: "idle", phase: "none", runtime: "", seen: true },
    { id: "a7", blockId: "block-1048", emoji: "🐱", name: "发布检查", provider: "pi", state: "error", phase: "none", runtime: "", seen: false },
    { id: "a8", blockId: "block-1049", emoji: "🦭", name: "API 限流", provider: "codex", state: "rate-limited", phase: "none", runtime: "01:19", seen: false },
];

const SCHEMES = {
    A: {
        title: "聚合计数",
        short: "计数",
        description: "Tab 只回答“有多少 Agent 处于什么状态”。身份、阶段和跑时留给悬浮清单。",
        pros: "宽度稳定。多 Agent 不会互相覆盖。",
        cons: "需要记缩写。Tab 上看不到身份。",
        cost: "低",
        note: " compact counts ",
    },
    B: {
        title: "微头像栈",
        short: "头像",
        description: "每个 Agent 一个人格或 provider 图标，角标表示状态。超出的 Agent 收进 +N。",
        pros: "能区分 Agent。不依赖状态缩写。",
        cons: "窄 Tab 很挤。同 provider 仍可能混淆。",
        cost: "中高",
        note: " identity first ",
    },
    C: {
        title: "分段状态轨",
        short: "状态轨",
        description: "Tab 底部一条细轨，一个 Agent 一段。颜色表达状态，悬浮显示身份。",
        pros: "最省空间。每个 Agent 都有视觉占位。",
        cons: "依赖颜色。点击目标太小。",
        cost: "低",
        note: " one segment per agent ",
    },
    G: {
        title: "状态轨 + 头像",
        short: "轨像混合",
        description: "状态轨保证每个 Agent 都有占位。头像栈快速认人，超出的 Agent 收进 +N。",
        pros: "一个不漏，又能辨认 Agent。窄 Tab 也有保底信号。",
        cons: "信息密度高于单一方案。颜色仍需 tooltip 兜底。",
        cost: "中",
        note: " rail for all, avatars for scan ",
        recommended: true,
    },
    D: {
        title: "双层混合",
        short: "双层",
        description: "Tab 本体显示紧凑汇总。悬浮卡显示每个 Agent 的身份、状态、阶段和跑时。",
        pros: "兼顾空间与完整信息。复用现有悬浮卡。",
        cons: "看身份需要一次悬浮。",
        cost: "低",
        note: " summary + roster ",
    },
    E: {
        title: "激活展开",
        short: "展开",
        description: "非激活 Tab 只显示汇总。激活 Tab 临时展开第二行，容纳更多 Agent 标记。",
        pros: "细节出现在当前工作位置。",
        cons: "Tab 会重排。拖拽和关闭热区要重算。",
        cost: "中",
        note: " active tab expands ",
    },
    F: {
        title: "全量 chip",
        short: "全量",
        description: "直接把每个 Agent 的状态文字和跑时平铺到 Tab，用溢出展示真实空间代价。",
        pros: "不需要悬浮。信息最直接。",
        cons: "100–130px 放不下。会挤压名称和关闭按钮。",
        cost: "很高",
        note: " deliberate overflow ",
    },
};

const MODE_META = {
    off: {
        title: "关闭状态显示",
        description: "Tab 只保留名称、原有徽标和关闭按钮。",
        pros: "最安静，完全恢复旧布局。",
        cons: "看不到任何 Agent 状态。",
        cost: "零",
    },
    attention: {
        title: "仅未阅提醒",
        description: "只显示未阅完成、阻塞和卡住，不显示 working。",
        pros: "接近当前行为，噪音最低。",
        cons: "进行中的 Agent 不可见。",
        cost: "低",
    },
};

const STATE_META = {
    working: { label: "Working", short: "W", symbol: "●" },
    done: { label: "Done", short: "D", symbol: "✓" },
    blocked: { label: "Blocked", short: "!", symbol: "!" },
    stale: { label: "Stale", short: "S", symbol: "◷" },
    error: { label: "Error", short: "E", symbol: "×" },
    "rate-limited": { label: "Rate limited", short: "R", symbol: "≈" },
    idle: { label: "Idle", short: "I", symbol: "–" },
    unknown: { label: "Unknown", short: "?", symbol: "?" },
};

const PHASE_LABEL = {
    thinking: "Thinking",
    tool: "Tool: Bash",
    "shell-command": "Shell",
    approval: "Approval",
    none: "",
    unknown: "",
};

const state = {
    scheme: "G",
    orientation: "horizontal",
    tabWidth: 130,
    widthPolicy: "fixed",
    scenario: "mixed",
    agentCount: 8,
    activeTabId: "snorkeling",
    theme: "dark",
    rosterOpen: false,
    rosterPinned: false,
    hoveredTabId: null,
    contextTabId: null,
    overrides: {},
    tabs: [
        { id: "snorkeling", name: "Snorkeling", flagColor: null },
        { id: "docs", name: "Docs", flagColor: "var(--working)" },
        { id: "files", name: "Files", flagColor: null },
    ],
};

const PREF_KEY = "snorkeling:prototype:tab-agent-status";

const els = {};
let rosterCloseTimer = null;
let toastTimer = null;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function cloneAgents(agents) {
    return agents.map((agent) => ({ ...agent }));
}

function scenarioAgents() {
    let agents = cloneAgents(AGENT_SEEDS).slice(0, state.agentCount);
    if (state.scenario === "working") {
        agents = agents.map((agent, idx) => ({ ...agent, state: "working", phase: idx % 2 === 0 ? "thinking" : "tool", runtime: `${String(idx + 1).padStart(2, "0")}:${String((idx * 13 + 17) % 60).padStart(2, "0")}`, seen: false }));
    } else if (state.scenario === "done") {
        agents = agents.map((agent, idx) => ({ ...agent, state: "done", phase: "none", runtime: `${idx + 1}m`, seen: idx % 2 === 0 }));
    } else if (state.scenario === "attention") {
        const cycle = ["blocked", "error", "stale", "done", "rate-limited"];
        agents = agents.map((agent, idx) => ({ ...agent, state: cycle[idx % cycle.length], phase: "none", runtime: idx % 2 === 0 ? `${idx + 2}m` : "", seen: idx === 3 }));
    }
    for (const agent of agents) {
        if (state.overrides[agent.id] != null) Object.assign(agent, state.overrides[agent.id]);
    }
    return agents;
}

function agentsForTab(tabId) {
    if (tabId === "snorkeling") return scenarioAgents();
    if (tabId === "docs") {
        return [
            { ...AGENT_SEEDS[0], id: "d1", blockId: "block-2001", name: "使用指南", state: "done", runtime: "8m", seen: false },
            { ...AGENT_SEEDS[5], id: "d2", blockId: "block-2002", name: "发布说明", state: "idle", runtime: "", seen: true },
        ];
    }
    return [];
}

function activeTab() {
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
}

function activeAgents() {
    return agentsForTab(state.activeTabId);
}

function stateClass(agent) {
    return `state-${agent.state}`;
}

function isAckable(agent) {
    return !["working", "idle", "unknown"].includes(agent.state);
}

function statusText(agent) {
    const base = agent.state === "working" && PHASE_LABEL[agent.phase] ? PHASE_LABEL[agent.phase] : STATE_META[agent.state].label;
    return agent.runtime !== "" ? `${base} · ${agent.runtime}` : base;
}

function summaryGroups(agents) {
    const groups = [
        { key: "working", symbol: "W", label: "Working", agents: [] },
        { key: "attention", symbol: "!", label: "Blocked / Error / Rate limited", agents: [] },
        { key: "stale", symbol: "S", label: "Stale", agents: [] },
        { key: "done", symbol: "D", label: "Done", agents: [] },
    ];
    for (const agent of agents) {
        if (agent.state === "working") groups[0].agents.push(agent);
        else if (["blocked", "error", "rate-limited"].includes(agent.state)) groups[1].agents.push(agent);
        else if (agent.state === "stale") groups[2].agents.push(agent);
        else if (agent.state === "done") groups[3].agents.push(agent);
    }
    return groups.filter((group) => group.agents.length > 0);
}

function summaryColor(group) {
    if (group.key === "working") return "var(--working)";
    if (group.key === "attention") return group.agents.some((a) => a.state === "error") ? "var(--error)" : "var(--blocked)";
    if (group.key === "stale") return "var(--stale)";
    return "var(--done)";
}

function renderSummary(agents, maxChips, hybrid = false, showOverflow = true) {
    const groups = summaryGroups(agents);
    const visible = groups.slice(0, maxChips);
    const hiddenGroups = groups.slice(maxChips);
    const visibleAgents = new Set(visible.flatMap((group) => group.agents.map((agent) => agent.id)));
    const hiddenAgents = agents.filter((agent) => !visibleAgents.has(agent.id)).length;
    const chips = visible.map((group) => {
        const seen = group.agents.every((agent) => agent.seen);
        const title = `${group.label}: ${group.agents.length}`;
        return `<span class="summary-chip${seen ? " is-seen" : ""}" style="--chip-color:${summaryColor(group)}" title="${escapeHtml(title)}" data-group="${group.key}"><span class="symbol">${group.symbol}</span>${group.agents.length}</span>`;
    }).join("");
    const overflow = showOverflow && hiddenGroups.length > 0
        ? `<span class="token-overflow" title="还有 ${hiddenGroups.length} 类状态，共 ${hiddenAgents} 个 Agent">+${hiddenGroups.length}</span>`
        : "";
    const attention = hybrid && agents.some((agent) => !agent.seen && isAckable(agent)) ? `<span class="attention-dot" title="有未阅状态"></span>` : "";
    return `<div class="tab-badges summary-badges" data-visible-agents="${visibleAgents.size}" data-hidden-agents="${hiddenAgents}">${chips}${overflow}${attention}</div>`;
}

function renderAvatars(agents, maxVisible, expanded = false) {
    const visible = agents.slice(0, maxVisible);
    const hidden = agents.length - visible.length;
    const tokens = visible.map((agent) => `<span class="agent-token ${stateClass(agent)}${agent.seen ? " is-seen" : ""}" title="${escapeHtml(`${agent.name} · ${statusText(agent)}`)}" aria-label="${escapeHtml(`${agent.name} ${statusText(agent)}`)}"><span aria-hidden="true">${agent.emoji}</span><span class="token-dot"></span></span>`).join("");
    const overflow = hidden > 0 ? `<span class="token-overflow" title="还有 ${hidden} 个 Agent">+${hidden}</span>` : "";
    return `<div class="tab-badges${expanded ? " expanded-agent-row" : ""}" data-visible-agents="${visible.length}" data-hidden-agents="${hidden}">${tokens}${overflow}</div>`;
}

function renderRail(agents) {
    const segments = agents.map((agent) => `<span class="rail-segment ${stateClass(agent)}${agent.seen ? " is-seen" : ""}" title="${escapeHtml(`${agent.name} · ${statusText(agent)}`)}" data-agent-id="${agent.id}"></span>`).join("");
    return `<div class="tab-badges rail-badges" data-visible-agents="${agents.length}" data-hidden-agents="0"><span class="rail-count">${agents.length}</span></div><span class="status-rail" aria-label="${agents.length} 个 Agent 的状态轨">${segments}</span>`;
}

function renderHybrid(agents, options = {}) {
    const vertical = state.orientation === "vertical";
    const maxVisible = vertical ? 5 : state.widthPolicy === "elastic" ? 5 : state.tabWidth <= 110 ? 1 : 2;
    const avatars = renderAvatars(agents, maxVisible);
    const segments = agents.map((agent) => `<span class="rail-segment ${stateClass(agent)}${agent.seen ? " is-seen" : ""}" title="${escapeHtml(`${agent.name} · ${statusText(agent)}`)}" data-agent-id="${agent.id}"></span>`).join("");
    const trigger = options.preview === true ? "" : `<button class="roster-trigger" type="button" aria-label="打开 Agent 清单" aria-expanded="${state.rosterOpen}" data-roster-trigger>⌄</button>`;
    return `${avatars}<span class="status-rail" aria-label="${agents.length} 个 Agent 的状态轨">${segments}</span>${trigger}`;
}

function renderFullChips(agents) {
    const chips = agents.map((agent) => `<span class="full-chip ${stateClass(agent)}" title="${escapeHtml(`${agent.name} · ${statusText(agent)}`)}"><span aria-hidden="true">${agent.emoji}</span><span>${STATE_META[agent.state].short}</span>${agent.runtime ? `<span class="chip-runtime">${escapeHtml(agent.runtime)}</span>` : ""}</span>`).join("");
    return `<div class="tab-badges full-chip-stream" data-visible-agents="${agents.length}" data-hidden-agents="0">${chips}</div>`;
}

function renderAttention(agents) {
    const flagged = agents.filter((agent) => !agent.seen && ["done", "blocked", "stale"].includes(agent.state));
    const visible = flagged.slice(0, 3);
    const hidden = flagged.length - visible.length;
    const dots = visible.map((agent) => `<span class="legacy-status ${stateClass(agent)}" title="${escapeHtml(`${agent.name} · ${statusText(agent)}`)}" aria-label="${escapeHtml(statusText(agent))}">${STATE_META[agent.state].symbol}</span>`).join("");
    const overflow = hidden > 0 ? `<span class="token-overflow">+${hidden}</span>` : "";
    return `<div class="tab-badges legacy-badges" data-visible-agents="${visible.length}" data-hidden-agents="${hidden}">${dots}${overflow}</div>`;
}

function renderStatus(agents, options = {}) {
    const scheme = options.scheme ?? state.scheme;
    const preview = options.preview === true;
    const isActive = options.active !== false;
    const horizontal = state.orientation === "horizontal";
    const maxSummary = horizontal ? (state.tabWidth <= 110 ? 1 : 2) : 3;
    const maxAvatars = horizontal ? (state.tabWidth <= 110 ? 2 : 3) : 5;

    if (scheme === "off") {
        return `<div class="tab-badges" data-visible-agents="0" data-hidden-agents="0"></div>`;
    }
    if (scheme === "attention") return renderAttention(agents);

    if (agents.length === 0) {
        return `<div class="tab-badges" data-visible-agents="0" data-hidden-agents="0"><span class="rail-count">0</span></div>`;
    }

    switch (scheme) {
        case "A":
            return renderSummary(agents, maxSummary);
        case "B":
            return renderAvatars(agents, maxAvatars);
        case "C":
            return renderRail(agents);
        case "G":
            return renderHybrid(agents, options);
        case "D": {
            const summary = renderSummary(agents, horizontal ? 1 : 3, true, !horizontal);
            if (preview) return summary;
            return summary + `<button class="roster-trigger" type="button" aria-label="打开 Agent 清单" aria-expanded="${state.rosterOpen}" data-roster-trigger>⌄</button>`;
        }
        case "E": {
            if (!isActive) return renderSummary(agents, maxSummary);
            const summary = renderSummary(agents, 1);
            const expanded = renderAvatars(agents, maxAvatars + 2, true);
            return summary + expanded + (preview ? "" : `<button class="roster-trigger" type="button" aria-label="打开 Agent 清单" aria-expanded="${state.rosterOpen}" data-roster-trigger>⌄</button>`);
        }
        case "F":
            return renderFullChips(agents);
        default:
            return renderSummary(agents, maxSummary);
    }
}

function renderTabs() {
    const vertical = state.orientation === "vertical";
    els.tabbar.className = `tabbar${vertical ? " vertical" : ""}`;
    els.tabbar.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
    if (vertical) els.tabbar.style.width = `${state.tabWidth}px`;
    else els.tabbar.style.width = "";

    els.tabbar.innerHTML = state.tabs.map((tab) => {
        const agents = agentsForTab(tab.id);
        const isActive = tab.id === state.activeTabId;
        const expanded = state.scheme === "E" && isActive && agents.length > 0;
        const widthStyle = !vertical && !expanded ? `style="width:${state.tabWidth}px"` : !vertical && expanded ? `style="width:${state.tabWidth + 76}px"` : "";
        const flag = tab.flagColor ? `<span class="legacy-flag" style="background:${tab.flagColor}" title="Tab flag"></span>` : "";
        return `<div class="tab scheme-${state.scheme}${isActive ? " active" : ""}${agents.length === 0 ? " is-empty" : ""}${expanded ? ` expanded ${state.orientation}` : ""}${!vertical && state.tabWidth <= 110 ? " is-narrow" : ""}" role="tab" tabindex="${isActive ? "0" : "-1"}" aria-selected="${isActive}" data-tab-id="${tab.id}" ${widthStyle}>
            <div class="tab-inner">
                ${flag}
                <span class="name">${escapeHtml(tab.name)}</span>
                ${renderStatus(agents, { active: isActive })}
                <button class="close" type="button" aria-label="关闭 ${escapeHtml(tab.name)}" data-close-tab><span aria-hidden="true">×</span></button>
            </div>
        </div>`;
    }).join("");
}

function agentRow(agent, mode) {
    const seenClass = agent.seen ? " is-seen" : "";
    const ack = isAckable(agent) ? `<button class="ack-button" type="button" data-ack-agent="${agent.id}" aria-label="${agent.seen ? "取消已读" : "标记已读"}：${escapeHtml(agent.name)}">${agent.seen ? "已读" : "ack"}</button>` : "";
    return `<div class="${mode === "ledger" ? "ledger-row" : "roster-row"} ${stateClass(agent)}" role="button" tabindex="0" data-agent-row="${agent.id}" aria-label="定位到 ${escapeHtml(agent.name)}">
        <span class="roster-emoji" aria-hidden="true">${agent.emoji}</span>
        <span class="roster-name"><strong>${escapeHtml(agent.name)}</strong><small>${escapeHtml(agent.provider)} · ${escapeHtml(agent.blockId)}</small></span>
        <span class="roster-state"><span class="status-pill${seenClass}">${escapeHtml(statusText(agent))}</span>${mode === "ledger" ? "" : ack}</span>
    </div>`;
}

function renderLedger() {
    const agents = activeAgents();
    els.ledgerCount.textContent = String(agents.length);
    els.ledger.innerHTML = agents.length > 0
        ? agents.map((agent) => agentRow(agent, "ledger")).join("")
        : `<p class="empty-ledger">这个 Tab 没有 Agent。</p>`;
}

function renderRoster() {
    const agents = activeAgents();
    if (!state.rosterOpen || agents.length === 0) {
        els.roster.hidden = true;
        els.roster.innerHTML = "";
        return;
    }
    els.roster.hidden = false;
    els.roster.dataset.placement = state.orientation;
    if (state.orientation === "vertical") {
        const tabbarWidth = els.tabbar.getBoundingClientRect().width;
        const appWidth = els.appShell.getBoundingClientRect().width;
        els.roster.style.left = `${Math.min(tabbarWidth + 12, Math.max(12, appWidth - 372))}px`;
        els.roster.style.width = `${Math.min(360, Math.max(220, appWidth - tabbarWidth - 24))}px`;
    } else {
        els.roster.style.left = "12px";
        els.roster.style.width = "";
    }
    els.roster.innerHTML = `<div class="roster-head"><strong>${escapeHtml(activeTab().name)}</strong><span class="count-badge">${agents.length} agents</span><button class="roster-close" type="button" aria-label="关闭 Agent 清单" data-roster-close>×</button></div>${agents.map((agent) => agentRow(agent, "roster")).join("")}`;
}

function renderLegend() {
    const items = [
        ["working", "Working"], ["done", "Done"], ["blocked", "Blocked"], ["stale", "Stale"], ["error", "Error"], ["rate-limited", "Rate limited"], ["idle", "Idle"],
    ];
    els.legend.innerHTML = items.map(([key, label]) => `<span class="legend-item"><span class="legend-dot" style="--state-color:var(--${key})"></span>${label}</span>`).join("");
}

function renderComparison() {
    els.comparisonGrid.innerHTML = Object.entries(SCHEMES).map(([key, scheme]) => {
        const agents = activeAgents();
        return `<button class="comparison-card${key === state.scheme ? " active" : ""}" type="button" data-compare-scheme="${key}" aria-pressed="${key === state.scheme}">
            <span class="mini-head"><h3>${key} · ${scheme.title}</h3><span class="mini-key">${scheme.cost}</span></span>
            <span class="mini-tabbar"><span class="mini-tab active scheme-${key}"><span class="tab-inner"><span class="name">Snorkeling</span>${renderStatus(agents, { scheme: key, preview: true, active: true })}</span></span></span>
            <span class="mini-note">${scheme.note.trim()}</span>
        </button>`;
    }).join("");
}

function renderControls() {
    document.querySelectorAll("[data-scheme]").forEach((button) => {
        const active = button.dataset.scheme === state.scheme;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-orientation]").forEach((button) => {
        const active = button.dataset.orientation === state.orientation;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    els.widthRange.min = state.orientation === "horizontal" ? "100" : "220";
    const elasticHorizontal = state.orientation === "horizontal" && state.scheme === "G" && state.widthPolicy === "elastic";
    els.widthRange.max = state.orientation === "horizontal" ? (elasticHorizontal ? "180" : "130") : "320";
    if (state.tabWidth > Number(els.widthRange.max)) state.tabWidth = Number(els.widthRange.max);
    els.widthRange.value = String(state.tabWidth);
    els.widthOutput.textContent = `${state.tabWidth}px`;
    els.widthPolicyControl.querySelectorAll("[data-width-policy]").forEach((button) => {
        const active = button.dataset.widthPolicy === state.widthPolicy;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
        button.disabled = state.scheme !== "G";
    });
    els.scenarioSelect.value = state.scenario;
    els.countRange.value = String(state.agentCount);
    els.countOutput.textContent = String(state.agentCount);
    els.themeToggle.textContent = state.theme === "dark" ? "浅色主题" : state.theme === "light" ? "黑白主题" : "深色主题";
    document.documentElement.dataset.theme = state.theme;
}

function renderSchemeReadout() {
    const scheme = SCHEMES[state.scheme] ?? MODE_META[state.scheme];
    els.stageTitle.textContent = `${state.scheme === "off" || state.scheme === "attention" ? "" : `${state.scheme} · `}${scheme.title}`;
    els.stageSubtitle.textContent = scheme.description;
    els.stageBadge.textContent = scheme.recommended ? "推荐" : state.scheme === "off" || state.scheme === "attention" ? "设置" : `方案 ${state.scheme}`;
    els.stageBadge.classList.toggle("recommended", !!scheme.recommended);
    els.schemeTitle.textContent = scheme.title;
    els.schemeDescription.textContent = scheme.description;
    els.schemePros.textContent = scheme.pros;
    els.schemeCons.textContent = scheme.cons;
    els.costBadge.textContent = `空间成本：${scheme.cost}`;
}

function updateMetrics() {
    const tab = els.tabbar.querySelector(`[data-tab-id="${state.activeTabId}"]`);
    const badges = tab?.querySelector(".tab-badges");
    const name = tab?.querySelector(".name");
    const close = tab?.querySelector(".close");
    if (tab == null || badges == null || name == null || close == null) return;

    let visible = Number(badges.dataset.visibleAgents ?? 0);
    let hidden = Number(badges.dataset.hiddenAgents ?? 0);
    if (state.scheme === "F") {
        const br = badges.getBoundingClientRect();
        const chips = [...badges.querySelectorAll(".full-chip")];
        visible = chips.filter((chip) => {
            const r = chip.getBoundingClientRect();
            return r.left >= br.left - 1 && r.right <= br.right + 1;
        }).length;
        hidden = chips.length - visible;
    }

    const nr = name.getBoundingClientRect();
    const br = badges.getBoundingClientRect();
    const cr = close.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    const nameBadgesGap = br.left - nr.right;
    const badgesCloseGap = cr.left - br.right;
    const noOverlap = nameBadgesGap >= -1 && badgesCloseGap >= -1 && cr.right <= tr.right + 1;

    els.metricTotal.textContent = String(activeAgents().length);
    els.metricVisible.textContent = String(visible);
    els.metricHidden.textContent = String(hidden);
    els.metricWidth.textContent = `${Math.round(tr.width)}px`;
    els.metricOverlap.textContent = noOverlap ? "无重叠" : "有重叠";
    els.metricOverlap.classList.toggle("has-overlap", !noOverlap);
    els.windowMode.textContent = `${state.orientation.toUpperCase()} / ${state.tabWidth}PX`;
    els.appShell.classList.toggle("vertical", state.orientation === "vertical");
}

function render() {
    renderControls();
    renderSchemeReadout();
    renderTabs();
    renderLedger();
    renderRoster();
    renderLegend();
    renderComparison();
    requestAnimationFrame(updateMetrics);
}

function setScheme(scheme) {
    if (SCHEMES[scheme] == null && MODE_META[scheme] == null) return;
    state.scheme = scheme;
    if (state.orientation === "horizontal" && scheme !== "G" && state.tabWidth > 130) state.tabWidth = 130;
    state.rosterOpen = false;
    state.rosterPinned = false;
    savePreferences();
    render();
}

function openRoster(tabId, pin = false) {
    if (agentsForTab(tabId).length === 0) return;
    clearTimeout(rosterCloseTimer);
    state.hoveredTabId = tabId;
    state.rosterOpen = true;
    state.rosterPinned = pin;
    renderRoster();
    els.tabbar.querySelectorAll("[data-roster-trigger]").forEach((button) => button.setAttribute("aria-expanded", "true"));
}

function scheduleRosterClose() {
    clearTimeout(rosterCloseTimer);
    rosterCloseTimer = setTimeout(() => {
        if (state.rosterPinned) return;
        state.rosterOpen = false;
        state.hoveredTabId = null;
        renderRoster();
        els.tabbar.querySelectorAll("[data-roster-trigger]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    }, 180);
}

function closeRoster() {
    clearTimeout(rosterCloseTimer);
    state.rosterOpen = false;
    state.rosterPinned = false;
    renderRoster();
    els.tabbar.querySelectorAll("[data-roster-trigger]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function jumpToAgent(agentId) {
    const agent = activeAgents().find((item) => item.id === agentId);
    if (agent == null) return;
    showToast(`已定位到 ${agent.name} · ${agent.blockId}`);
    document.querySelectorAll("[data-agent-row]").forEach((row) => row.classList.toggle("is-target", row.dataset.agentRow === agentId));
}

function toggleAck(agentId) {
    const agent = activeAgents().find((item) => item.id === agentId);
    if (agent == null || !isAckable(agent)) return;
    agent.seen = !agent.seen;
    state.overrides[agent.id] = { seen: agent.seen };
    render();
    showToast(`${agent.name} ${agent.seen ? "已标记为已读" : "已恢复未读"}`);
}

function handleTabClick(tabId) {
    state.activeTabId = tabId;
    state.rosterOpen = false;
    state.rosterPinned = false;
    render();
}

function handleKeydown(event) {
    if (event.key === "Escape" && !els.contextMenu.hidden) {
        event.preventDefault();
        closeContextMenu();
        return;
    }
    const row = event.target.closest("[data-agent-row]");
    if (row != null && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        jumpToAgent(row.dataset.agentRow);
        return;
    }
    const tab = event.target.closest("[role='tab']");
    if (tab == null) return;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const rect = tab.getBoundingClientRect();
        openContextMenu(tab.dataset.tabId, {
            preventDefault() {},
            stopPropagation() {},
            currentTarget: tab,
            clientX: rect.left + 24,
            clientY: rect.bottom,
        });
        return;
    }
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleTabClick(tab.dataset.tabId);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const ids = state.tabs.map((item) => item.id);
        const current = ids.indexOf(tab.dataset.tabId);
        const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const next = ids[(current + delta + ids.length) % ids.length];
        handleTabClick(next);
        els.tabbar.querySelector(`[data-tab-id="${next}"]`)?.focus();
    }
}

function savePreferences() {
    try {
        localStorage.setItem(PREF_KEY, JSON.stringify({
            scheme: state.scheme,
            widthPolicy: state.widthPolicy,
            orientation: state.orientation,
            tabWidth: state.tabWidth,
            theme: state.theme,
        }));
    } catch {
        // file:// preview may block storage; the prototype still works in memory.
    }
}

function loadPreferences() {
    if (new URLSearchParams(window.location.search).has("fresh")) return;
    try {
        const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
        if (saved == null) return;
        if (SCHEMES[saved.scheme] != null || MODE_META[saved.scheme] != null) state.scheme = saved.scheme;
        if (saved.widthPolicy === "fixed" || saved.widthPolicy === "elastic") state.widthPolicy = saved.widthPolicy;
        if (saved.orientation === "horizontal" || saved.orientation === "vertical") state.orientation = saved.orientation;
        if (saved.theme === "dark" || saved.theme === "light" || saved.theme === "monochrome") state.theme = saved.theme;
        if (Number.isFinite(saved.tabWidth)) {
            const min = state.orientation === "horizontal" ? 100 : 220;
            const max = state.orientation === "horizontal" ? (state.scheme === "G" && state.widthPolicy === "elastic" ? 180 : 130) : 320;
            state.tabWidth = Math.max(min, Math.min(max, saved.tabWidth));
        }
    } catch {
        // ignore malformed prototype preferences
    }
}

function contextSchemeItems() {
    const items = [
        { key: "off", label: "关闭状态显示" },
        { key: "attention", label: "仅未阅提醒" },
        ...Object.entries(SCHEMES).map(([key, scheme]) => ({ key, label: `${key} · ${scheme.title}${scheme.recommended ? " ★" : ""}` })),
    ];
    return items.map((item) => `<button class="menu-item radio-item" type="button" role="menuitemradio" aria-checked="${state.scheme === item.key}" data-menu-scheme="${item.key}"><span class="menu-check">${state.scheme === item.key ? "✓" : ""}</span><span>${item.label}</span></button>`).join("");
}

function renderContextMenu() {
    const tab = state.tabs.find((item) => item.id === state.contextTabId) ?? activeTab();
    const widthEnabled = state.scheme === "G" && state.orientation === "horizontal";
    const widthLabel = state.widthPolicy === "elastic" ? "放宽到 180px" : "固定 130px";
    els.contextMenu.innerHTML = `<div class="menu-title">Tab · ${escapeHtml(tab.name)}</div>
        <button class="menu-item" type="button" role="menuitem" data-menu-action="rename">重命名 Tab</button>
        <button class="menu-item" type="button" role="menuitem" data-menu-action="copy">复制 Tab ID</button>
        <div class="menu-separator"></div>
        <div class="menu-item has-submenu" role="menuitem" aria-haspopup="true" tabindex="0" data-submenu-root="scheme"><span>Agent 状态显示</span><span class="menu-sublabel">所有 Tab</span><span class="menu-chevron">›</span><div class="context-submenu" role="menu">${contextSchemeItems()}</div></div>
        <div class="menu-item has-submenu${widthEnabled ? "" : " is-disabled"}" role="menuitem" aria-haspopup="true" aria-disabled="${!widthEnabled}" tabindex="${widthEnabled ? "0" : "-1"}" data-submenu-root="width"><span>宽度策略</span><span class="menu-sublabel">${widthEnabled ? widthLabel : "仅 G 水平布局"}</span><span class="menu-chevron">›</span><div class="context-submenu" role="menu"><button class="menu-item radio-item" type="button" role="menuitemradio" aria-checked="${state.widthPolicy === "fixed"}" data-menu-width="fixed" ${widthEnabled ? "" : "disabled"}><span class="menu-check">${state.widthPolicy === "fixed" ? "✓" : ""}</span><span>固定 130px</span></button><button class="menu-item radio-item" type="button" role="menuitemradio" aria-checked="${state.widthPolicy === "elastic"}" data-menu-width="elastic" ${widthEnabled ? "" : "disabled"}><span class="menu-check">${state.widthPolicy === "elastic" ? "✓" : ""}</span><span>放宽到 180px</span></button></div></div>
        <div class="menu-separator"></div>
        <button class="menu-item" type="button" role="menuitem" data-menu-action="reset">恢复推荐设置</button>
        <button class="menu-item" type="button" role="menuitem" data-menu-action="collapse">收起到更多</button>
        <div class="menu-separator"></div>
        <button class="menu-item danger" type="button" role="menuitem" data-menu-action="close">关闭 Tab</button>`;
}

function openContextMenu(tabId, event) {
    event.preventDefault();
    event.stopPropagation();
    state.contextTabId = tabId;
    renderContextMenu();
    els.contextMenu.hidden = false;
    els.contextMenu.classList.remove("align-left");
    const rect = els.contextMenu.getBoundingClientRect();
    const anchor = event.currentTarget?.getBoundingClientRect?.();
    const x = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : (anchor?.right ?? 120);
    const y = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : (anchor?.bottom ?? 120);
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    els.contextMenu.style.left = `${left}px`;
    els.contextMenu.style.top = `${top}px`;
    if (x > window.innerWidth * 0.68) els.contextMenu.classList.add("align-left");
    els.contextMenu.querySelector(".menu-item:not(.has-submenu)")?.focus();
}

function closeContextMenu() {
    els.contextMenu.hidden = true;
    els.contextMenu.innerHTML = "";
    state.contextTabId = null;
}

function cacheElements() {
    els.schemeControl = document.getElementById("scheme-control");
    els.orientationControl = document.getElementById("orientation-control");
    els.widthRange = document.getElementById("width-range");
    els.widthOutput = document.getElementById("width-output");
    els.widthPolicyControl = document.getElementById("width-policy-control");
    els.scenarioSelect = document.getElementById("scenario-select");
    els.countRange = document.getElementById("count-range");
    els.countOutput = document.getElementById("count-output");
    els.tickButton = document.getElementById("tick-button");
    els.themeToggle = document.getElementById("theme-toggle");
    els.stageTitle = document.getElementById("stage-title");
    els.stageSubtitle = document.getElementById("stage-subtitle");
    els.stageBadge = document.getElementById("stage-badge");
    els.appWindow = document.getElementById("app-window");
    els.appShell = document.getElementById("app-shell");
    els.tabbar = document.getElementById("tabbar");
    els.roster = document.getElementById("tab-roster");
    els.legend = document.getElementById("legend");
    els.schemeTitle = document.getElementById("scheme-title");
    els.schemeDescription = document.getElementById("scheme-description");
    els.schemePros = document.getElementById("scheme-pros");
    els.schemeCons = document.getElementById("scheme-cons");
    els.costBadge = document.getElementById("cost-badge");
    els.ledger = document.getElementById("ledger");
    els.ledgerCount = document.getElementById("ledger-count");
    els.metricTotal = document.getElementById("metric-total");
    els.metricVisible = document.getElementById("metric-visible");
    els.metricHidden = document.getElementById("metric-hidden");
    els.metricWidth = document.getElementById("metric-width");
    els.metricOverlap = document.getElementById("metric-overlap");
    els.windowMode = document.getElementById("window-mode");
    els.comparisonGrid = document.getElementById("comparison-grid");
    els.toast = document.getElementById("toast");
    els.contextMenu = document.getElementById("tab-context-menu");
}

function bindEvents() {
    els.schemeControl.innerHTML = Object.entries(SCHEMES).map(([key, scheme]) => `<button type="button" data-scheme="${key}" aria-pressed="${key === state.scheme}" title="${scheme.description}"><span class="key">${key}</span>${scheme.short}${scheme.recommended ? " ★" : ""}</button>`).join("");
    els.schemeControl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-scheme]");
        if (button != null) setScheme(button.dataset.scheme);
    });
    els.orientationControl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-orientation]");
        if (button == null) return;
        state.orientation = button.dataset.orientation;
        state.tabWidth = state.orientation === "horizontal" ? (state.scheme === "G" && state.widthPolicy === "elastic" ? 160 : 130) : 250;
        closeRoster();
        savePreferences();
        render();
    });
    els.widthPolicyControl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-width-policy]");
        if (button == null || state.scheme !== "G") return;
        state.widthPolicy = button.dataset.widthPolicy;
        state.tabWidth = state.orientation === "vertical" ? 250 : state.widthPolicy === "elastic" ? 160 : Math.min(state.tabWidth, 130);
        closeRoster();
        savePreferences();
        render();
    });
    els.widthRange.addEventListener("input", () => {
        state.tabWidth = Number(els.widthRange.value);
        savePreferences();
        render();
    });
    els.scenarioSelect.addEventListener("change", () => {
        state.scenario = els.scenarioSelect.value;
        state.overrides = {};
        state.activeTabId = "snorkeling";
        closeRoster();
        render();
    });
    els.countRange.addEventListener("input", () => {
        state.agentCount = Number(els.countRange.value);
        state.activeTabId = "snorkeling";
        closeRoster();
        render();
    });
    els.tickButton.addEventListener("click", () => {
        const agent = scenarioAgents()[0];
        if (agent == null) return;
        const cycle = ["working", "done", "idle", "blocked", "working"];
        const next = cycle[(cycle.indexOf(agent.state) + 1) % cycle.length];
        state.scenario = "mixed";
        state.overrides[agent.id] = { state: next, phase: next === "working" ? "thinking" : "none", runtime: next === "working" ? "00:01" : next === "done" ? "just now" : "", seen: false };
        render();
        showToast(`${agent.name} → ${STATE_META[next].label}`);
    });
    els.themeToggle.addEventListener("click", () => {
        state.theme = state.theme === "dark" ? "light" : state.theme === "light" ? "monochrome" : "dark";
        savePreferences();
        renderControls();
    });

    els.tabbar.addEventListener("contextmenu", (event) => {
        const tab = event.target.closest("[role='tab']");
        if (tab != null) openContextMenu(tab.dataset.tabId, event);
    });
    els.tabbar.addEventListener("click", (event) => {
        if (!els.contextMenu.hidden) closeContextMenu();
        const close = event.target.closest("[data-close-tab]");
        if (close != null) {
            event.stopPropagation();
            showToast("原型保留 Tab，方便继续比较状态编码。");
            return;
        }
        const trigger = event.target.closest("[data-roster-trigger]");
        if (trigger != null) {
            event.stopPropagation();
            const tabId = trigger.closest("[role='tab']")?.dataset.tabId;
            if (tabId != null) {
                if (state.rosterOpen && state.rosterPinned) closeRoster();
                else openRoster(tabId, true);
            }
            return;
        }
        const tab = event.target.closest("[role='tab']");
        if (tab != null) handleTabClick(tab.dataset.tabId);
    });
    els.tabbar.addEventListener("mouseover", (event) => {
        const tab = event.target.closest("[role='tab']");
        if (tab != null) openRoster(tab.dataset.tabId, false);
    });
    els.tabbar.addEventListener("mouseout", (event) => {
        const tab = event.target.closest("[role='tab']");
        if (tab != null && !event.relatedTarget?.closest?.("[data-roster-trigger]")) scheduleRosterClose();
    });
    els.tabbar.addEventListener("focusin", (event) => {
        const tab = event.target.closest("[role='tab']");
        if (tab != null) openRoster(tab.dataset.tabId, false);
    });
    els.tabbar.addEventListener("focusout", (event) => {
        if (!event.relatedTarget?.closest?.("#tabbar")) scheduleRosterClose();
    });
    els.roster.addEventListener("mouseenter", () => clearTimeout(rosterCloseTimer));
    els.roster.addEventListener("mouseleave", scheduleRosterClose);
    els.roster.addEventListener("click", (event) => {
        if (event.target.closest("[data-roster-close]") != null) {
            closeRoster();
            return;
        }
        const ack = event.target.closest("[data-ack-agent]");
        if (ack != null) {
            event.stopPropagation();
            toggleAck(ack.dataset.ackAgent);
        }
    });
    els.ledger.addEventListener("click", (event) => {
        const row = event.target.closest("[data-agent-row]");
        if (row != null) jumpToAgent(row.dataset.agentRow);
    });
    els.contextMenu.addEventListener("click", (event) => {
        const scheme = event.target.closest("[data-menu-scheme]");
        if (scheme != null) {
            setScheme(scheme.dataset.menuScheme);
            closeContextMenu();
            showToast(`状态显示 → ${SCHEMES[state.scheme]?.title ?? MODE_META[state.scheme].title}`);
            return;
        }
        const width = event.target.closest("[data-menu-width]");
        if (width != null && !width.disabled) {
            state.widthPolicy = width.dataset.menuWidth;
            state.tabWidth = state.orientation === "vertical" ? 250 : state.widthPolicy === "elastic" ? 160 : Math.min(state.tabWidth, 130);
            savePreferences();
            render();
            closeContextMenu();
            showToast(`宽度策略 → ${state.widthPolicy === "elastic" ? "放宽到 180px" : "固定 130px"}`);
            return;
        }
        const submenuRoot = event.target.closest("[data-submenu-root]");
        if (submenuRoot != null) {
            if (submenuRoot.classList.contains("is-disabled")) return;
            submenuRoot.classList.toggle("open");
            return;
        }
        const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
        const sourceTabId = state.contextTabId;
        closeContextMenu();
        if (action === "rename") showToast("原型模拟：重命名 Tab");
        else if (action === "copy") {
            navigator.clipboard?.writeText(sourceTabId ?? state.activeTabId).then(() => showToast(`已复制 ${sourceTabId ?? state.activeTabId}`)).catch(() => showToast(`Tab ID：${sourceTabId ?? state.activeTabId}`));
        } else if (action === "reset") {
            state.scheme = "G";
            state.widthPolicy = "fixed";
            state.orientation = "horizontal";
            state.tabWidth = 130;
            savePreferences();
            render();
            showToast("已恢复推荐：G 状态轨 + 头像");
        } else if (action === "collapse") showToast("原型模拟：收起到更多");
        else if (action === "close") showToast("原型保留 Tab，方便继续比较");
    });
    els.contextMenu.addEventListener("contextmenu", (event) => event.preventDefault());
    els.comparisonGrid.addEventListener("click", (event) => {
        const card = event.target.closest("[data-compare-scheme]");
        if (card != null) setScheme(card.dataset.compareScheme);
    });
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("click", (event) => {
        if (!els.contextMenu.hidden && !event.target.closest("#tab-context-menu") && !event.target.closest("#tabbar")) closeContextMenu();
        if (state.rosterOpen && !state.rosterPinned && !event.target.closest("#tabbar") && !event.target.closest("#tab-roster")) scheduleRosterClose();
    });
}

loadPreferences();
cacheElements();
bindEvents();
render();
