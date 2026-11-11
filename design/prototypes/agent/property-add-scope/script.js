// Add property · 范围三选一 — 原型交互
// 纯静态、无依赖。视觉令牌与 DOM 骨架见 index.html / style.css 顶部注释。

// ── 图标（12px 线性图标，替代真实组件的 fa-sharp）──────────────────
const svg = (body) =>
    `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">${body}</svg>`;

const ICONS = {
    clock: svg(
        '<circle cx="6" cy="6" r="4.4" stroke="currentColor" stroke-width="1.2"/>' +
            '<path d="M6 3.6V6l1.7 1.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
    ),
    calendar: svg(
        '<rect x="1.6" y="2.4" width="8.8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.2"/>' +
            '<path d="M1.6 4.9h8.8M4 1.4v2M8 1.4v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
    ),
    tag: svg(
        '<path d="M1.6 6.1V2.4a.8.8 0 0 1 .8-.8h3.7l4.3 4.3a.8.8 0 0 1 0 1.1L7 10.4a.8.8 0 0 1-1.1 0L1.6 6.1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
            '<circle cx="4.1" cy="4.1" r=".8" fill="currentColor"/>'
    ),
    note: svg(
        '<path d="M2.2 2.6h7.6M2.2 6h7.6M2.2 9.4h4.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
    ),
    plus: svg('<path d="M6 2.2v7.6M2.2 6h7.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
    pencil: svg(
        '<path d="M8.4 1.9a1.2 1.2 0 0 1 1.7 1.7L4.4 9.3l-2.5.7.7-2.5 5.8-5.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
    ),
    chevron: svg(
        '<path d="M3 4.8 6 7.8l3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    doc: svg(
        '<path d="M3.2 1.6h3.4l2.2 2.2v6.6a.8.8 0 0 1-.8.8H3.2a.8.8 0 0 1-.8-.8V2.4a.8.8 0 0 1 .8-.8Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>' +
            '<path d="M6.6 1.6v2.2h2.2" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'
    ),
    robot: svg(
        '<rect x="2.2" y="4.2" width="7.6" height="5.6" rx="1.8" stroke="currentColor" stroke-width="1.1"/>' +
            '<path d="M6 4.2V2.7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' +
            '<circle cx="6" cy="1.9" r=".7" fill="currentColor"/>' +
            '<circle cx="4.4" cy="6.9" r=".7" fill="currentColor"/>' +
            '<circle cx="7.6" cy="6.9" r=".7" fill="currentColor"/>'
    ),
    globe: svg(
        '<circle cx="6" cy="6" r="4.4" stroke="currentColor" stroke-width="1.1"/>' +
            '<path d="M1.6 6h8.8M6 1.6c-2.6 1.4-2.6 7.4 0 8.8 2.6-1.4 2.6-7.4 0-8.8Z" stroke="currentColor" stroke-width="1.1"/>'
    ),
    check: svg(
        '<path d="M2.6 6.2 4.9 8.5l4.5-4.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    ),

    // ── 属性类型图标 ──
    text: svg('<text x="1" y="9" font-size="8.6" font-weight="600" fill="currentColor" font-family="Georgia, serif">Aa</text>'),
    number: svg('<text x="1.2" y="8.9" font-size="7.2" font-weight="600" fill="currentColor">123</text>'),
    select: svg('<rect x="1.4" y="3.8" width="9.2" height="4.4" rx="2.2" fill="currentColor" opacity=".85"/>'),
    multi_select: svg(
        '<rect x=".8" y="3.6" width="7.2" height="4.8" rx="2.4" fill="currentColor" opacity=".4"/>' +
            '<rect x="4.4" y="3.6" width="6.8" height="4.8" rx="2.4" fill="currentColor"/>'
    ),
    status: svg(
        '<circle cx="6" cy="6" r="4.2" stroke="currentColor" stroke-width="1.1"/>' +
            '<path d="M6 1.8a4.2 4.2 0 0 1 0 8.4Z" fill="currentColor"/>'
    ),
    date: svg(
        '<rect x="1.6" y="2.4" width="8.8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.2"/>' +
            '<path d="M1.6 4.9h8.8M4 1.4v2M8 1.4v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
    ),
    person: svg(
        '<circle cx="6" cy="4" r="2.2" fill="currentColor"/>' +
            '<path d="M1.9 10.4c.5-2.3 2.1-3.4 4.1-3.4s3.6 1.1 4.1 3.4Z" fill="currentColor"/>'
    ),
    checkbox: svg(
        '<rect x="1.8" y="1.8" width="8.4" height="8.4" rx="2" stroke="currentColor" stroke-width="1.1"/>' +
            '<path d="M4 6.1 5.6 7.7l6.2-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" transform="translate(-1.6 0)"/>'
    ),
    url: svg(
        '<path d="M4.9 7.1 7.1 4.9M4.2 8.3 3 9.5a2 2 0 0 1-2.8-2.8l1.2-1.2M7.8 3.7 9 2.5a2 2 0 0 1 2.8 2.8L10.6 6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'
    ),
};

// ── 可创建类型（与 property-list.tsx 的 CreatableTypes 一致）─────────
const TYPES = [
    { id: "text", label: "Text", icon: "text" },
    { id: "number", label: "Number", icon: "number" },
    { id: "select", label: "Select", icon: "select" },
    { id: "multi_select", label: "Multi-select", icon: "multi_select" },
    { id: "status", label: "Status", icon: "status" },
    { id: "date", label: "Date", icon: "date" },
    { id: "person", label: "Person", icon: "person" },
    { id: "checkbox", label: "Checkbox", icon: "checkbox" },
    { id: "url", label: "URL", icon: "url" },
];

// ── 状态 ─────────────────────────────────────────────────────────
const state = {
    type: "text",
    scope: "session",
    props: [], // {key, name, type, scope}
};

const card = document.getElementById("card-after");
const propsList = document.getElementById("props-after");
const btnAdd = document.getElementById("btn-add");
const popover = document.getElementById("popover");
const nameInput = document.getElementById("pp-input");
const typeBtn = document.getElementById("pp-type");
const typeMenu = document.getElementById("pp-type-menu");
const typeName = document.getElementById("pp-type-name");
const typeIcon = document.getElementById("pp-type-ic");
const errorEl = document.getElementById("pp-error");
const submitBtn = document.getElementById("pp-submit");
const cancelBtn = document.getElementById("pp-cancel");
const matrixBody = document.getElementById("matrix-body");
const matrixEmpty = document.getElementById("matrix-empty");
const resetBtn = document.getElementById("btn-reset");

// 已有属性 key（内置 4 行），用于重名判定
const EXISTING_KEYS = ["updated_at", "created_at", "tags", "note"];

// ── 工具 ─────────────────────────────────────────────────────────
function decorateIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el) => {
        const name = el.getAttribute("data-icon");
        if (ICONS[name]) el.innerHTML = ICONS[name];
    });
}

function slugify(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function humanize(key) {
    return key
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SCOPE_META = {
    session: { label: "仅此会话", chip: "m-scope--session", cells: [true, false, false] },
    agent: { label: "仅此 Agent（pi）", chip: "m-scope--agent", cells: [true, true, false] },
    all: { label: "所有会话", chip: "m-scope--all", cells: [true, true, true] },
};

// ── 类型菜单 ─────────────────────────────────────────────────────
function buildTypeMenu() {
    typeMenu.innerHTML = TYPES.map(
        (t) => `
        <button class="pp-type-item${t.id === state.type ? " is-active" : ""}" type="button" role="option"
                aria-selected="${t.id === state.type}" data-type="${t.id}">
            <span class="pp-ic">${ICONS[t.icon]}</span>
            <span class="pp-type-item__name">${t.label}</span>
            <span class="pp-check">${ICONS.check}</span>
        </button>`
    ).join("");
}

function setType(id, { rebuild = true } = {}) {
    state.type = id;
    const meta = TYPES.find((t) => t.id === id) ?? TYPES[0];
    typeIcon.innerHTML = ICONS[meta.icon];
    typeName.textContent = meta.label;
    if (rebuild) buildTypeMenu();
}

function openTypeMenu() {
    typeMenu.hidden = false;
    typeBtn.classList.add("is-open");
    typeBtn.setAttribute("aria-expanded", "true");
}

function closeTypeMenu() {
    typeMenu.hidden = true;
    typeBtn.classList.remove("is-open");
    typeBtn.setAttribute("aria-expanded", "false");
}

// ── 浮层开关 ─────────────────────────────────────────────────────
function openPopover() {
    popover.hidden = false;
    errorEl.hidden = true;
    btnAdd.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => nameInput.focus());
}

function closePopover() {
    popover.hidden = true;
    closeTypeMenu();
    errorEl.hidden = true;
    btnAdd.setAttribute("aria-expanded", "false");
}

function resetForm() {
    nameInput.value = "";
    errorEl.hidden = true;
    submitBtn.disabled = true;
    setType("text");
    selectScope("session");
    closeTypeMenu();
}

// ── 范围选择 ─────────────────────────────────────────────────────
function selectScope(scope) {
    state.scope = scope;
    popover.querySelectorAll(".pp-scope-opt").forEach((opt) => {
        const active = opt.dataset.scope === scope;
        opt.classList.toggle("is-active", active);
        opt.querySelector('input[type="radio"]').checked = active;
    });
}

// ── 提交 ─────────────────────────────────────────────────────────
function submit() {
    const name = nameInput.value.trim();
    const key = slugify(name);
    const taken = new Set([...EXISTING_KEYS, ...state.props.map((p) => p.key)]);

    if (key === "") {
        errorEl.textContent = "Name is required";
        errorEl.hidden = false;
        nameInput.focus();
        return;
    }
    if (taken.has(key)) {
        errorEl.textContent = "Property already exists";
        errorEl.hidden = false;
        nameInput.focus();
        return;
    }

    const prop = { key, name: humanize(key), type: state.type, scope: state.scope };
    state.props.push(prop);
    renderPropRow(prop);
    renderMatrix();

    closePopover();
    resetForm();
}

function renderPropRow(prop) {
    const row = document.createElement("div");
    row.className = "property-row property-row--agent";
    row.dataset.propertyKey = prop.key;
    row.dataset.custom = "1";
    const icon = TYPES.find((t) => t.id === prop.type)?.icon ?? "text";
    row.innerHTML = `
        <span class="property-row__icon">${ICONS[icon]}</span>
        <span class="property-row__name"></span>
        <span class="property-row__value"><span class="property-empty--dash">—</span></span>`;
    row.querySelector(".property-row__name").textContent = prop.name;
    propsList.appendChild(row);
}

// ── 范围矩阵 ─────────────────────────────────────────────────────
function renderMatrix() {
    if (state.props.length === 0) {
        matrixBody.innerHTML = `
            <tr class="matrix-empty" id="matrix-empty">
                <td colspan="5">还没有新建属性 —— 点右卡的 + Add property 试三种范围。</td>
            </tr>`;
        return;
    }

    matrixBody.innerHTML = state.props
        .map((prop) => {
            const meta = SCOPE_META[prop.scope];
            const cells = meta.cells
                .map((yes) => `<td class="m-cell ${yes ? "m-yes" : "m-no"}">${yes ? "✓" : "—"}</td>`)
                .join("");
            return `<tr>
                <td>${prop.name}</td>
                <td><span class="m-scope ${meta.chip}">${meta.label}</span></td>
                ${cells}
            </tr>`;
        })
        .join("");
}

// ── 重置 ─────────────────────────────────────────────────────────
function resetDemo() {
    state.props = [];
    state.type = "text";
    state.scope = "session";
    propsList.querySelectorAll('[data-custom="1"]').forEach((el) => el.remove());
    renderMatrix();
    closePopover();
    resetForm();
}

// ── 事件绑定 ─────────────────────────────────────────────────────
btnAdd.addEventListener("click", (event) => {
    event.stopPropagation();
    if (popover.hidden) {
        openPopover();
    } else {
        closePopover();
    }
});

typeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (typeMenu.hidden) {
        openTypeMenu();
    } else {
        closeTypeMenu();
    }
});

typeMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-type]");
    if (item == null) return;
    event.stopPropagation();
    setType(item.dataset.type);
    closeTypeMenu();
});

nameInput.addEventListener("input", () => {
    const empty = nameInput.value.trim() === "";
    submitBtn.disabled = empty;
    if (!errorEl.hidden && !empty) errorEl.hidden = true;
});

nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        if (!submitBtn.disabled) submit();
    }
    if (event.key === "Escape") {
        event.preventDefault();
        closePopover();
    }
});

popover.addEventListener("change", (event) => {
    const radio = event.target.closest('input[type="radio"]');
    if (radio != null) selectScope(radio.value);
});

popover.addEventListener("click", (event) => {
    // 点浮层内部不关闭
    event.stopPropagation();
});

submitBtn.addEventListener("click", submit);
cancelBtn.addEventListener("click", () => {
    closePopover();
    resetForm();
});
resetBtn.addEventListener("click", resetDemo);

document.addEventListener("click", (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || btnAdd.contains(event.target)) return;
    closePopover();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
        if (!typeMenu.hidden) {
            closeTypeMenu();
        } else {
            closePopover();
        }
    }
});

// ── 初始化 ───────────────────────────────────────────────────────
decorateIcons();
buildTypeMenu();
setType("text", { rebuild: false });
selectScope("session");
submitBtn.disabled = true;
renderMatrix();
