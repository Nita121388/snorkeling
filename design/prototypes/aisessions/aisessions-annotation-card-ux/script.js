// Annotation Card / Rail UX 原型脚本
// 纯前端、无依赖。数据 + 交互全部在这里。
//
// 文件按「读的顺序」分段，每段只依赖它上面的段：
//   DATA → ICONS → HELPERS → STATE → RAIL → FLOW → CARD → INTERACTIONS → EDITOR → INIT
// 函数声明会提升，所以段内顺序只看可读性；顶层的 const / let 必须在使用前求值，
// 因此唯一的入口调用 init() 放在文件最末尾。

// ═══════════════════════════════════════════════════════════════════════════
// DATA — 三套示例数据 + 数据集轮换表
// ═══════════════════════════════════════════════════════════════════════════

// ── 示例数据：4 个批注节点，覆盖 message / tool / summary 三种类型 ──
// 这是「正常数据」基准集，顶部 Data 按钮可在边缘态 / 空 rail 之间切换。
const DEFAULT_NODES = [
    {
        seq: 12,
        type: "message",
        role: "user",
        time: "14:02:18",
        text: "帮我把登录模块从 session 改成 JWT，顺便把 refresh token 的轮换逻辑补上。",
        tool: null,
        summaryTitle: "",
        summary: "",
        annotations: [
            {
                id: 1,
                kind: "note",
                status: "accepted",
                source: "user",
                title: "需求起点",
                body: "整个改动的触发点：登录态从 session 迁移到 JWT。",
                tags: ["auth", "jwt"],
            },
        ],
    },
    {
        seq: 28,
        type: "tool",
        role: "",
        time: "14:09:41",
        text: "",
        tool: { name: "bash", summary: "npm test -- --runInBand", status: "done", count: 3, detail: "128 passed" },
        summaryTitle: "",
        summary: "",
        annotations: [
            {
                id: 2,
                kind: "milestone",
                status: "accepted",
                source: "user",
                title: "测试全绿",
                body: "改造后 128 个用例全部通过，可以进入下一步。",
                tags: ["ci"],
            },
        ],
    },
    {
        seq: 41,
        type: "summary",
        role: "",
        time: "14:20:05",
        text: "",
        tool: null,
        summaryTitle: "章节总结 · 认证链路重构",
        summary:
            "本轮把登录从基于 session 的会话存储，迁移到无状态 JWT：签发 access token（15 分钟），refresh token 落库并支持轮换；鉴权中间件改为校验 JWT，并在 refresh 时校验 token family，防止重放。同时补齐登出、异地登录踢下线、token 过期前端静默刷新三条路径。",
        annotations: [
            {
                id: 3,
                kind: "decision",
                status: "accepted",
                source: "user",
                title: "采用无状态 JWT",
                body: "放弃服务端 session 存储换取横向扩展；代价是要处理 refresh 轮换与撤销。",
                tags: ["architecture", "auth"],
            },
        ],
    },
    {
        seq: 57,
        type: "message",
        role: "assistant",
        time: "14:31:12",
        text: "我把 refresh token 的轮换逻辑拆成独立函数 rotateRefreshToken()，每次使用后立即失效旧 token；如果检测到已失效 token 被复用，会撤销整个 token family 并强制重新登录。",
        tool: null,
        summaryTitle: "",
        summary: "",
        annotations: [
            {
                id: 4,
                kind: "question",
                status: "draft",
                source: "ai",
                title: "token family 撤销范围？",
                body: "复用检测命中时，只撤销当前设备还是全部设备？需要确认产品预期。",
                tags: ["security", "todo"],
            },
            {
                id: 5,
                kind: "note",
                status: "accepted",
                source: "user",
                title: "轮换实现",
                body: "rotateRefreshToken() 使用后立即失效旧 token，逻辑清晰。",
                tags: ["auth"],
            },
        ],
    },
];

// 边缘态数据集：长文本 / 多条批注 / 孤儿批注。
// 时间戳沿用基准集，方便对照同一节点在两种数据下的排版差异。
const EDGE_NODES = [
    {
        seq: 12,
        type: "message",
        role: "user",
        time: "14:02:18",
        text:
            "帮我把登录模块从 session 改成 JWT，顺便把 refresh token 的轮换逻辑补上。回调地址见下，" +
            "这一段故意不带空格，用来验证卡片不会被长 token 顶出边框：" +
            "https://app.example.com/auth/callback?redirect_uri=https%3A%2F%2Fapp.example.com%2Fsettings%2Fsecurity%2Fsessions&scope=openid%20profile%20email%20offline_access&prompt=consent",
        tool: null,
        summaryTitle: "",
        summary: "",
        annotations: [
            {
                id: 11,
                kind: "note",
                status: "accepted",
                source: "user",
                title: "需求起点：登录态从 session 迁移到无状态 JWT，并补齐 refresh token 轮换、撤销与多设备会话",
                body:
                    "长正文用来验证批注条目的截断与渐隐：超过 6 行会被裁掉并加一层向下淡出。" +
                    "第一，refresh token 落库并支持轮换；第二，检测到已失效 token 被复用时撤销整个 token family；" +
                    "第三，登出、异地登录踢下线、token 过期前端静默刷新三条路径都要补齐；" +
                    "第四，需要确认产品对「撤销范围」的预期——只撤销当前设备还是全部设备。" +
                    "第五，回调地址的白名单要与网关配置对齐，否则 refresh 失败会静默降级成重新登录，" +
                    "这条路径在移动端尤其难复现，要在日志里留下 family id 和 device id。",
                tags: ["auth", "jwt", "refresh", "security", "migration", "backend", "p0", "spec"],
            },
        ],
    },
    {
        seq: 28,
        type: "tool",
        role: "",
        time: "14:09:41",
        text: "",
        tool: {
            name: "bash",
            summary: "npm test -- --runInBand --coverage --testPathPattern='auth/(jwt|refresh|session)' --maxWorkers=2",
            status: "done",
            count: 7,
            detail: "212 passed, 0 failed · 84.2% lines",
        },
        summaryTitle: "",
        summary: "",
        annotations: [
            {
                id: 12,
                kind: "milestone",
                status: "accepted",
                source: "user",
                title: "测试全绿",
                body: "212 个用例通过，覆盖率 84.2%，可以进入下一步。",
                tags: ["ci"],
            },
            {
                id: 13,
                kind: "note",
                status: "orphaned",
                source: "user",
                title: "旧锚点批注",
                body: "这条批注的 anchorKey 指向的旧工具调用已被合并，新数据里找不到对应节点，只能作为孤儿批注保留。",
                tags: ["orphan", "stale"],
            },
        ],
    },
    {
        seq: 41,
        type: "summary",
        role: "",
        time: "14:20:05",
        text: "",
        tool: null,
        summaryTitle: "章节总结 · 认证链路重构（refresh 轮换 / 撤销 / 多设备会话）",
        summary:
            "本轮把登录从基于 session 的会话存储迁移到无状态 JWT：签发 access token（15 分钟），refresh token 落库并支持轮换；" +
            "鉴权中间件改为校验 JWT，并在 refresh 时校验 token family，防止重放。同时补齐登出、异地登录踢下线、" +
            "token 过期前端静默刷新三条路径。章节较长是为了验证原文块的 5 行截断与底部渐隐在真实文本下不会露出半行。",
        annotations: [
            {
                id: 14,
                kind: "decision",
                status: "accepted",
                source: "user",
                title: "采用无状态 JWT",
                body: "放弃服务端 session 存储换取横向扩展；代价是要处理 refresh 轮换与撤销。",
                tags: ["architecture", "auth"],
            },
            {
                id: 15,
                kind: "note",
                status: "accepted",
                source: "ai",
                title: "token family 的清理时机",
                body: "family 记录在最后一个 token 过期后回收，避免表无限增长。",
                tags: ["storage"],
            },
            {
                id: 16,
                kind: "question",
                status: "draft",
                source: "ai",
                title: "access token 有效期再压到 5 分钟？",
                body: "更短的有效期降低泄露影响面，但会增加 refresh 次数，需要先压测。",
                tags: ["perf", "todo"],
            },
            {
                id: 17,
                kind: "note",
                status: "draft",
                source: "ai",
                title: "补一条 family 撤销的审计日志",
                body: "撤销动作要可追溯：记录触发原因、device id 与 family id。",
                tags: ["observability"],
            },
        ],
    },
    {
        seq: 57,
        type: "message",
        role: "assistant",
        time: "14:31:12",
        text:
            "我把 refresh token 的轮换逻辑拆成独立函数 rotateRefreshToken()，每次使用后立即失效旧 token；" +
            "如果检测到已失效 token 被复用，会撤销整个 token family 并强制重新登录。",
        tool: null,
        summaryTitle: "",
        summary: "",
        annotations: [
            {
                id: 18,
                kind: "question",
                status: "draft",
                source: "ai",
                title: "token family 撤销范围？",
                body: "复用检测命中时，只撤销当前设备还是全部设备？需要确认产品预期。",
                tags: ["security", "todo"],
            },
            { id: 19, kind: "note", status: "accepted", source: "user", title: "轮换实现", body: "使用后立即失效旧 token，逻辑清晰。", tags: ["auth"] },
            { id: 20, kind: "note", status: "accepted", source: "user", title: "错误文案", body: "重新登录的提示要区分「过期」与「被撤销」。", tags: ["copy"] },
            { id: 21, kind: "decision", status: "accepted", source: "user", title: "保留 15 分钟 access token", body: "先按 15 分钟上线，压测后再评估是否缩短。", tags: ["architecture"] },
            { id: 22, kind: "milestone", status: "accepted", source: "ai", title: "轮换逻辑可独立测试", body: "抽成纯函数后可以直接对 family 做单测。", tags: ["test"] },
            { id: 23, kind: "note", status: "draft", source: "ai", title: "是否需要回收站", body: "被撤销的 family 是否要在设置页可见，便于用户自查。", tags: ["product"] },
        ],
    },
];

// 空 rail 数据集：有消息流、但一条批注都没有。
// 用来验证 rail 空态、不会误开卡片、playhead 不残留。
const EMPTY_NODES = [
    {
        seq: 8,
        type: "message",
        role: "user",
        time: "13:58:02",
        text: "先看看现有的鉴权中间件怎么写的。",
        tool: null,
        summaryTitle: "",
        summary: "",
        annotations: [],
    },
    {
        seq: 19,
        type: "tool",
        role: "",
        time: "14:01:44",
        text: "",
        tool: { name: "read", summary: "pkg/auth/middleware.go", status: "done", count: 1, detail: "142 lines" },
        summaryTitle: "",
        summary: "",
        annotations: [],
    },
    {
        seq: 33,
        type: "summary",
        role: "",
        time: "14:04:10",
        text: "",
        tool: null,
        summaryTitle: "章节总结 · 现有鉴权实现",
        summary: "中间件按 session cookie 校验登录态，refresh 逻辑散落在 handler 里，没有统一的 token 生命周期管理。",
        annotations: [],
    },
];

// 顶部 Data 按钮按这个顺序循环。三套数据走同一条渲染路径，
// 不存在「主数据能跑、边缘数据靠特判」的分叉。
const DATASETS = [
    { label: "Default", nodes: DEFAULT_NODES },
    { label: "Edge states", nodes: EDGE_NODES },
    { label: "No notes", nodes: EMPTY_NODES },
];
let datasetIndex = 0;
let NODES = DATASETS[datasetIndex].nodes;

const KIND_LABEL = { note: "Note", milestone: "Milestone", decision: "Decision", question: "Question" };

// ═══════════════════════════════════════════════════════════════════════════
// ICONS — 内联 SVG path 表 + 按节点类型取图标
// ═══════════════════════════════════════════════════════════════════════════

function icon(kind, size = 14) {
    const paths = {
        chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        wrench:
            '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
        sparkles:
            '<path d="M12 3l1.8 4.6 4.6 1.8-4.6 1.8L12 15.8l-1.8-4.6L5.6 9.4l4.6-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
        external:
            '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
        x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        chevron: '<polyline points="6 9 12 15 18 9"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}

function typeIcon(type, size) {
    if (type === "tool") return icon("wrench", size);
    if (type === "summary") return icon("sparkles", size);
    return icon("chat", size);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS — 纯函数 + 交互时长常量
// ═══════════════════════════════════════════════════════════════════════════

function secs(t) {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + (s || 0);
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── 交互时长 ──
// 悬停延迟：快速掠过一排圆点时不该一路弹卡（连续弹卡动画是原型里最明显的闪动源）。
// 收起延迟：比悬停延迟长，鼠标从圆点挪到卡片（14px 空隙）期间卡片不会先消失。
// 选中延迟：单击与双击共用同一段时间窗，dblclick 会提前把它清掉。
const SHOW_DELAY_MS = 70;
const HIDE_DELAY_MS = 240;
const SELECT_DELAY_MS = 210;
const FLASH_MS = 1200;
// 卡片退场动画时长，必须与 CSS 的 cardOut 一致（到点才摘 DOM）；
// reduce motion 下不等计时器，直接摘。
const CARD_OUT_MS = 100;
// 窄到这个宽度卡片两侧都放不下，改成底部面板（见 positionCard + CSS .is-sheet）
const SHEET_MAX_WIDTH = 560;
// 批注条数到这一档就切「密集」排版：原文块与批注正文各收一档行数，
// 否则 4 条以上批注会把卡片撑成一条很难扫读的长滚动。
const DENSE_ANNOTATIONS = 4;

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// ═══════════════════════════════════════════════════════════════════════════
// STATE — 交互状态、DOM 单例引用
// ═══════════════════════════════════════════════════════════════════════════

const state = { hover: null, selected: null, showTimer: null, hideTimer: null, clickTimer: null, jumpTimer: null };

// 卡片 DOM 单例：只有「目标节点换了」才重建（见 refreshCard）。
let cardEl = null;

const railBody = document.getElementById("railBody");
const flow = document.getElementById("flow");
const cardLayer = document.getElementById("cardLayer");
const editorLayer = document.getElementById("editorLayer");

// ═══════════════════════════════════════════════════════════════════════════
// RAIL — 左侧圆点时间轴：状态色、渲染、playhead、选中 ring
// ═══════════════════════════════════════════════════════════════════════════

// 状态优先级：orphan > 任意 draft > accepted。
// 只要有未确认的 draft 就画空心 ring（哪怕同时有已确认批注），
// 否则「这条节点还有待确认的批注」在 rail 上完全看不见；只有全部 accepted 才画实心。
function nodeStatus(n) {
    const sts = n.annotations.map((a) => a.status);
    if (sts.includes("orphaned")) return "is-orphan";
    if (sts.includes("draft")) return "is-draft";
    return "";
}

// 圆点只代表「有批注的节点」：没有批注的节点在 rail 上不存在，
// 所以整段数据都没批注时，rail 退化成一句空态提示，而不是画一排无意义的点。
function renderRail() {
    const axis = document.createElement("div");
    axis.className = "rail-axis";
    railBody.appendChild(axis);

    const annotated = NODES.filter((n) => n.annotations.length);

    if (!annotated.length) {
        const empty = document.createElement("div");
        empty.className = "rail-empty";
        empty.innerHTML = "<span>No notes yet</span>";
        railBody.appendChild(empty);
        railBody._playhead = null;
        return;
    }

    // playhead 先插入、圆点后插入：这样圆点始终画在 playhead 之上，
    // 两者恰好重合时实心/空心 dot 也不会被那条 2px 线从中间切断。
    const ph = document.createElement("div");
    ph.className = "rail-playhead";
    railBody.appendChild(ph);
    railBody._playhead = ph;

    // 时间轴百分比：上下各留 8% 余量（dot 不贴 rail 顶/底），可用区间 84%。
    // 相邻圆点强制 ≥7% 间距，避免时间接近的节点（边缘数据里会有）圆点重叠。
    const PAD = 8;
    const AVAIL = 84;
    const MIN_GAP = 7;
    const times = annotated.map((n) => secs(n.time));
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const frac = (t) => (maxT > minT ? (t - minT) / (maxT - minT) : 0.5);
    const raw = annotated.map((n) => PAD + frac(secs(n.time)) * AVAIL);
    const positions = raw.slice();
    for (let i = 1; i < positions.length; i++) {
        positions[i] = Math.max(positions[i], positions[i - 1] + MIN_GAP);
    }
    // 尾部越界时整体回收；若回收后首个 dot 又越过顶边，说明可用高度不够，改用等距铺满。
    const over = positions[positions.length - 1] - (100 - PAD);
    if (over > 0) {
        if (positions[0] - over >= PAD) {
            for (let i = 0; i < positions.length; i++) positions[i] -= over;
        } else {
            // 圆点多到等距也铺不下（MIN_GAP 会叠在彼此身上）时继续压缩间距，
            // 宁可挤一点也不能让最后一个圆点被 rail 底边裁掉、点不到。
            const step = positions.length > 1 ? AVAIL / (positions.length - 1) : 0;
            for (let i = 0; i < positions.length; i++) positions[i] = PAD + step * i;
        }
    }

    annotated.forEach((n, i) => {
        const top = positions[i];
        const wrap = document.createElement("div");
        wrap.className = "rail-dot";
        wrap.style.top = `${top}%`;
        wrap.dataset.seq = String(n.seq);
        wrap.dataset.top = top.toFixed(2);
        const st = nodeStatus(n);
        // 圆点是一个「双动作」按钮：单击固定卡片，再按一次（或已选中时激活）跳转到节点。
        // aria-expanded 同步固定态，读屏能听出卡片开着还是关着。
        wrap.innerHTML = `
            <button type="button"
                aria-haspopup="dialog"
                aria-controls="acard-${n.seq}"
                aria-expanded="false"
                aria-label="#${n.seq} · ${esc(n.time.slice(0, 5))} — annotation. Select to pin the card, double-click to jump to the node.">
                <span class="dot ${st}"></span>
            </button>
            <span class="seq-tip"><span class="tip-seq">#${n.seq}</span><span class="tip-time">${n.time.slice(0, 5)}</span></span>`;
        const btn = wrap.querySelector("button");
        btn.addEventListener("mouseenter", () => previewNode(n.seq));
        btn.addEventListener("mouseleave", () => endPreview(n.seq));
        // 键盘 Tab 到圆点等同 hover：焦点与悬停共用同一套延迟 / 收起逻辑
        btn.addEventListener("focus", () => previewNode(n.seq));
        btn.addEventListener("blur", () => endPreview(n.seq));
        btn.addEventListener("click", () => handleDotClick(n.seq));
        btn.addEventListener("dblclick", () => jumpTo(n.seq));
        railBody.appendChild(wrap);
    });
}

// 取视口中线最靠近的 flow-row，把它的 seq 对应 rail-dot 的 top 同步给 playhead。
function updatePlayhead() {
    const ph = railBody._playhead;
    if (!ph) return;
    const vmid = flow.getBoundingClientRect().top + flow.clientHeight / 2;
    let best = null;
    let bestDist = Infinity;
    flow.querySelectorAll(".flow-row").forEach((row) => {
        const r = row.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - vmid);
        if (d < bestDist) {
            bestDist = d;
            best = row;
        }
    });
    if (!best) {
        ph.classList.remove("show");
        return;
    }
    const dot = railBody.querySelector(`.rail-dot[data-seq="${best.dataset.seq}"]`);
    if (!dot) {
        ph.classList.remove("show");
        return;
    }
    ph.style.top = `${dot.dataset.top}%`;
    ph.classList.add("show");
}

function setDotSelected(seq) {
    railBody.querySelectorAll(".rail-dot").forEach((w) => {
        const d = w.querySelector(".dot");
        const isSel = seq != null && Number(w.dataset.seq) === seq;
        d.classList.toggle("is-selected", isSel);
        // aria-expanded 跟固定态走：卡片被选中固定时读屏应报「已展开」。
        const btn = w.querySelector("button");
        if (btn) btn.setAttribute("aria-expanded", isSel ? "true" : "false");
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW — 右侧消息流：行骨架 + 三种行类型的 HTML
// ═══════════════════════════════════════════════════════════════════════════

function renderFlow() {
    const inner = document.createElement("div");
    inner.style.cssText = "max-width:760px;margin:0 auto;";
    NODES.forEach((n) => {
        const row = document.createElement("div");
        row.className = "flow-row";
        row.dataset.seq = String(n.seq);
        row.id = `flow-${n.seq}`;
        // 每行是一个独立分组，读屏用 label 就能报出「Message #12」这类身份。
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", `${flowRowKindLabel(n)} #${n.seq}`);
        row.innerHTML = flowRowHTML(n);
        inner.appendChild(row);
    });
    flow.appendChild(inner);
}

function flowRowKindLabel(n) {
    if (n.type === "tool") return "Tool call";
    if (n.type === "summary") return "Summary";
    return "Message";
}

function flowRowHTML(n) {
    if (n.type === "tool") {
        return `<div class="toolgroup">
            <div class="tg-head">
                ${icon("chevron", 10)}
                ${n.tool.count ? `<span class="tg-count">${n.tool.count}</span>` : ""}
                <span class="tg-wrench">${icon("wrench", 12)}</span>
                <span class="tg-sum">${esc(n.tool.summary)}</span>
                <span class="tg-status ${n.tool.status}"></span>
            </div>
        </div>`;
    }
    if (n.type === "summary") {
        return `<div class="toolgroup kind-summary">
            <div class="tg-head">
                <span style="color:var(--warning-color)">${icon("sparkles", 12)}</span>
                <span class="tg-sum" style="color:var(--main-text-color);font-weight:var(--fw-semibold)">${esc(n.summaryTitle)}</span>
            </div>
            <div style="padding:0 12px 10px;font-size:var(--fs-caption);line-height:var(--lh-base);color:var(--secondary-text-color)">${esc(n.summary)}</div>
        </div>`;
    }
    return `<div class="msg">
        <span class="role">${esc(n.role)}</span>
        <span class="body">${esc(n.text)}</span>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD — 悬浮卡：构建、内容分段、定位、截断提示
// ═══════════════════════════════════════════════════════════════════════════

// 卡片 DOM 复用：只有「目标节点变了」才重建并重放入场动画。
// 早先每次 refresh 都先清空 card-layer 再插入，导致同一节点从 hover 转选中
// 也会重放 0.12s 入场动画并丢掉 hover 状态——表现出来就是「点一下闪一下」。
function refreshCard() {
    const seq = state.hover ?? state.selected;
    if (seq == null) {
        hideCard();
        return;
    }
    const node = NODES.find((n) => n.seq === seq);
    if (!node) return;
    const dotWrap = railBody.querySelector(`.rail-dot[data-seq="${seq}"]`);
    const dotEl = dotWrap ? dotWrap.querySelector(".dot") : null;

    if (!cardEl || cardEl.dataset.seq !== String(seq)) {
        const next = document.createElement("div");
        next.className = "acard";
        next.dataset.seq = String(seq);
        // 卡片是 rail 圆点 aria-controls 指向的对话框：id 与 role 让圆点和卡片可关联。
        next.id = `acard-${seq}`;
        next.setAttribute("role", "dialog");
        next.setAttribute("aria-label", `Annotation #${seq}`);
        next.dataset.type = node.type;
        // 批注多时切密集排版（CSS 收行数），依赖数据在构建时固定，故写在建卡这一层
        next.classList.toggle("is-dense", node.annotations.length >= DENSE_ANNOTATIONS);
        next.innerHTML = cardHTML(node);
        next.addEventListener("mouseenter", () => {
            clearTimeout(state.hideTimer);
            // 从圆点滑进卡片时 hover 已随 mouseleave 清空，这里补回来，
            // 否则卡片在、圆点 ring 却丢了（两边状态不同步看起来就像卡闪了一下）
            if (state.selected == null) state.hover = seq;
            setDotSelected(state.selected);
        });
        next.addEventListener("mouseleave", () => {
            if (state.selected == null) scheduleHide();
        });
        wireCardActions(next, node);
        // 先插新卡再摘旧卡：同一帧内完成替换，不会出现「两张都不在」的一帧。
        // 换卡是接力而不是收起，所以旧卡直接 remove、不播退场动画，
        // 否则相邻两节点会让两张卡同时半透明地叠一下。
        cardLayer.appendChild(next);
        if (cardEl) cardEl.remove();
        cardEl = next;
    }
    // pinned 只改类：✕ 按钮常驻在 DOM 里（用 visibility 隐藏），
    // 所以 hover→选中不会让页脚重新排版、卡片也不会跳位。
    cardEl.classList.toggle("pinned", state.selected === seq);
    if (dotEl) positionCard(cardEl, dotEl);
    syncCardHints(cardEl);
    highlightFlow(seq);
    setDotSelected(state.selected);
}

// 卡片 IA：头 = 节点身份（类型图标 + 类型名 + #seq + 时间），
// 中段 = 被批注原文块 + 批注列表，脚 = 动作（打开编辑器 / 收起）。
// 三段各司其职，标题类信息只在头出现一次，正文块不再复写类型名。
// 收起按钮始终渲染、靠 CSS 在未固定时隐藏：pinned 切换因此不产生任何布局位移。
function cardHTML(n) {
    return `
        <div class="acard-head">
            <span class="node-type ${n.type}">${typeIcon(n.type, 12)}</span>
            <span class="node-name">${nodeKindLabel(n)}</span>
            <span class="node-seq">#${n.seq}</span>
            <span class="node-time">${esc(n.time.slice(0, 5))}</span>
        </div>
        <div class="node-block">${nodeBodyHTML(n)}</div>
        ${annGroupHTML(n)}
        <div class="acard-foot">
            <button type="button" class="foot-btn" data-open title="Open editor" aria-label="Open editor">
                ${icon("external", 12)}<span>Open editor</span>
            </button>
            <button type="button" class="icbtn" data-close title="Close" aria-label="Close">${icon("x", 14)}</button>
        </div>
    `;
}

// 批注分组：标题 + 计数 + 细分隔线，把「节点原文」和「批注」分成两层；
// 批注本身收进一个列表容器（内部只用一条分隔线），避免卡内再套一圈边框。
function annGroupHTML(n) {
    const anns = n.annotations;
    if (!anns.length) return "";
    const accepted = anns.filter((a) => a.status === "accepted").length;
    const meta = accepted === anns.length ? `${anns.length}` : `${anns.length} · ${accepted} Accepted`;
    return `<div class="ann-group">
        <div class="ann-group-head">
            <span>Annotations</span>
            <span class="ag-count">${meta}</span>
            <span class="ag-rule"></span>
        </div>
        <ul class="ann-list">${anns.map(annHTML).join("")}</ul>
    </div>`;
}

function nodeKindLabel(n) {
    if (n.type === "tool") return "Tool call";
    if (n.type === "summary") return "Section summary";
    return "Message";
}

// 节点原文块：第一行放「这行内容的身份」（角色 / 工具状态 / 章节标题），
// 第二行才是截断正文，扫读时先看到归类再决定是否细读。
function nodeBodyHTML(n) {
    if (n.type === "tool") {
        return `<div class="tool-row">
            <span class="tw">${icon("wrench", 12)}</span>
            <span class="tname">${esc(n.tool.name)}</span>
            <span class="tsum">${esc(n.tool.summary)}</span>
            <span class="tstatus ${n.tool.status}"></span>
        </div>
        ${
            n.tool.detail
                ? `<div class="nb-meta"><span class="nb-status ${n.tool.status}">${esc(n.tool.status)}</span><span>${esc(n.tool.detail)}</span></div>`
                : ""
        }`;
    }
    if (n.type === "summary") {
        return `<div class="nb-lead">${esc(n.summaryTitle)}</div>
            <div class="nb-text">${esc(n.summary)}</div>`;
    }
    return `<div class="nb-meta"><span class="chip role">${esc(n.role)}</span></div>
        <div class="nb-text">${esc(n.text)}</div>`;
}

function annHTML(a) {
    const draft = a.status === "draft";
    const orphan = a.status === "orphaned";
    // 元信息行：类型 chip（左）→ 状态徽标（如 draft）→ 来源（右）。
    // 三种信息按「轻一档」排布，把视觉重量让给下面的标题。
    const kindChip = `<span class="chip kind${draft ? " draft" : ""}">${KIND_LABEL[a.kind] || a.kind}</span>`;
    const statusChip = draft ? '<span class="chip status-draft">Draft</span>' : "";
    const orphanChip = orphan ? '<span class="chip orphan">Orphan</span>' : "";
    return `<li class="ann${draft ? " is-draft" : ""}${orphan ? " is-orphan" : ""}">
        <div class="ann-meta">
            ${kindChip}${statusChip}${orphanChip}
            <span class="ann-src">${esc(a.source)}</span>
        </div>
        ${a.title ? `<div class="ann-title">${esc(a.title)}</div>` : ""}
        ${a.body ? `<div class="ann-body">${esc(a.body)}</div>` : ""}
        ${
            a.tags && a.tags.length
                ? `<div class="ann-tags">${a.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div>`
                : ""
        }
    </li>`;
}

// 宽度 / 高度都从实际元素量（CSS 里是 328px，写死 320 会让翻转阀值偏 8px）。
function positionCard(card, dotEl) {
    // 窄屏：圆点左右都放不下 328px 的卡，继续硬夹在视口里会盖满整个 flow。
    // 改成底部升起的面板，位置完全交给 CSS；这里必须清掉 inline left/top，
    // 否则 CSS 的 bottom 会被 inline top 打败。
    if (window.innerWidth <= SHEET_MAX_WIDTH) {
        card.classList.add("is-sheet");
        card.style.left = "";
        card.style.top = "";
        card.style.transformOrigin = "center bottom";
        return;
    }
    card.classList.remove("is-sheet");
    const r = dotEl.getBoundingClientRect();
    const cardW = card.offsetWidth || 328;
    const cardH = card.offsetHeight;
    const gap = 14;
    // 右侧放不下就翻到圆点左边。transform-origin 跟着翻转，
    // 入场动画就从靠近圆点的那条边张开，而不是不管朝哪都从左上角放大。
    let left = r.right + gap;
    const flipped = left + cardW > window.innerWidth - 8;
    if (flipped) left = r.left - cardW - gap;
    // 两侧都放不下（刚过 560px 阀值时）夹回视口内，左右各留 8px，
    // 不能只靠翻转——翻转后仍可能负值溢出到左屏外。
    const maxLeft = Math.max(8, window.innerWidth - cardW - 8);
    left = Math.min(Math.max(8, left), maxLeft);
    card.style.transformOrigin = `${flipped ? "right" : "left"} center`;
    card.style.left = `${left}px`;
    // 圆点靠顶/靠底时垂直夹回视口，卡片头永远不会被切掉
    const top = Math.max(12, Math.min(r.top - 12, window.innerHeight - cardH - 12));
    card.style.top = `${top}px`;
}

// 卡片宽度 / 行数都随视口变：resize 时重定位一次，否则卡片会停在旧坐标上，
// 宽屏切窄屏后会有一半跑出视口。
function refreshCardPosition() {
    if (!cardEl || !cardEl.dataset.seq) return;
    const wrap = railBody.querySelector(`.rail-dot[data-seq="${cardEl.dataset.seq}"]`);
    const dot = wrap ? wrap.querySelector(".dot") : null;
    syncCardHints(cardEl);
    if (dot) positionCard(cardEl, dot);
}

// 两件事：
// 1) 只在真被截断时才加底部渐隐（短文本不裁就不加，否则会“莫名少半行”的淡化）；
// 2) 卡片整体可滚时给贴底的脚加一层上阴影（否则脚看起来像把正文切成半行）。
// clamp 行数跟视口宽度走，所以 resize 后也要重算（见 refreshCardPosition）。
function syncCardHints(card) {
    card.querySelectorAll(".nb-text, .ann-body").forEach((el) => {
        el.classList.toggle("is-clamped", el.scrollHeight - el.clientHeight > 1);
    });
    card.classList.toggle("is-scrollable", card.scrollHeight - card.clientHeight > 1);
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERACTIONS — hover / 单击 / 双击 / 收起 / 高亮 / 复位 / 数据集切换
// ═══════════════════════════════════════════════════════════════════════════

// 悬停：延迟 SHOW_DELAY_MS 才出卡，期间离开就作废。
function previewNode(seq) {
    clearTimeout(state.hideTimer);
    clearTimeout(state.showTimer);
    if (state.hover === seq) return;
    state.showTimer = setTimeout(() => {
        state.showTimer = null;
        state.hover = seq;
        refreshCard();
    }, SHOW_DELAY_MS);
}

// 离开圆点：先撤销悬停；有选中态时回落成「已选中的那张卡」，否则延迟收起。
// 「先回落再收起」保证了从圆点 A 滑到圆点 B 时卡片不会中间空一帧。
function endPreview(seq) {
    clearTimeout(state.showTimer);
    state.showTimer = null;
    if (state.hover === seq) state.hover = null;
    if (state.selected != null) refreshCard();
    else scheduleHide();
}

function scheduleHide() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
        state.hideTimer = null;
        if (state.selected != null) return;
        state.hover = null;
        refreshCard();
    }, HIDE_DELAY_MS);
}

function hideCard() {
    // 不再用 cardLayer.innerHTML = "" ：那会连带清掉还在播退场动画的旧卡。
    dismissCard(cardEl);
    cardEl = null;
    // 圆点的选中 ring 跟着卡片一起清。早先 hideCard 只清高亮不清 ring，
    // 双击跳转 / 点外部关闭后 rail 上会残留一个“还选中着”的圆点。
    setDotSelected(null);
    clearFlowHighlight();
}

// 卡片退场：先挂 is-leaving 播一次淡出，再摘 DOM。
// 之前是直接 remove()，hover 离开时卡片“啪”一下消失，和入场动画不对称。
function dismissCard(el) {
    if (!el) return;
    el.classList.add("is-leaving");
    el.setAttribute("aria-hidden", "true");
    // 退场中的旧卡与下一张新卡会短暂共存：摘掉 id，避免同 id 重复。
    el.removeAttribute("id");
    if (reduceMotion.matches) {
        el.remove();
        return;
    }
    window.setTimeout(() => el.remove(), CARD_OUT_MS);
}

// ── 流程高亮 ──
// 悬停/选中只做「边框点亮」（is-target）；双击跳转额外打一次脉冲（is-jump，见 CSS）。
// 跳转脉冲走自己的 animation 生命周期，不再依赖 is-target 的增删，
// 否则鼠标一离开圆点、卡片收起时会把还没播完的 1.2s 高亮提前抹掉。
function cancelJumpFlash() {
    clearTimeout(state.jumpTimer);
    state.jumpTimer = null;
    flow.querySelectorAll(".flow-row.is-jump").forEach((row) => row.classList.remove("is-jump"));
}

function highlightFlow(seq) {
    // 新的悬停预览接管高亮：先撤掉上一次跳转残留的脉冲
    cancelJumpFlash();
    flow.querySelectorAll(".flow-row").forEach((row) => {
        row.classList.toggle("is-target", Number(row.dataset.seq) === seq);
    });
}

function clearFlowHighlight() {
    flow.querySelectorAll(".flow-row").forEach((row) => {
        row.classList.remove("is-target");
    });
}

// ── 单击 vs 双击 ──
function handleDotClick(seq) {
    clearTimeout(state.clickTimer);
    // 点击不等悬停延迟：先立即出卡，再起「转选中」的计时器
    clearTimeout(state.showTimer);
    state.showTimer = null;
    state.hover = seq;
    refreshCard();
    state.clickTimer = setTimeout(() => {
        state.clickTimer = null;
        // 单击：选中并固定卡片（双击会在 dblclick 里先清掉这个 timer）。
        // 只有鼠标没移到别的节点时才固定：点完 A 立刻移到 B 时，
        // 210ms 后不该把卡片又拽回 A（否则表现为卡片来回跳一下）。
        // hover 为 null 是「从圆点滑向卡片、正好落在 14px 空隙里」的合法情况，
        // 不能当成放弃固定，否则单击后立刻移到卡片上会固定失败。
        if (state.hover != null && state.hover !== seq) return;
        state.selected = seq;
        refreshCard();
    }, SELECT_DELAY_MS);
}

function jumpTo(seq) {
    // 跳转 = 导航动作：收起卡片与选中态，只留目标行一次 1.2s 脉冲（对应 AnnotationFlashMs）
    clearPendingTimers();
    state.selected = null;
    state.hover = null;
    refreshCard();
    const row = flow.querySelector(`#flow-${seq}`);
    if (!row) return;
    // 跳转反馈不能依赖 scrollIntoView 存在：它缺失时（非浏览器环境）
    // 直接抛错会把后面的脉冲整个跳过，看起来像「双击没反应」。
    if (typeof row.scrollIntoView === "function") {
        row.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
    }
    cancelJumpFlash();
    // 重启动画：摘类 → 强制回流 → 挂类，连续双击同一行也能重新播一次
    void row.offsetWidth;
    row.classList.add("is-jump");
    state.jumpTimer = window.setTimeout(() => {
        state.jumpTimer = null;
        row.classList.remove("is-jump");
    }, FLASH_MS);
}

// ── 交互复位 ──
function clearPendingTimers() {
    clearTimeout(state.showTimer);
    clearTimeout(state.hideTimer);
    clearTimeout(state.clickTimer);
    state.showTimer = state.hideTimer = state.clickTimer = null;
}

// 点空白处 / ✕ / Esc：一切归零（悬停、选中、计时器、跳转脉冲、卡片、编辑器）。
function resetInteraction() {
    clearPendingTimers();
    cancelJumpFlash();
    state.selected = null;
    state.hover = null;
    refreshCard();
}

// 卡片动作只在建卡时绑一次（不参与每次 refresh），所以选中态切换不会重复叠加监听。
function wireCardActions(card, node) {
    const openBtn = card.querySelector("[data-open]");
    if (openBtn) {
        openBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditor(node, node.annotations[0], openBtn);
        });
    }
    const closeBtn = card.querySelector("[data-close]");
    if (closeBtn) {
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            resetInteraction();
        });
    }
}

// 切换数据集：先把卡片 / 编辑器 / 计时器全部收干净，再重建 rail 与 flow。
// 不重绑 scroll 监听（它挂在 init 里），否则每切一次数据集就多一个监听器。
function renderAll() {
    clearPendingTimers();
    cancelJumpFlash();
    state.selected = null;
    state.hover = null;
    // 数据集换了，旧卡里的节点已经不存在：直接摧掉，不播退场动画（否则会看到一张
    // 指向旧数据的卡在淡出）。
    if (cardEl) cardEl.remove();
    cardEl = null;
    editorLayer.innerHTML = "";
    railBody.innerHTML = "";
    flow.innerHTML = "";
    renderRail();
    renderFlow();
    updatePlayhead();
}

// ═══════════════════════════════════════════════════════════════════════════
// EDITOR — 批注编辑弹窗：打开、关闭收口、Tab 循环
// ═══════════════════════════════════════════════════════════════════════════

function nodePreviewText(n) {
    if (n.type === "tool") return `${n.tool.name} · ${n.tool.summary}`;
    if (n.type === "summary") return n.summary;
    return n.text;
}

// 编辑器的关闭必须唯一收口：Esc、Cancel、Save、Delete、点遮罩都走 closeEditor()，
// 这样「焦点回填到触发按钮」不会在某个分支里漏掉。
let editorTrigger = null;

function closeEditor() {
    editorLayer.innerHTML = "";
    const back = editorTrigger;
    editorTrigger = null;
    if (back && typeof back.focus === "function" && back.isConnected) back.focus();
}

const EDITOR_FOCUSABLE = 'button, input, textarea, [href], select, [tabindex]:not([tabindex="-1"])';

// Tab 循环：编辑器是 aria-modal，背景不该被 Tab 穿过去。
function trapEditorTab(e) {
    if (e.key !== "Tab") return;
    const dialog = editorLayer.querySelector(".editor");
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll(EDITOR_FOCUSABLE)).filter(
        (el) => !el.disabled && el.getAttribute("aria-hidden") !== "true"
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
    }
    if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
    }
}

function openEditor(node, annotation, trigger) {
    editorLayer.innerHTML = "";
    editorTrigger = trigger || (document.activeElement !== document.body ? document.activeElement : null);
    const editor = document.createElement("div");
    editor.className = "editor-layer open";
    editor.innerHTML = `
        <div class="editor" role="dialog" aria-modal="true" aria-labelledby="editorTitle">
            <header class="editor-head">
                <h2 class="eh-title" id="editorTitle">${annotation ? "Edit annotation" : "Add annotation"}</h2>
                <span class="eh-seq">#${node.seq}</span>
            </header>

            <section class="e-section">
                <div class="e-section-head"><span class="e-section-title">Kind</span></div>
                <div class="e-kind">
                    ${Object.entries(KIND_LABEL)
                        .map(
                            ([v, label]) =>
                                `<button type="button" data-kind="${v}" class="${annotation && annotation.kind === v ? "on" : ""}">${label}</button>`
                        )
                        .join("")}
                </div>
            </section>

            <section class="e-section">
                <div class="e-section-head"><span class="e-section-title">Node</span></div>
                <div class="e-node-preview">${esc(nodePreviewText(node))}</div>
            </section>

            <section class="e-section">
                <div class="e-section-head"><span class="e-section-title">Annotation</span></div>
                <div class="e-label">Title</div>
                <input class="e-field" data-focus value="${esc(annotation?.title ?? "")}" placeholder="Title" />
                <div class="e-label">Body</div>
                <textarea class="e-field" rows="4" placeholder="Annotation body">${esc(annotation?.body ?? "")}</textarea>
                <div class="e-label">Tags</div>
                <input class="e-field" value="${esc((annotation?.tags ?? []).map((t) => "#" + t).join(" "))}" placeholder="Tags (space separated)" />
            </section>

            <div class="e-actions">
                ${annotation ? '<button type="button" class="btn danger" data-delete>Delete</button>' : "<span></span>"}
                <div class="right">
                    <button type="button" class="btn ghost" data-cancel>Cancel</button>
                    <button type="button" class="btn primary" data-save>Save</button>
                </div>
            </div>
        </div>`;
    editorLayer.appendChild(editor);

    editor.querySelector("[data-cancel]").addEventListener("click", closeEditor);
    editor.querySelector("[data-save]").addEventListener("click", closeEditor);
    const del = editor.querySelector("[data-delete]");
    if (del) del.addEventListener("click", closeEditor);
    editor.addEventListener("click", (e) => {
        if (e.target === editor) closeEditor();
    });
    // 打开即聚焦 Title：编辑的主体是这条批注的标题，键盘用户不必先 Tab 过类型按钮组与节点预览。
    const titleField = editor.querySelector("[data-focus]");
    if (titleField) titleField.focus();
    editor.querySelectorAll(".e-kind button").forEach((b) => {
        b.addEventListener("click", () => {
            editor.querySelectorAll(".e-kind button").forEach((x) => x.classList.remove("on"));
            b.classList.add("on");
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT — 首次渲染 + 全局监听（scroll / resize / 点空白 / Esc / 原型辅助按钮）
// ═══════════════════════════════════════════════════════════════════════════

function init() {
    renderRail();
    renderFlow();
    // flow 渲染完才有 row 可量，playhead 必须在两者之后首次定位
    updatePlayhead();
    // scroll 监听只绑一次（在 init），不放进 renderRail，否则每切一次数据集就多一个监听器
    flow.addEventListener("scroll", updatePlayhead, { passive: true });
    window.addEventListener("resize", () => {
        updatePlayhead();
        refreshCardPosition();
    });

    // 空态：在卡片/圆点/编辑器之外点一下清掉选中与悬停。
    // 圆点本身用 mousedown 吞掉，避免「点 B 的 mousedown 先触发 document 清空、
    // 再触发 B 的 click」这种互相打架导致的卡闪。
    document.addEventListener("mousedown", (e) => {
        if (e.target.closest(".acard") || e.target.closest(".rail-dot") || e.target.closest(".editor-layer")) return;
        if (state.selected != null || state.hover != null) resetInteraction();
    });

    // Esc 分层关闭：先关编辑器（并回填焦点），再清卡片与选中。
    document.addEventListener("keydown", (e) => {
        if (editorLayer.querySelector(".editor")) {
            trapEditorTab(e);
            if (e.key !== "Escape") return;
            closeEditor();
            return;
        }
        if (e.key !== "Escape") return;
        resetInteraction();
    });

    // 数据集切换（原型辅助）：Default → Edge states → No notes 循环。
    // 三套数据验证长文本 / 批注密集 / 孤儿批注 / 空 rail 四条边缘路径。
    const dataToggle = document.getElementById("dataToggle");
    if (dataToggle) {
        dataToggle.addEventListener("click", () => {
            datasetIndex = (datasetIndex + 1) % DATASETS.length;
            NODES = DATASETS[datasetIndex].nodes;
            dataToggle.textContent = `Data: ${DATASETS[datasetIndex].label}`;
            renderAll();
        });
    }

    // 主题切换（原型辅助）
    const toggle = document.getElementById("themeToggle");
    toggle.addEventListener("click", () => {
        const root = document.documentElement;
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        root.dataset.theme = next;
        toggle.textContent = next === "dark" ? "Light" : "Dark";
    });
}

init();
