/* =========================================================================
   Notion-style property prototype — behaviour
   Mirrors Notion's page-properties interactions:
   property rows, type picker, select/multi-select/date editors, add property,
   property menu, AI auto-fill, and the page-icon (logo vs emoji) switch.
   ========================================================================= */

var GRIP_SVG =
    '<svg viewBox="0 0 12 12"><circle cx="4" cy="3" r="1"/><circle cx="8" cy="3" r="1"/>' +
    '<circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/>' +
    '<circle cx="4" cy="9" r="1"/><circle cx="8" cy="9" r="1"/></svg>';

var CHECK_SVG = '<svg viewBox="0 0 12 12"><path d="M2.4 6.2l2.2 2.2 4.9-4.9"/></svg>';

var BRAND_SVG =
    '<svg viewBox="0 0 24 24"><path d="M12 2.4c1.9 0 3.6 1 4.5 2.6 1.9.2 3.5 1.5 4 3.4.6 1.9 0 3.9-1.5 5.2.2 1.9-.6 3.7-2.2 4.8-1.6 1.1-3.6 1.1-5.2.1-1.6 1-3.6 1-5.2-.1-1.6-1.1-2.4-2.9-2.2-4.8C2.7 12.3 2.1 10.3 2.7 8.4c.5-1.9 2.1-3.2 4-3.4C7.6 3.4 9.3 2.4 12 2.4zm0 3.1a4.9 4.9 0 100 9.8 4.9 4.9 0 000-9.8z"/></svg>';

/* ---------- type glyphs (close to Notion's line icons) ---------- */
var ICON = {
    text: '<span class="glyph-aa">Aa</span>',
    number: '<span class="glyph-num">123</span>',
    select: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="8" cy="8" r="2.1" fill="currentColor"/></svg>',
    multi_select: '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h7M3 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    status: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 2.4a5.6 5.6 0 010 11.2z" fill="currentColor"/></svg>',
    date: '<svg viewBox="0 0 16 16"><rect x="2.2" y="3.2" width="11.6" height="10.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.2 6.4h11.6M5.2 1.8v2.6M10.8 1.8v2.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    person: '<svg viewBox="0 0 16 16"><circle cx="8" cy="5.6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.2 14c.5-2.5 2.4-4 4.8-4s4.3 1.5 4.8 4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    checkbox: '<svg viewBox="0 0 16 16"><rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 8.2l2.1 2.1 4.3-4.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    url: '<svg viewBox="0 0 16 16"><path d="M6.8 9.2l2.4-2.4M7.4 5.2l1-1a2.6 2.6 0 013.7 3.7l-1 1M8.6 10.8l-1 1a2.6 2.6 0 01-3.7-3.7l1-1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    formula: '<span class="glyph-f">ƒ</span>',
    relation: '<svg viewBox="0 0 16 16"><circle cx="4" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.2 8h3.6" stroke="currentColor" stroke-width="1.2"/></svg>',
    created_time: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.8V8l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    updated_time: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.8V8l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M13.2 2.8l.8.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
};

var TYPE_META = {
    text: { label: 'Text', group: 'Basic' },
    number: { label: 'Number', group: 'Basic' },
    select: { label: 'Select', group: 'Basic' },
    multi_select: { label: 'Multi-select', group: 'Basic' },
    status: { label: 'Status', group: 'Basic' },
    date: { label: 'Date', group: 'Basic' },
    person: { label: 'Person', group: 'Basic' },
    checkbox: { label: 'Checkbox', group: 'Basic' },
    url: { label: 'URL', group: 'Basic' },
    formula: { label: 'Formula', group: 'Advanced' },
    relation: { label: 'Relation', group: 'Advanced' },
    created_time: { label: 'Created time', group: 'System' },
    updated_time: { label: 'Last edited time', group: 'System' },
};

var TYPE_ORDER = Object.keys(TYPE_META);
var COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/* ---------- seed data: one AI session shown as a Notion page ---------- */
var members = [
    { id: 'nita', name: 'Nita', avatarColor: '#a78bfa' },
    { id: 'pi', name: 'pi', avatarColor: '#60a5fa' },
    { id: 'codex', name: 'Codex', avatarColor: '#34d399' },
];
var sessions = [
    { id: 'fix-login-redirect', name: 'fix-login-redirect', color: 'orange' },
    { id: 'refactor-auth-module', name: 'refactor-auth-module', color: 'blue' },
    { id: 'session-note-editor', name: 'session-note-editor', color: 'purple' },
];

function seedProps() {
    return [
        { key: 'status', name: 'Status', type: 'status', order: 0, value: 'in_progress', source: 'user',
          options: [
            { id: 'todo', name: 'To-do', color: 'gray', group: 'To-do' },
            { id: 'in_progress', name: 'In progress', color: 'blue', group: 'In progress' },
            { id: 'done', name: 'Complete', color: 'green', group: 'Complete' },
          ] },
        { key: 'owner', name: 'Owner', type: 'person', order: 1, value: 'nita', source: 'user',
          options: members.map(function (m) { return { id: m.id, name: m.name, avatarColor: m.avatarColor }; }) },
        { key: 'date', name: 'Date', type: 'date', order: 2, value: new Date(2026, 9, 29).getTime(), source: 'ai' },
        { key: 'tags', name: 'Tags', type: 'multi_select', order: 3, value: ['auth', 'refactor'], source: 'user',
          options: [
            { id: 'auth', name: 'auth', color: 'purple' },
            { id: 'refactor', name: 'refactor', color: 'blue' },
            { id: 'perf', name: 'perf', color: 'orange' },
            { id: 'design', name: 'design', color: 'pink' },
            { id: 'ai', name: 'ai', color: 'green' },
            { id: 'go', name: 'go', color: 'green' },
          ] },
        { key: 'complexity', name: 'Complexity', type: 'select', order: 4, value: 'medium', source: 'ai',
          options: [
            { id: 'low', name: 'Low', color: 'green' },
            { id: 'medium', name: 'Medium', color: 'yellow' },
            { id: 'high', name: 'High', color: 'red' },
          ] },
        { key: 'starred', name: 'Starred', type: 'checkbox', order: 5, value: true, source: 'user' },
        { key: 'pr', name: 'Pull Request', type: 'url', order: 6, value: 'https://github.com/nita/snorkeling/pull/128', source: 'ai' },
        { key: 'messages', name: 'Messages', type: 'formula', order: 7, value: '184', readOnly: true, source: 'system' },
        { key: 'updated', name: 'Last edited', type: 'updated_time', order: 8, value: 'Oct 29, 2026 14:32', readOnly: true, source: 'system' },
    ];
}

/* ---------- state ---------- */
var state = {
    iconMode: 'emoji',       // emoji | logo | block
    cardWidth: 'wide',       // wide | narrow
    narrowExpanded: false,
    editingNameKey: null,
    aiRunning: false,
};

var props = seedProps();

/* ---------- helpers ---------- */
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
function isReadonly(p) { return !!p.readOnly || p.type === 'formula' || p.type === 'created_time' || p.type === 'updated_time'; }
function isEmpty(p) {
    var v = p.value;
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'string') return v.trim() === '';
    return false;
}
function optionOf(p, id) {
    return (p.options || []).find(function (o) { return o.id === id; }) || { id: id, name: id, color: 'gray' };
}
function colorFor(p, id) { return optionOf(p, id).color || 'gray'; }
function fmtDate(ts) {
    if (ts == null) return '';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

/* ---------- value rendering ---------- */
function valueHtml(p) {
    var html = '';
    if (p.type === 'checkbox') {
        html = '<span class="checkbox ' + (p.value ? 'checked' : '') + '">' + CHECK_SVG + '</span>';
    } else if (p.type === 'select' || p.type === 'status') {
        if (!isEmpty(p)) {
            var o = optionOf(p, p.value);
            html = '<span class="pill c-' + o.color + '">' + escapeHtml(o.name) + '</span>';
        }
    } else if (p.type === 'multi_select') {
        html = (p.value || []).map(function (id) {
            var o = optionOf(p, id);
            return '<span class="pill c-' + o.color + '">' + escapeHtml(o.name) + '</span>';
        }).join('');
    } else if (p.type === 'person') {
        var m = optionOf(p, p.value);
        if (!isEmpty(p)) {
            html = '<span class="person"><span class="avatar" style="background:' + (m.avatarColor || '#a78bfa') + '">' +
                escapeHtml(m.name.slice(0, 1).toUpperCase()) + '</span>' + escapeHtml(m.name) + '</span>';
        }
    } else if (p.type === 'relation') {
        html = (p.value || []).map(function (id) {
            var s = optionOf(p, id);
            return '<span class="pill c-' + (s.color || 'blue') + '">' + escapeHtml(s.name) + '</span>';
        }).join('');
    } else if (p.type === 'date') {
        html = '<span class="val-date">' + escapeHtml(fmtDate(p.value)) + '</span>';
    } else if (p.type === 'url') {
        html = '<span class="val-url">' + escapeHtml(p.value || '') + '</span>';
    } else if (p.type === 'number') {
        html = '<span class="val-text val-number">' + escapeHtml(p.value) + '</span>';
    } else {
        html = '<span class="val-text">' + escapeHtml(p.value || '') + '</span>';
    }
    if (p.source === 'ai' && !isEmpty(p)) {
        html += '<span class="ai-flag" title="AI generated">✨</span>';
    }
    return html;
}

/* ---------- page icon ---------- */
function renderIcon() {
    var el = document.getElementById('pageIcon');
    if (state.iconMode === 'logo') {
        el.className = 'page-icon brand';
        el.innerHTML = BRAND_SVG;
        el.title = 'Provider brand logo';
    } else {
        el.className = 'page-icon';
        el.textContent = state.iconMode === 'block' ? '🐙' : '🦊';
        el.title = state.iconMode === 'block' ? 'Block-level emoji override' : 'Provider persona emoji';
    }
}

function setIconMode(mode) {
    state.iconMode = mode;
    ['logo', 'emoji', 'block'].forEach(function (m) {
        var b = document.getElementById('seg-' + m);
        if (b) b.classList.toggle('active', m === mode);
    });
    renderIcon();
}

function setCardWidth(w) {
    state.cardWidth = w;
    if (w === 'narrow') state.narrowExpanded = false;
    document.getElementById('seg-wide').classList.toggle('active', w === 'wide');
    document.getElementById('seg-narrow').classList.toggle('active', w === 'narrow');
    document.getElementById('page').parentElement.classList.toggle('narrow', w === 'narrow');
    render();
}

/* ---------- page rendering ---------- */
function render() {
    renderIcon();
    var host = document.getElementById('props');
    host.innerHTML = '';

    var isSystemRow = function (p) { return p.type === 'created_time' || p.type === 'updated_time'; };
    var list = props.slice().sort(function (a, b) {
        var as = isSystemRow(a) ? 1 : 0;
        var bs = isSystemRow(b) ? 1 : 0;
        if (as !== bs) return as - bs;
        return a.order - b.order;
    });
    var narrow = state.cardWidth === 'narrow';
    var collapsed = narrow && !state.narrowExpanded;
    var hiddenCount = 0;

    if (collapsed) {
        var nonEmpty = list.filter(function (p) { return !isEmpty(p); });
        hiddenCount = Math.max(0, nonEmpty.length - 5);
        list = nonEmpty.slice(0, 5);
    }

    list.forEach(function (p) { host.appendChild(renderProp(p)); });

    if (collapsed && hiddenCount > 0) {
        var more = document.createElement('div');
        more.className = 'more-props';
        more.textContent = '+ ' + hiddenCount + ' more propert' + (hiddenCount === 1 ? 'y' : 'ies');
        more.onclick = function () { state.narrowExpanded = true; render(); };
        host.appendChild(more);
    } else if (narrow && state.narrowExpanded) {
        var less = document.createElement('div');
        less.className = 'more-props';
        less.textContent = 'Show less';
        less.onclick = function () { state.narrowExpanded = false; render(); };
        host.appendChild(less);
    }
}

function renderProp(p) {
    var row = document.createElement('div');
    row.className = 'prop';
    row.dataset.key = p.key;
    if (p.aiFresh) row.classList.add('ai-fresh');

    var empty = isEmpty(p);
    var readonly = isReadonly(p);

    var nameCell = state.editingNameKey === p.key
        ? '<input class="inline-edit name-edit" value="' + escapeAttr(p.name) + '" />'
        : '<span class="prop-name-text">' + escapeHtml(p.name) + '</span>';

    row.innerHTML =
        '<div class="prop-grip" title="Property menu">' + GRIP_SVG + '</div>' +
        '<div class="prop-name">' + nameCell + '</div>' +
        '<div class="prop-value ' + (empty ? 'is-empty' : '') + (readonly ? ' is-readonly' : '') + '" data-value>' +
            valueHtml(p) +
        '</div>';

    row.querySelector('.prop-grip').addEventListener('click', function (e) {
        e.stopPropagation();
        openPropMenu(p, row.querySelector('.prop-grip'));
    });

    var nameText = row.querySelector('.prop-name-text');
    if (nameText) {
        nameText.addEventListener('dblclick', function () {
            state.editingNameKey = p.key;
            render();
        });
    }
    var nameInput = row.querySelector('.name-edit');
    if (nameInput) {
        nameInput.focus();
        nameInput.select();
        var commit = function () {
            if (!nameInput.isConnected) return;
            var v = nameInput.value.trim();
            if (v) p.name = v;
            state.editingNameKey = null;
            render();
        };
        nameInput.addEventListener('blur', commit);
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { state.editingNameKey = null; render(); }
        });
    }

    row.querySelector('.prop-value').addEventListener('click', function () {
        if (readonly) return;
        openValueEditor(p, row.querySelector('.prop-value'));
    });

    return row;
}

/* ---------- generic popover helpers ---------- */
var valuePop = document.getElementById('valuePop');
var typePop = document.getElementById('typePop');

function placePopover(el, anchor) {
    el.hidden = false;
    el.style.visibility = 'hidden';
    el.style.top = '0px';
    el.style.left = '0px';
    var r = anchor.getBoundingClientRect();
    var pr = el.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 6;
    var left = r.left + window.scrollX;
    if (r.bottom + pr.height + 14 > window.innerHeight && r.top - pr.height - 6 > 0) {
        top = r.top + window.scrollY - pr.height - 6;
    }
    var maxLeft = window.scrollX + window.innerWidth - pr.width - 12;
    if (left > maxLeft) left = Math.max(window.scrollX + 12, maxLeft);
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.visibility = 'visible';
}
function hidePopovers() {
    valuePop.hidden = true;
    typePop.hidden = true;
}
document.addEventListener('mousedown', function (e) {
    if (e.target.closest('.popover')) return;
    hidePopovers();
});
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hidePopovers();
});

/* ---------- value editor dispatcher ---------- */
function openValueEditor(p, anchor) {
    if (p.type === 'checkbox') {
        p.value = !p.value;
        p.source = 'user';
        render();
        return;
    }
    if (p.type === 'date') return openDatePicker(p, anchor);
    if (p.type === 'select' || p.type === 'status' || p.type === 'multi_select' || p.type === 'person' || p.type === 'relation') {
        return openOptionPicker(p, anchor);
    }
    return openInlineEditor(p, anchor);
}

/* ---------- inline text/number/url editor ---------- */
function openInlineEditor(p, anchor) {
    var cell = anchor;
    var input = document.createElement('input');
    input.className = 'inline-edit';
    input.value = p.value == null ? '' : String(p.value);
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    var commit = function () {
        if (!input.isConnected) return;
        p.value = p.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
        p.source = 'user';
        render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { input.dataset.cancel = '1'; render(); }
    });
}

/* ---------- option picker (select / multi-select / status / person / relation) ---------- */
function openOptionPicker(p, anchor) {
    var pop = valuePop;
    var isMulti = p.type === 'multi_select' || p.type === 'relation';
    var options = (p.options || []).slice();
    var selected = isMulti ? (p.value || []).slice() : (p.value ? [p.value] : []);
    var query = '';

    function rowFor(o) {
        var pill = o.avatarColor
            ? '<span class="avatar" style="background:' + o.avatarColor + '">' + escapeHtml(o.name.slice(0, 1).toUpperCase()) + '</span>'
            : '<span class="pill c-' + (o.color || 'gray') + '">' + escapeHtml(o.name) + '</span>';
        var isSel = selected.indexOf(o.id) >= 0;
        return '<div class="popover-row" data-opt="' + escapeAttr(o.id) + '">' + pill +
            (isSel ? '<span class="row-hint">✓</span>' : '') + '</div>';
    }

    function build() {
        var filtered = options.filter(function (o) {
            return o.name.toLowerCase().indexOf(query.toLowerCase()) >= 0;
        });
        var html = '';
        if (isMulti) {
            html += '<div class="chips-input">';
            html += selected.map(function (id) {
                var o = optionOf(p, id);
                return '<span class="chip-tag pill c-' + (o.color || 'gray') + '">' + escapeHtml(o.name) +
                    '<button data-unselect="' + escapeAttr(id) + '">✕</button></span>';
            }).join('');
            html += '<input id="optQuery" placeholder="Search or create..." value="' + escapeAttr(query) + '" />';
            html += '</div>';
        } else {
            html += '<input class="popover-search" id="optQuery" placeholder="Search or create..." value="' + escapeAttr(query) + '" />';
        }

        var lastGroup = null;
        filtered.forEach(function (o) {
            if (o.group && o.group !== lastGroup) {
                html += '<div class="popover-group">' + escapeHtml(o.group) + '</div>';
                lastGroup = o.group;
            }
            html += rowFor(o);
        });

        var exact = options.some(function (o) { return o.name.toLowerCase() === query.toLowerCase(); });
        if (query.trim() !== '' && !exact) {
            html += '<div class="popover-row" data-create="1"><span class="pill c-orange">' +
                escapeHtml(query.trim()) + '</span><span class="row-hint">Create</span></div>';
        }
        if (filtered.length === 0 && query.trim() === '') {
            html += '<div class="popover-empty">No options yet</div>';
        }
        pop.innerHTML = html;

        var input = pop.querySelector('#optQuery');
        input.addEventListener('input', function () {
            query = input.value;
            var pos = input.selectionStart;
            build();
            var next = pop.querySelector('#optQuery');
            next.focus();
            next.setSelectionRange(pos, pos);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') hidePopovers();
        });

        pop.querySelectorAll('[data-opt]').forEach(function (el) {
            el.addEventListener('click', function () { pickOption(el.dataset.opt); });
        });
        pop.querySelectorAll('[data-unselect]').forEach(function (el) {
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                selected = selected.filter(function (id) { return id !== el.dataset.unselect; });
                p.value = selected;
                p.source = 'user';
                build();
                render();
            });
        });
        var create = pop.querySelector('[data-create]');
        if (create) {
            create.addEventListener('click', function () {
                var name = query.trim();
                var id = name.toLowerCase().replace(/\s+/g, '_');
                var color = COLORS[options.length % COLORS.length];
                options.push({ id: id, name: name, color: color });
                p.options = options;
                pickOption(id);
            });
        }
    }

    function pickOption(id) {
        if (isMulti) {
            if (selected.indexOf(id) >= 0) selected = selected.filter(function (x) { return x !== id; });
            else selected.push(id);
            p.value = selected;
        } else {
            p.value = id;
        }
        p.source = 'user';
        if (isMulti) { build(); render(); }
        else { hidePopovers(); render(); }
    }

    build();
    placePopover(pop, anchor);
    var input = pop.querySelector('#optQuery');
    if (input) input.focus();
}

/* ---------- date picker ---------- */
function openDatePicker(p, anchor) {
    var pop = valuePop;
    var shown = p.value != null ? new Date(p.value) : new Date();
    var vy = shown.getFullYear();
    var vm = shown.getMonth();

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function build() {
        var today = new Date();
        var first = new Date(vy, vm, 1);
        var startPad = first.getDay();
        var daysInMonth = new Date(vy, vm + 1, 0).getDate();
        var prevDays = new Date(vy, vm, 0).getDate();
        var cells = [];
        for (var i = startPad - 1; i >= 0; i--) {
            cells.push({ d: new Date(vy, vm - 1, prevDays - i), muted: true });
        }
        for (var d = 1; d <= daysInMonth; d++) {
            cells.push({ d: new Date(vy, vm, d), muted: false });
        }
        while (cells.length % 7 !== 0 || cells.length < 42) {
            var n = cells.length - (startPad + daysInMonth) + 1;
            cells.push({ d: new Date(vy, vm + 1, n), muted: true });
            if (cells.length >= 42) break;
        }

        var html = '<div class="date-pop">';
        html += '<div class="cal-head"><span class="cal-title">' +
            new Date(vy, vm, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) +
            '</span><span class="cal-nav"><button data-nav="-1">‹</button><button data-nav="1">›</button></span></div>';
        html += '<div class="cal-week">' + ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
        html += '<div class="cal-grid">';
        cells.forEach(function (c) {
            var cls = 'cal-cell';
            if (c.muted) cls += ' muted';
            if (sameDay(c.d, today)) cls += ' today';
            if (p.value != null && sameDay(c.d, new Date(p.value))) cls += ' selected';
            html += '<div class="' + cls + '" data-day="' + c.d.getTime() + '">' + c.d.getDate() + '</div>';
        });
        html += '</div>';
        html += '<div class="cal-quick">' +
            '<button data-quick="today">Today</button>' +
            '<button data-quick="tomorrow">Tomorrow</button>' +
            '<button data-quick="week">Next week</button>' +
            '<button data-quick="clear">Clear</button>' +
            '</div>';
        html += '</div>';
        pop.innerHTML = html;

        pop.querySelectorAll('[data-nav]').forEach(function (b) {
            b.addEventListener('click', function () {
                vm += Number(b.dataset.nav);
                if (vm < 0) { vm = 11; vy--; }
                if (vm > 11) { vm = 0; vy++; }
                build();
            });
        });
        pop.querySelectorAll('[data-day]').forEach(function (cell) {
            cell.addEventListener('click', function () {
                p.value = Number(cell.dataset.day);
                p.source = 'user';
                hidePopovers();
                render();
            });
        });
        pop.querySelectorAll('[data-quick]').forEach(function (b) {
            b.addEventListener('click', function () {
                var now = new Date();
                var t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                if (b.dataset.quick === 'tomorrow') t.setDate(t.getDate() + 1);
                if (b.dataset.quick === 'week') t.setDate(t.getDate() + 7);
                if (b.dataset.quick === 'clear') { p.value = null; }
                else { p.value = t.getTime(); }
                p.source = 'user';
                hidePopovers();
                render();
            });
        });
    }

    build();
    placePopover(pop, anchor);
}

/* ---------- type picker ---------- */
function openTypePicker(anchor, mode, target) {
    if (!anchor) anchor = document.querySelector('.add-prop');
    var pop = typePop;
    var query = '';
    mode = mode || 'add';

    function build() {
        var html = '<input class="popover-search" id="typeQuery" placeholder="Search for a property" value="' + escapeAttr(query) + '" />';
        html += '<div id="typeList">';
        var lastGroup = null;
        TYPE_ORDER.forEach(function (type) {
            var meta = TYPE_META[type];
            if (meta.label.toLowerCase().indexOf(query.toLowerCase()) < 0) return;
            if (meta.group !== lastGroup) {
                html += '<div class="popover-group">' + escapeHtml(meta.group) + '</div>';
                lastGroup = meta.group;
            }
            html += '<div class="popover-row" data-type="' + type + '">' +
                '<span class="row-ico">' + (ICON[type] || '') + '</span>' +
                '<span class="row-label">' + escapeHtml(meta.label) + '</span></div>';
        });
        html += '</div>';
        pop.innerHTML = html;

        var input = pop.querySelector('#typeQuery');
        input.addEventListener('input', function () {
            query = input.value;
            var pos = input.selectionStart;
            build();
            var next = pop.querySelector('#typeQuery');
            next.focus();
            next.setSelectionRange(pos, pos);
        });
        pop.querySelectorAll('[data-type]').forEach(function (el) {
            el.addEventListener('click', function () { chooseType(el.dataset.type); });
        });
    }

    function chooseType(type) {
        if (mode === 'change') {
            convertType(target, type);
            hidePopovers();
            render();
            return;
        }
        var key = 'p' + Date.now();
        var created = {
            key: key,
            name: 'Property',
            type: type,
            order: props.length,
            value: defaultForType(type),
            source: 'user',
            options: defaultOptionsFor(type),
            readOnly: type === 'formula' || type === 'created_time' || type === 'updated_time',
        };
        props.push(created);
        state.editingNameKey = key;
        hidePopovers();
        render();
    }

    build();
    placePopover(pop, anchor);
}

function defaultForType(type) {
    if (type === 'checkbox') return false;
    if (type === 'number') return 0;
    if (type === 'multi_select' || type === 'relation') return [];
    if (type === 'date') return null;
    if (type === 'select' || type === 'status' || type === 'person') return null;
    if (type === 'formula') return '—';
    return '';
}
function defaultOptionsFor(type) {
    if (type === 'status') {
        return [
            { id: 'todo', name: 'To-do', color: 'gray', group: 'To-do' },
            { id: 'in_progress', name: 'In progress', color: 'blue', group: 'In progress' },
            { id: 'done', name: 'Done', color: 'green', group: 'Complete' },
        ];
    }
    if (type === 'person') return members.map(function (m) { return { id: m.id, name: m.name, avatarColor: m.avatarColor }; });
    if (type === 'relation') return sessions.slice();
    if (type === 'select' || type === 'multi_select') return [];
    return undefined;
}

function convertType(p, type) {
    p.type = type;
    if (isReadonly(p)) return;
    if (type === 'text' || type === 'url') p.value = p.value == null ? '' : String(p.value);
    else if (type === 'number') p.value = Number(p.value) || 0;
    else if (type === 'checkbox') p.value = Boolean(p.value);
    else if (type === 'multi_select') p.value = p.value == null ? [] : (Array.isArray(p.value) ? p.value : [p.value]);
    else if (type === 'select' || type === 'status' || type === 'person' || type === 'relation') {
        p.value = Array.isArray(p.value) ? (p.value[0] || null) : p.value;
    }
    if (!p.options) p.options = defaultOptionsFor(type);
    p.source = 'user';
}

/* ---------- property menu (grip) ---------- */
function openPropMenu(p, anchor) {
    var pop = valuePop;
    pop.innerHTML =
        '<div class="popover-row" data-act="rename"><span class="row-ico">' + ICON.text + '</span><span class="row-label">Rename</span></div>' +
        '<div class="popover-row" data-act="type"><span class="row-ico">' + ICON.select + '</span><span class="row-label">Change type</span></div>' +
        '<div class="popover-divider"></div>' +
        '<div class="popover-row" data-act="delete"><span class="row-ico">✕</span><span class="row-label">Delete property</span></div>';
    pop.querySelector('[data-act="rename"]').addEventListener('click', function () {
        state.editingNameKey = p.key;
        hidePopovers();
        render();
    });
    pop.querySelector('[data-act="type"]').addEventListener('click', function () {
        var row = anchor.closest ? anchor.closest('.prop') : null;
        var visibleAnchor = row ? row.querySelector('.prop-value') : anchor;
        hidePopovers();
        openTypePicker(visibleAnchor, 'change', p);
    });
    pop.querySelector('[data-act="delete"]').addEventListener('click', function () {
        props = props.filter(function (x) { return x.key !== p.key; });
        hidePopovers();
        render();
    });
    placePopover(pop, anchor);
}

/* ---------- toast ---------- */
var toastTimer = null;
function showToast(message, undoFn, duration) {
    var el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.innerHTML = '<span>' + escapeHtml(message) + '</span>' + (undoFn ? '<button id="toastUndo">Undo</button>' : '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, duration || 6000);
    var btn = el.querySelector('#toastUndo');
    if (btn) {
        btn.onclick = function () {
            undoFn();
            el.classList.remove('show');
        };
    }
}

/* ---------- AI auto-fill demo ---------- */
function runAIGen() {
    if (state.aiRunning) return;
    state.aiRunning = true;
    var btn = document.querySelector('.seg.accent');
    var old = btn.textContent;
    btn.textContent = '✨ Thinking…';
    btn.disabled = true;

    var snapshot = deepClone(props);

    setTimeout(function () {
        var changed = [];

        function set(key, value) {
            var p = props.find(function (x) { return x.key === key; });
            if (!p) return;
            p.value = value;
            p.source = 'ai';
            p.aiFresh = true;
            changed.push(p);
        }

        set('date', new Date().getTime());
        set('complexity', 'high');
        set('tags', ['auth', 'refactor', 'go']);

        if (!props.some(function (p) { return p.key === 'tech_stack'; })) {
            var tech = {
                key: 'tech_stack',
                name: 'Tech Stack',
                type: 'multi_select',
                order: props.length,
                value: ['go', 'react'],
                source: 'ai',
                aiFresh: true,
                options: [
                    { id: 'go', name: 'Go', color: 'green' },
                    { id: 'react', name: 'React', color: 'blue' },
                    { id: 'sql', name: 'SQL', color: 'orange' },
                ],
            };
            props.push(tech);
            changed.push(tech);
        }

        render();
        setTimeout(function () {
            props.forEach(function (p) { p.aiFresh = false; });
        }, 2000);

        showToast('✨ AI filled 3 properties and suggested "Tech Stack"', function () {
            props = snapshot;
            render();
        }, 8000);

        state.aiRunning = false;
        btn.textContent = old;
        btn.disabled = false;
    }, 750);
}

/* ---------- init ---------- */
(function init() {
    setIconMode('emoji');
    setCardWidth('wide');
    render();

    var icon = document.getElementById('pageIcon');
    icon.addEventListener('click', function () {
        var order = ['emoji', 'block', 'logo'];
        var next = order[(order.indexOf(state.iconMode) + 1) % order.length];
        setIconMode(next);
    });

    // Review-only deep links: ?demo=type|select|multi|date|menu&icon=logo|emoji|block&card=narrow
    var q = new URLSearchParams(location.search);
    if (q.get('icon')) setIconMode(q.get('icon'));
    if (q.get('card')) setCardWidth(q.get('card'));
    function valueEl(key) {
        var row = document.querySelector('.prop[data-key="' + key + '"]');
        return row ? row.querySelector('.prop-value') : null;
    }
    var demo = q.get('demo');
    if (demo === 'type') openTypePicker(null);
    if (demo === 'select') { var sp = props.find(function (x) { return x.key === 'complexity'; }); if (sp) openOptionPicker(sp, valueEl('complexity')); }
    if (demo === 'multi') { var mp = props.find(function (x) { return x.key === 'tags'; }); if (mp) openOptionPicker(mp, valueEl('tags')); }
    if (demo === 'date') { var dp = props.find(function (x) { return x.key === 'date'; }); if (dp) openDatePicker(dp, valueEl('date')); }
    if (demo === 'menu') { var gp = props.find(function (x) { return x.key === 'status'; }); if (gp) openPropMenu(gp, valueEl('status')); }
    if (demo === 'ai') runAIGen();
})();
