// 批注时间线 v2 深度原型。
//
// 覆盖 design/plans/aisessions-annotation-timeline-v2.md：
//   D1 分页：时间桶窗口 / 游标式「加载更早」/ 滚动锚定 / 日期跳转 / 稀疏折叠 / 骨架 / 错误重试
//   D2 视觉与交互：rail 过滤·草稿条·轴 scrub·键盘 roving focus / 分段头 / 富消息行 /
//      悬浮卡（来源徽章·上下条·孤儿条）/ 编辑器 modal / 空态
//   D3 外部写入：agent 批注 → agent 角标 + 新批注 pill（不劫持滚动）
//
// 纯静态演示，无真实 RPC；数据固定 + 场景矩阵，便于 smoke 测试逐态断言。

(function () {
    "use strict";

    const DAY = 86400000;
    const BASE = new Date(2026, 10, 11); // 2026-11-11 本地时间 = mock 的「今天」
    const HoverDelayMs = 150;
    const CloseDelayMs = 320;
    const FlashMs = 1200;
    const MarkerMinGap = 16; // 同屏相邻标记最小错开（正常行距 ≥28px 不触发）
    const LoadDelayMs = 900;

    const KINDS = [
        { key: "note", glyph: "✎", label: "Note" },
        { key: "milestone", glyph: "◆", label: "Milestone" },
        { key: "decision", glyph: "⚖", label: "Decision" },
        { key: "question", glyph: "?", label: "Question" },
        // Node：时间线上的关键位置标记，可无正文（不是传统批注内容）
        { key: "node", glyph: "◇", label: "Node" },
    ];
    const KIND_MAP = new Map(KINDS.map((k) => [k.key, k]));

    function at(dayOffset, hh, mm) {
        const d = new Date(BASE.getTime() + dayOffset * DAY);
        d.setHours(hh, mm, 0, 0);
        return d.getTime();
    }

    // 基础会话：5 个桶、39 条消息、10 条批注。newest → oldest。
    const BASE_BUCKETS = [
        {
            key: "b0",
            offset: 0,
            label: "今天",
            date: "11-11",
            messages: [
                { seq: 40, t: at(0, 9, 12), role: "user", text: "会话恢复后 agent 卡片一直显示「未指定」，查下 pi/codex 的模型解析。" },
                { seq: 41, t: at(0, 9, 14), role: "assistant", text: "定位到 provider 的 model 字段有两套：pi 走 model，codex 走 model_provider/model。" },
                {
                    seq: 42,
                    t: at(0, 9, 31),
                    role: "toolgroup",
                    tools: ["read pkg/aisessions/provider_pi.go", "bash go test ./pkg/aisessions -run Model", "edit resolve_model.go"],
                },
                { seq: 43, t: at(0, 9, 44), role: "thinking", text: "先确认 model 字段是否在 restore 路径被丢弃，再决定统一入口放哪一层。" },
                {
                    seq: 44,
                    t: at(0, 10, 2),
                    role: "assistant",
                    text: "三处解析统一走 resolveModelName()，回归测试全绿（12 passed）。",
                    code: 'func resolveModelName(m *ModelMeta) string {\n    if m.Model != "" {\n        return m.Model\n    }\n    return m.Provider + "/" + m.ModelID\n}',
                },
                { seq: 45, t: at(0, 10, 24), role: "subagent", name: "explore", status: "done", text: "扫描其余 provider 的 model 字段用法" },
                { seq: 46, t: at(0, 10, 40), role: "user", text: "行，那就按这个方向继续。" },
            ],
            annotations: [
                { id: 1, seq: 41, kind: "note", title: "模型解析双源", body: "pi/codex 的 model 字段来源不同，需统一 resolveModelName()；注意 codex 的 model_provider 前缀不能丢。", tags: ["provider", "bug"], source: "user", author: "", t: at(0, 9, 20) },
                { id: 2, seq: 44, kind: "milestone", title: "解析修复完成", body: "12 个回归用例全绿；会话恢复后卡片不再显示「未指定」。由 agent 在跑完测试后自动记录。", tags: ["done"], source: "agent", author: "pi", t: at(0, 10, 8) },
                { id: 3, seq: 46, kind: "decision", title: "继续收口状态 chip", body: "下一步做 AgentStatusView 跨面一致性，Done 随 seen 联动。", tags: ["plan"], source: "user", author: "", t: at(0, 10, 42) },
            ],
        },
        {
            key: "b1",
            offset: -1,
            label: "昨天",
            date: "11-10",
            messages: [
                { seq: 30, t: at(-1, 14, 2), role: "user", text: "外部 agent 能不能给自己的会话写批注？" },
                { seq: 31, t: at(-1, 14, 6), role: "assistant", text: "可以走 wsh 控制面：wsh annotation add --session current --anchor seq:31，append-only。" },
                { seq: 32, t: at(-1, 14, 30), role: "tool", tool: "bash", text: "wsh annotation list --session current" },
                { seq: 33, t: at(-1, 15, 1), role: "assistant", text: "幂等键命中时返回原条目，不产生第二条。" },
                { seq: 34, t: at(-1, 15, 20), role: "tool", tool: "edit", text: "pkg/wshrpc/wshrpctypes.go" },
                { seq: 35, t: at(-1, 15, 44), role: "assistant", text: "外部通道只允许 append，改删一律走人审后的 AnnotationSave。" },
                { seq: 36, t: at(-1, 16, 10), role: "assistant", text: "审计：每条写入带 agentName + idempotencyKey，可在 Audit 面板追溯。" },
            ],
            annotations: [
                { id: 4, seq: 31, kind: "question", title: "append-only 够用吗？", body: "agent 想纠正自己写错的批注时怎么办？先按「写错就再写一条修正」，修改能力留给人审。", tags: ["open"], source: "ai", author: "", status: "draft", t: at(-1, 14, 12) },
                { id: 5, seq: 36, kind: "note", title: "审计链路", body: "写入 → agentdata patch → 备份 + 审计，无第二套写路径。", tags: ["acs"], source: "agent", author: "codex", t: at(-1, 16, 15) },
            ],
        },
        {
            key: "b2",
            offset: -5,
            label: "11-06",
            date: "11-06",
            messages: [
                { seq: 22, t: at(-5, 11, 0), role: "user", text: "虚拟行滚动时行高估算总在抖，先按行类型估吧。" },
                { seq: 23, t: at(-5, 11, 30), role: "assistant", text: "按 user / tool / assistant 分别估算，误差从 4x 压到 1.4x 内。" },
                { seq: 24, t: at(-5, 11, 52), role: "toolgroup", tools: ["bash npx vitest run timeline-virtual", "bash node scripts/verify"] },
                { seq: 25, t: at(-5, 12, 6), role: "assistant", text: "测试全绿，滚动锚定不再跳。" },
                { seq: 26, t: at(-5, 12, 30), role: "user", text: "好，先合这一版。" },
            ],
            annotations: [
                { id: 6, seq: 23, kind: "milestone", title: "行高估算落地", body: "按行类型估算 + measureElement 校正，重影问题消失。", tags: ["perf"], source: "user", author: "", t: at(-5, 11, 40) },
                { id: 7, seq: 26, kind: "note", title: "合并范围", body: "只合前端，不碰 pkg。", tags: [], source: "user", author: "", t: at(-5, 12, 32) },
            ],
        },
        {
            key: "b3",
            offset: -8,
            label: "11-03",
            date: "11-03",
            messages: [
                { seq: 16, t: at(-8, 9, 40), role: "user", text: "筛选状态切 tab 就丢，要持久化。" },
                { seq: 17, t: at(-8, 9, 45), role: "assistant", text: "按 tab 分别落 localStorage，恢复时先校验 schema 版本。" },
                { seq: 18, t: at(-8, 10, 10), role: "tool", tool: "edit", text: "frontend/app/view/aisessions/filter-state-persist.ts" },
                { seq: 19, t: at(-8, 10, 30), role: "assistant", text: "默认只持久化「用户显式设置过」的字段。" },
                { seq: 20, t: at(-8, 10, 50), role: "user", text: "可以。" },
            ],
            annotations: [
                { id: 8, seq: 17, kind: "decision", title: "只持久化显式字段", body: "避免把默认值写进 storage 导致后续默认值变更失效。", tags: ["state"], source: "user", author: "", t: at(-8, 10, 2) },
            ],
        },
        {
            key: "b4",
            offset: -11,
            label: "10-31",
            date: "10-31",
            messages: [
                { seq: 8, t: at(-11, 15, 0), role: "user", text: "概览看板的卡片跳转要能定位到具体 agent block。" },
                { seq: 9, t: at(-11, 15, 20), role: "assistant", text: "用 blockId + tabId 组合，先聚焦 tab 再 scrollIntoView。" },
                { seq: 10, t: at(-11, 15, 44), role: "tool", tool: "bash", text: "wsh blocks list --json" },
                { seq: 11, t: at(-11, 16, 2), role: "assistant", text: "跳转后 flash 高亮 1.2s。" },
                { seq: 12, t: at(-11, 16, 30), role: "toolgroup", tools: ["read board-card.tsx", "edit board-card.tsx"] },
                { seq: 13, t: at(-11, 17, 0), role: "assistant", text: "卡片关闭 / 删除动作顺手一起收口。" },
                { seq: 14, t: at(-11, 17, 20), role: "user", text: "先把删除的确认流程想清楚。" },
            ],
            annotations: [
                { id: 9, seq: 9, kind: "note", title: "跳转定位方式", body: "blockId + tabId 组合定位；不能只按进程 PID，重连后 PID 会变。", tags: ["overview"], source: "user", author: "", t: at(-11, 15, 30) },
                { id: 10, seq: 14, kind: "question", title: "彻底删除要不要二次确认", body: "删 block 会连带删内联 tab 组，误删代价高，倾向于二次确认 + 可撤销 toast。", tags: ["ux"], source: "user", author: "", t: at(-11, 17, 22) },
            ],
        },
    ];

    const state = {
        scenario: "normal",
        buckets: null,
        loadedCount: 2,
        theme: "dark",
        filters: new Set(),
        cardSeq: null,
        pinned: false,
        activeSeq: null,
        pendingNew: [],
        extWrites: 0,
        loadingState: "idle", // idle | loading | error
        retried: false,
        editorAnnId: null,
        focusSeq: null,
        hoverSeq: null,
        /** 分页方式：all（全部）| day（按日期）| interval（时间段）| count（数量）
         *  默认由 autoPageMode() 决定：≤500 条 = 全部，超过 = 按日期 */
        pageMode: "all",
        intervalHours: 6,
        countSize: 20,
        /** 非 all 模式下的当前页 id（pageId 见 computePages） */
        lockPageId: null,
        /** 用户是否手动选过分页方式（手动选择后不再被默认规则覆盖） */
        pageModeUserSet: false,
    };

    const $ = (sel) => document.querySelector(sel);
    const el = {
        rail: $("#rail"),
        railBody: $("#railBody"),
        railCount: $("#railCount"),
        filterPop: $("#filterPop"),
        filterList: $("#filterList"),
        railFilterBtn: $("#railFilterBtn"),
        filterClear: $("#filterClear"),
        railDrafts: $("#railDrafts"),
        draftCount: $("#draftCount"),
        newPill: $("#newPill"),
        railTip: $("#railTip"),
        flow: $("#flow"),
        railMore: $("#railMore"),
        fabLatest: $("#fabLatest"),
        jumpMenu: $("#jumpMenu"),
        dateJump: $("#dateJump"),
        extWrite: $("#extWrite"),
        themeToggle: $("#themeToggle"),
        helpBtn: $("#helpBtn"),
        helpPop: $("#helpPop"),
        scenario: $("#scenario"),
        cardLayer: $("#cardLayer"),
        modalLayer: $("#modalLayer"),
        readout: $("#stateReadout"),
        pageModeBtn: $("#pageModeBtn"),
        pageModeLabel: $("#pageModeLabel"),
        pageModePop: $("#pageModePop"),
        pageBar: $("#pageBar"),
        pageInfo: $("#pageInfo"),
        pagePrev: $("#pagePrev"),
        pageNext: $("#pageNext"),
        flowWrap: document.querySelector(".flow-wrap"),
    };

    // ── 数据集与场景 ──

    function cloneBase() {
        return JSON.parse(JSON.stringify(BASE_BUCKETS));
    }

    function datasetFor(scenario) {
        const buckets = cloneBase();
        if (scenario === "empty") {
            for (const b of buckets) b.annotations = [];
            return buckets;
        }
        if (scenario === "drafts") {
            buckets[0].annotations.push(
                { id: 21, seq: 42, kind: "note", title: "工具组里包含 go test", body: "把 bash 与 edit 合成一行，跳转锚点取首条工具。", tags: [], source: "ai", author: "", status: "draft", t: at(0, 9, 35) },
                { id: 22, seq: 45, kind: "note", title: "subagent 扫描结果", body: "explore 子会话返回 3 处 model 用法，与主结论一致。", tags: ["subagent"], source: "ai", author: "", status: "draft", t: at(0, 10, 30) }
            );
            return buckets;
        }
        if (scenario === "orphan") {
            buckets[1].annotations[1].orphaned = true;
            return buckets;
        }
        if (scenario === "dense") {
            const extra = [
                [40, "note", "需求起点", at(0, 9, 13)],
                [41, "decision", "统一入口", at(0, 9, 18)],
                [42, "note", "工具组锚点", at(0, 9, 33)],
                [43, "question", "restore 路径？", at(0, 9, 46)],
                [44, "milestone", "测试全绿", at(0, 10, 4)],
                [45, "note", "子代理结论", at(0, 10, 26)],
                [46, "decision", "继续推进", at(0, 10, 44)],
            ];
            let id = 30;
            for (const [seq, kind, title, t] of extra) {
                buckets[0].annotations.push({ id: id++, seq, kind, title, body: `密集场景示例批注（${kind}）：验证 28px 最小间距松弛。`, tags: ["dense"], source: "user", author: "", t });
            }
            return buckets;
        }
        if (scenario === "external") {
            buckets[0].annotations.push(
                { id: 41, seq: 42, kind: "note", title: "工具组已收口", body: "wsh annotation add --session current --anchor seq:42 --author pi", tags: ["acs"], source: "agent", author: "pi", t: at(0, 9, 33) },
                { id: 42, seq: 45, kind: "milestone", title: "子代理扫描完成", body: "explore 返回 3 处 model 用法；已核对与主结论一致。", tags: ["acs", "subagent"], source: "agent", author: "codex", t: at(0, 10, 27) }
            );
            state.pendingNew = [41, 42];
            return buckets;
        }
        return buckets;
    }

    function setScenario(name) {
        state.scenario = name;
        state.buckets = datasetFor(name);
        state.loadedCount = name === "loading" || name === "error" ? 1 : 2;
        state.filters = new Set();
        state.cardSeq = null;
        state.pinned = false;
        state.activeSeq = null;
        state.focusSeq = null;
        state.pendingNew = name === "external" ? state.pendingNew : [];
        state.loadingState = "idle";
        state.retried = false;
        state.editorAnnId = null;
        state.pageMode = autoPageMode(totalMessagesOfDataset());
        state.pageModeUserSet = false;
        state.lockPageId = null;
        el.pageModeBtn.classList.toggle("is-accent", state.pageMode !== "all");
        el.flowWrap.classList.toggle("paged", state.pageMode !== "all");
        if (state.pageMode !== "all") {
            const pages = computePages();
            state.lockPageId = pages.length > 0 ? pages[pages.length - 1].id : null;
        }
        el.modalLayer.hidden = true;
        el.modalLayer.innerHTML = "";
        el.cardLayer.innerHTML = "";
        closeJumpMenu();
        closeFilterPop();
        el.helpPop.hidden = true;
        if (el.scenario.value !== name) el.scenario.value = name;
        render();
    }

    // ── 派生数据 ──

    function loadedBuckets() {
        return state.buckets.slice(0, state.loadedCount);
    }

    /** 已加载窗口内全部消息（旧 → 新），分页计算的输入。 */
    function loadedMessages() {
        const msgs = loadedBuckets().flatMap((b) => b.messages);
        return msgs.slice().sort((a, b) => a.t - b.t || a.seq - b.seq);
    }

    function dateKeyOf(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function hhmm(ts) {
        return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }

    /**
     * 按当前分页方式把已加载窗口切成页（旧 → 新）。
     *  · day：页 = 本地日历日（对齐 §3.2 桶）；
     *  · interval：页 = 固定小时窗口 floor(ts / win)；
     *  · count：页 = 固定 N 条，**从最新端切块**（尾锚定），prepend 更早内容时当前页成员不变；
     *  · all：单一伪页（整窗口）。
     */
    function computePages() {
        const msgs = loadedMessages();
        if (msgs.length === 0) return [];
        if (state.pageMode === "all") return [{ id: "__all", kind: "all", msgs }];
        const pages = [];
        if (state.pageMode === "turn") {
            // 按用户会话分页：每条 user 消息开启一轮，直到下一条 user 前为止
            let current = null;
            for (const msg of msgs) {
                if (msg.role === "user" || current == null) {
                    current = { id: `t:${msg.seq}`, kind: "turn", msgs: [] };
                    pages.push(current);
                }
                current.msgs.push(msg);
            }
            return pages;
        }
        if (state.pageMode === "day") {
            let current = null;
            for (const msg of msgs) {
                const key = dateKeyOf(msg.t);
                const id = `d:${key}`;
                if (current == null || current.id !== id) {
                    current = { id, kind: "day", dateKey: key, msgs: [] };
                    pages.push(current);
                }
                current.msgs.push(msg);
            }
            return pages;
        }
        if (state.pageMode === "interval") {
            const win = state.intervalHours * 3600000;
            let current = null;
            for (const msg of msgs) {
                const start = Math.floor(msg.t / win) * win;
                const id = `i:${start}`;
                if (current == null || current.id !== id) {
                    current = { id, kind: "interval", start, win, msgs: [] };
                    pages.push(current);
                }
                current.msgs.push(msg);
            }
            return pages;
        }
        // count：从尾部往前切
        for (let end = msgs.length; end > 0; end -= state.countSize) {
            const start = Math.max(0, end - state.countSize);
            pages.unshift({ id: `c:${msgs[start].seq}`, kind: "count", msgs: msgs.slice(start, end) });
        }
        return pages;
    }

    function currentPage(pages = computePages()) {
        if (state.pageMode === "all") return pages[0] ?? null;
        return pages.find((p) => p.id === state.lockPageId) ?? pages[pages.length - 1] ?? null;
    }

    function currentPageIndex(pages = computePages()) {
        if (state.pageMode === "all") return 0;
        const page = currentPage(pages);
        return page == null ? -1 : pages.indexOf(page);
    }

    /** 当前渲染作用域（seq 集合）；all 模式 = 整个已加载窗口。 */
    function scopeSeqs() {
        const page = currentPage();
        const msgs = page != null ? page.msgs : [];
        return new Set(msgs.map((m) => m.seq));
    }

    function annMatchesFilters(ann) {
        return state.filters.size === 0 || state.filters.has(ann.kind);
    }

    function visibleAnnotations(bucket) {
        return bucket.annotations.filter(annMatchesFilters);
    }

    function allVisibleAnnotations() {
        const seqs = scopeSeqs();
        return loadedBuckets().flatMap((b) => visibleAnnotations(b)).filter((ann) => seqs.has(ann.seq));
    }

    function allLoadedAnnotations() {
        const seqs = scopeSeqs();
        return loadedBuckets().flatMap((b) => b.annotations).filter((ann) => seqs.has(ann.seq));
    }

    function tsOfSeq(seq) {
        for (const bucket of loadedBuckets()) {
            const msg = bucket.messages.find((m) => m.seq === seq);
            if (msg != null) return msg.t;
            for (const ann of bucket.annotations) if (ann.seq === seq) return ann.t;
        }
        return undefined;
    }

    function clusters() {
        const map = new Map();
        for (const ann of allVisibleAnnotations()) {
            if (!map.has(ann.seq)) {
                map.set(ann.seq, { seq: ann.seq, ts: tsOfSeq(ann.seq) ?? ann.t, annotations: [] });
            }
            map.get(ann.seq).annotations.push(ann);
        }
        return [...map.values()].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    }

    function bucketGapDays(newerIdx) {
        const newer = state.buckets[newerIdx];
        const older = state.buckets[newerIdx + 1];
        if (newer == null || older == null) return 0;
        return Math.max(0, newer.offset - older.offset - 1);
    }

    function drafts() {
        return allLoadedAnnotations().filter((ann) => ann.status === "draft");
    }

    function kindCounts() {
        const counts = { all: 0, note: 0, milestone: 0, decision: 0, question: 0 };
        for (const ann of allLoadedAnnotations()) {
            counts.all += 1;
            counts[ann.kind] = (counts[ann.kind] ?? 0) + 1;
        }
        return counts;
    }

    // ── rail ──

    /**
     * 时间线标记的定位：**贴到它批注的那条消息行上**（VS Code SCM gutter / GitHub 行内批注模式），
     * 滚动同步。不做时间线性分布、不做分带——标记与内容在空间上一一对应：
     *  · 标记永远落在有内容的地方，不会浮在空轴上；
     *  · 标记数 = 可见行上的批注，天然不溢出、无滚动条、无压缩间距；
     *  · 日期结构由右侧消息流的日分隔头承担（Linear/Slack 的日期分组语言）。
     */
    function syncRailPositions() {
        if (el.rail.classList.contains("collapsed")) return;
        const bodyRect = el.railBody.getBoundingClientRect();
        const bodyH = el.railBody.clientHeight || 0;
        let lastY = -Infinity;
        for (const marker of el.railBody.querySelectorAll(".rail-dot[data-seq]")) {
            const seq = Number(marker.dataset.seq);
            const row = el.flow.querySelector(`#msg-${seq}`);
            if (row == null) {
                marker.hidden = true;
                continue;
            }
            const rect = row.getBoundingClientRect();
            const rowCenter = rect.top + Math.min(14, Math.max(8, rect.height / 2));
            let y = rowCenter - bodyRect.top;
            // 安全阀：两行几乎重叠时最小错开，避免圆点叠圆点（正常行距 ≥28px 不会触发）
            if (y - lastY < MarkerMinGap) y = lastY + MarkerMinGap;
            lastY = y;
            marker.hidden = y < -8 || y > bodyH + 8;
            marker.style.top = `${y.toFixed(1)}px`;
        }
    }

    function renderRailFilters() {
        const counts = kindCounts();
        // 过滤收在弹出层：rail 头只留一个 funnel 按钮，不把 4 个类型图标挤在 52px 里换行
        el.filterList.innerHTML = KINDS.map(
            (kind) =>
                `<button class="fp-row" type="button" data-filter="${kind.key}" aria-pressed="${state.filters.has(kind.key)}">` +
                `<span class="fp-dot kind-${kind.key}" aria-hidden="true"></span>` +
                `<span>${kind.label}</span>` +
                `<span class="fp-count">${counts[kind.key] ?? 0}</span></button>`
        ).join("");
        el.railCount.textContent = String(counts.all);
        el.railFilterBtn.classList.toggle("is-accent", state.filters.size > 0);
    }

    function renderRailDrafts() {
        const list = drafts();
        el.railDrafts.hidden = list.length === 0;
        el.draftCount.textContent = String(list.length);
    }

    function renderRail() {
        // 折叠态：只画一条竖轴（对齐真实组件 §2.4，折叠不保留圆点 DOM）
        if (el.rail.classList.contains("collapsed")) {
            el.railBody.innerHTML = `<div class="rail-axis"></div>`;
            renderRailFilters();
            renderRailDrafts();
            renderNewPill();
            return;
        }
        const list = clusters();
        const parts = [`<div class="rail-axis"></div>`];

        // 空态骨架（design §4.3 loading 态）：轴 + 3 个淡点
        if (state.loadingState === "loading" && list.length === 0) {
            for (let i = 1; i <= 3; i++) {
                parts.push(`<div class="rail-dot" style="top:${24 * i}px"><span class="rail-dot-pip" style="width:8px;height:8px;opacity:.4"></span></div>`);
            }
        }

        list.forEach((cluster, index) => {
            const anns = cluster.annotations;
            const hasAgent = anns.some((ann) => ann.author !== "");
            const hasDraft = anns.some((ann) => ann.status === "draft");
            const hasOrphan = anns.some((ann) => ann.orphaned);
            const isActive = state.activeSeq === cluster.seq;
            // 类型色：该节点最早一条批注的 kind
            const dominantKind = anns.slice().sort((a, b) => a.t - b.t)[0].kind;
            const cls = [
                "rail-dot",
                `kind-${dominantKind}`,
                hasDraft ? "is-draft" : "",
                hasOrphan ? "is-orphan" : "",
                hasAgent ? "has-agent" : "",
                isActive ? "is-active" : "",
            ]
                .filter(Boolean)
                .join(" ");
            const msg = loadedBuckets().flatMap((b) => b.messages).find((m) => m.seq === cluster.seq);
            const time = msg != null ? new Date(msg.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
            const label = `#${cluster.seq} · ${anns.length} 条批注${time !== "" ? ` · ${time}` : ""}`;
            // roving tabindex：只有当前焦点批注可 Tab 到（design §4.4）
            const tabindex = state.focusSeq === cluster.seq || (state.focusSeq == null && index === 0) ? 0 : -1;
            // top 由 syncRailPositions() 按内容行实时写入（滚动同步）
            parts.push(
                `<div class="${cls}" data-seq="${cluster.seq}" style="--pip-ring:3.5px">` +
                    `<button type="button" role="button" tabindex="${tabindex}" aria-label="${label}" title="${label}" aria-current="${isActive ? "true" : "false"}">` +
                    `<span class="rail-dot-pip" style="width:${isActive ? 12 : 8}px;height:${isActive ? 12 : 8}px"></span>` +
                    `</button></div>`
            );
        });

        el.railBody.innerHTML = parts.join("");
        renderRailFilters();
        renderRailDrafts();
        renderNewPill();
        syncRailPositions();
    }

    // ── flow ──

    function esc(text) {
        return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    }

    function kindIcon(kind) {
        const k = KIND_MAP.get(kind) ?? KINDS[0];
        return `<i class="kicon ${kind}" aria-hidden="true">${k.glyph}</i>`;
    }

    function badge(list) {
        const hasAgent = list.some((ann) => ann.author !== "");
        const hasDraft = list.some((ann) => ann.status === "draft");
        const cls = ["ann-badge", hasAgent ? "has-agent" : "", hasDraft ? "has-draft" : ""].filter(Boolean).join(" ");
        return `<span class="${cls}" data-badge-seq="${list[0].seq}">🏷 ${list.length}</span>`;
    }

    function renderMessage(bucket, msg) {
        const anns = visibleAnnotations(bucket).filter((ann) => ann.seq === msg.seq);
        const badgeHtml = anns.length > 0 ? badge(anns) : "";
        const time = new Date(msg.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        const hasNode = bucket.annotations.some((ann) => ann.seq === msg.seq && ann.kind === "node");
        // hover 出「标记节点」快捷钮（已标记则高亮）：Node 是时间线关键位置点，不要求写正文
        const nodeAdd = `<button class="node-add${hasNode ? " is-on" : ""}" type="button" data-node-seq="${msg.seq}" title="${hasNode ? "已标记节点，点击查看" : "标记 Node 节点"}" aria-label="在 #${msg.seq} 标记 Node 节点">◇</button>`;

        if (msg.role === "tool") {
            return `<div class="msg is-tool" data-seq="${msg.seq}" id="msg-${msg.seq}">${nodeAdd}<span class="tool-status"></span><span class="tool-name">${esc(msg.tool)}</span><span>${esc(msg.text)}</span>${badgeHtml}</div>`;
        }
        if (msg.role === "toolgroup") {
            const tools = msg.tools ?? [];
            return (
                `<div class="msg is-toolgroup" data-seq="${msg.seq}" id="msg-${msg.seq}">` +
                `<span class="tg-chevron" aria-hidden="true">▸</span>` +
                `<span class="tg-label">执行工具 ×${tools.length}</span>` +
                `<span class="tg-tools">${esc(tools.join(" · "))}</span>` +
                nodeAdd +
                badgeHtml +
                `</div>`
            );
        }
        if (msg.role === "thinking") {
            return `<div class="msg is-thinking" data-seq="${msg.seq}" id="msg-${msg.seq}">${nodeAdd}<span aria-hidden="true">◌</span><span>${esc(msg.text)}</span>${badgeHtml}</div>`;
        }
        if (msg.role === "subagent") {
            return (
                `<div class="msg is-subagent" data-seq="${msg.seq}" id="msg-${msg.seq}">` +
                `<span class="sa-icon" aria-hidden="true">⌘</span>` +
                `<span class="sa-name">subagent · ${esc(msg.name ?? "")}</span>` +
                `<span>${esc(msg.text ?? "")}</span>` +
                `<span class="sa-status">${msg.status === "done" ? "✓ done" : "running"}</span>` +
                nodeAdd +
                badgeHtml +
                `</div>`
            );
        }
        const roleLabel = msg.role === "user" ? "You" : "Agent";
        const code = msg.code != null ? `<pre class="code-block">${esc(msg.code)}</pre>` : "";
        return (
            `<div class="msg is-${msg.role}" data-seq="${msg.seq}" id="msg-${msg.seq}">` +
            `<div class="msg-meta"><span class="msg-role">${roleLabel}</span><span>#${msg.seq}</span><span>${time}</span></div>` +
            `<div class="msg-text">${esc(msg.text)}</div>` +
            code +
            nodeAdd +
            badgeHtml +
            `</div>`
        );
    }

    /**
     * 「加载更早」端帽：渲染在 rail 轴顶端，不再占用主界面一行。
     * 状态：↑N（还有 N 桶） / …（加载中） / !（失败，点击重试）；到最早后隐藏。
     */
    function renderRailMore() {
        const remaining = state.buckets.length - state.loadedCount;
        const cap = el.railMore;
        cap.classList.remove("is-loading", "is-error");
        // 分页模式：翻页条自带加载语义（翻到最旧页自动补数据），端帽只在连续模式出现
        if (state.pageMode !== "all") {
            cap.hidden = true;
            cap.textContent = "";
            cap.title = "";
            return;
        }
        if (state.loadingState === "loading") {
            cap.hidden = false;
            cap.classList.add("is-loading");
            cap.textContent = "…";
            cap.title = "正在加载更早的批注";
            cap.setAttribute("aria-label", "正在加载更早的批注");
            return;
        }
        if (state.loadingState === "error") {
            cap.hidden = false;
            cap.classList.add("is-error");
            cap.textContent = "!";
            cap.title = "加载更早失败（网络错误）· 点击重试";
            cap.setAttribute("aria-label", "加载更早失败，点击重试");
            return;
        }
        if (remaining > 0) {
            cap.hidden = false;
            cap.textContent = `↑${remaining}`;
            cap.title = `加载更早 · 还有 ${remaining} 个时间桶`;
            cap.setAttribute("aria-label", `加载更早，还有 ${remaining} 个时间桶`);
            return;
        }
        cap.hidden = true;
        cap.textContent = "";
        cap.title = "";
    }

    /** 单页渲染（day / interval / count 三种页共用）。 */
    function renderPageSection(page, pages) {
        const idx = pages.indexOf(page);
        const seqs = new Set(page.msgs.map((m) => m.seq));
        const anns = loadedBuckets()
            .flatMap((b) => visibleAnnotations(b))
            .filter((ann) => seqs.has(ann.seq));
        const dens = anns.map((ann) => `<i class="${esc(ann.kind)}" title="${esc(ann.kind)} · ${esc(ann.title)}"></i>`).join("");
        const first = page.msgs[0];
        const last = page.msgs[page.msgs.length - 1];
        let chip = "";
        let dateLabel = "";
        let isRelative = false;
        if (page.kind === "day") {
            const bucket = state.buckets.find((b) => b.messages.some((m) => m.seq === first.seq));
            chip = bucket != null ? bucket.label : dateKeyOf(first.t);
            dateLabel = bucket != null ? bucket.date : "";
            isRelative = chip === "今天" || chip === "昨天";
        } else if (page.kind === "turn") {
            chip = `第 ${idx + 1} 轮`;
            dateLabel = `${new Date(first.t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${hhmm(first.t)}`;
        } else if (page.kind === "interval") {
            chip = `${hhmm(page.start)}–${hhmm(page.start + page.win)}`;
            dateLabel = new Date(first.t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
            if (dateKeyOf(first.t) !== dateKeyOf(page.start + page.win - 1)) chip += " · 跨天";
        } else {
            chip = `第 ${idx + 1} / ${pages.length} 页`;
            dateLabel = `${hhmm(first.t)}–${hhmm(last.t)}`;
        }
        const bucketOf = (seq) => state.buckets.find((b) => b.messages.some((m) => m.seq === seq));
        const parts = [
            `<div class="bucket" data-key="${page.id}" data-page="${page.id}">` +
                `<div class="bucket-head" aria-hidden="true">` +
                `<span class="bucket-chip${isRelative ? " rel" : ""}">${esc(chip)}</span>` +
                `<span class="bucket-date">${esc(dateLabel)}</span>` +
                `<span class="bucket-count">${page.msgs.length} 条消息 · ${anns.length} 条批注</span>` +
                `<span class="dens">${dens}</span>` +
                `</div>`
        ];
        for (const msg of page.msgs) {
            const bucket = bucketOf(msg.seq);
            if (bucket != null) parts.push(renderMessage(bucket, msg));
        }
        parts.push(`</div>`);
        return parts.join("");
    }

    function renderFlow() {
        const parts = [];
        if (state.pageMode === "all") {
            const loaded = loadedBuckets();
            for (let i = loaded.length - 1; i >= 0; i--) {
                const bucket = loaded[i];
                if (i + 1 < loaded.length) {
                    const gap = bucketGapDays(i);
                    if (gap > 0) parts.push(`<div class="gap-row" data-gap="${gap}"><span class="gap-glyph" aria-hidden="true">↕</span><span>跳过 ${gap} 天</span></div>`);
                }
                const anns = visibleAnnotations(bucket);
                const dens = anns.map((ann) => `<i class="${esc(ann.kind)}" title="${esc(ann.kind)} · ${esc(ann.title)}"></i>`).join("");
                const isRelative = bucket.label === "今天" || bucket.label === "昨天";
                parts.push(
                    `<div class="bucket" data-key="${bucket.key}" data-offset="${bucket.offset}">` +
                        `<div class="bucket-head" aria-hidden="true">` +
                        `<span class="bucket-chip${isRelative ? " rel" : ""}">${esc(bucket.label)}</span>` +
                        `<span class="bucket-date">${esc(bucket.date)}</span>` +
                        `<span class="bucket-count">${anns.length} 条批注</span>` +
                        `<span class="dens">${dens}</span>` +
                        `</div>`
                );
                for (const msg of bucket.messages) parts.push(renderMessage(bucket, msg));
                parts.push(`</div>`);
            }
        } else {
            const pages = computePages();
            const page = currentPage(pages);
            if (page != null) {
                parts.push(renderPageSection(page, pages));
            }
        }
        if (clusters().length === 0) {
            if (state.filters.size > 0) {
                parts.push(`<div class="empty-hint">当前筛选没有匹配的批注。清除类型过滤后重试。</div>`);
            } else if (state.pageMode !== "all" && computePages().length === 0) {
                parts.push(`<div class="empty-hint">这一页没有内容了。</div>`);
            } else {
                parts.push(`<div class="empty-hint">还没有批注。点左侧 ✨ 让 AI 生成时间线，或在消息悬停时点 🏷 手动添加。</div>`);
            }
        }
        el.flow.innerHTML = parts.join("");
        el.fabLatest.hidden = true;
    }

    function renderReadout() {
        const total = allLoadedAnnotations().length;
        const visible = allVisibleAnnotations().length;
        const suffix = total !== visible ? `（筛选后 ${visible}）` : "";
        if (state.pageMode !== "all") {
            const pages = computePages();
            const idx = currentPageIndex(pages);
            const page = currentPage(pages);
            const label = pageShortLabel(page, idx, pages);
            el.readout.textContent = `分页 ${idx + 1}/${pages.length} · ${label} · ${total} 条批注${suffix}`;
            return;
        }
        el.readout.textContent = `窗口 ${state.loadedCount}/${state.buckets.length} 桶 · ${total} 条批注${suffix}`;
    }

    /** 页短标签（翻页条与读数共用） */
    function pageShortLabel(page, idx, pages) {
        if (page == null) return "";
        if (page.kind === "turn") {
            const date = new Date(page.msgs[0].t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
            return `第 ${idx + 1} 轮 · ${date} ${hhmm(page.msgs[0].t)}`;
        }
        if (page.kind === "day") {
            const bucket = state.buckets.find((b) => b.messages.some((m) => m.seq === page.msgs[0].seq));
            return bucket != null ? `${bucket.label} · ${bucket.date}` : dateKeyOf(page.msgs[0].t);
        }
        if (page.kind === "interval") {
            const date = new Date(page.msgs[0].t).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
            return `${date} · ${hhmm(page.start)}–${hhmm(page.start + page.win)}`;
        }
        return `第 ${idx + 1} 页 · ${page.msgs.length} 条`;
    }

    /** 分页翻页条（非 all 模式显示；浮动居中，不推挤内容行） */
    /** 详情头视图 chip 的短标签（全部 / 按日 / 6h / 20 条） */
    function renderPageModeLabel() {
        const map = {
            all: "全部",
            day: "按日",
            turn: "轮次",
            interval: state.intervalHours >= 24 ? `${state.intervalHours / 24}d` : `${state.intervalHours}h`,
            count: `${state.countSize} 条`,
        };
        el.pageModeLabel.textContent = map[state.pageMode] ?? state.pageMode;
    }

    function renderPageBar() {
        if (state.pageMode === "all") {
            el.pageBar.hidden = true;
            return;
        }
        const pages = computePages();
        const idx = currentPageIndex(pages);
        if (idx < 0) {
            el.pageBar.hidden = true;
            return;
        }
        const page = pages[idx];
        const label = pageShortLabel(page, idx, pages);
        const annCount = page.msgs.length > 0 ? allVisibleAnnotations().length : 0;
        el.pageBar.hidden = false;
        el.pageInfo.textContent = `${label} · ${idx + 1}/${pages.length} · ${page.msgs.length} 条消息`;
        // prev（更早）disabled：已是最旧页且没有更多数据；next（更新）disabled：已是最新页
        el.pagePrev.disabled = idx === 0 && state.loadedCount >= state.buckets.length;
        el.pageNext.disabled = idx === pages.length - 1;
    }

    function renderNewPill() {
        if (state.pendingNew.length === 0) {
            el.newPill.hidden = true;
            el.newPill.textContent = "";
            return;
        }
        el.newPill.hidden = false;
        el.newPill.textContent = `${state.pendingNew.length} 条新批注 ↓`;
    }

    function render() {
        renderFlow();
        renderRail();
        renderRailMore();
        renderReadout();
        renderPageBar();
        renderPageModeLabel();
        if (state.cardSeq != null) openCard(state.cardSeq);
        if (state.editorAnnId != null) renderEditor();
    }

    // ── 分页（四种方式：全部 / 按日 / 时间段 / 数量） ──

    /** 默认规则：小数据量显示全部，长会话默认按日期（用户手动选过则不再覆盖）。 */
    const AutoAllMaxMessages = 500;
    function autoPageMode(totalMessages) {
        return totalMessages <= AutoAllMaxMessages ? "all" : "day";
    }

    function totalMessagesOfDataset() {
        return state.buckets.reduce((sum, b) => sum + b.messages.length, 0);
    }

    /** 选中分页方式（非 all 时自动落到最新页）。 */
    function setPageMode(mode, opts = {}) {
        if (opts.intervalHours != null) state.intervalHours = opts.intervalHours;
        if (opts.countSize != null) state.countSize = opts.countSize;
        if (opts.user === true) state.pageModeUserSet = true;
        state.pageMode = mode;
        state.pinned = false;
        state.cardSeq = null;
        el.cardLayer.innerHTML = "";
        if (mode === "all") {
            state.lockPageId = null;
        } else {
            const pages = computePages();
            state.lockPageId = pages.length > 0 ? pages[pages.length - 1].id : null;
        }
        el.pageModeBtn.setAttribute("aria-expanded", "false");
        el.pageModePop.hidden = true;
        el.pageModeBtn.classList.toggle("is-accent", mode !== "all");
        el.flowWrap.classList.toggle("paged", mode !== "all");
        render();
        el.flow.scrollTop = 0;
    }

    /** 跳到指定页（未知 id 时不动）。 */
    function setPage(pageId) {
        if (state.pageMode === "all") return;
        const pages = computePages();
        if (!pages.some((p) => p.id === pageId)) return;
        state.lockPageId = pageId;
        state.pinned = false;
        state.cardSeq = null;
        el.cardLayer.innerHTML = "";
        render();
        el.flow.scrollTop = 0;
    }

    /**
     * 翻页：delta=-1 更早，+1 更新。
     * 在最旧页再往前翻时先补一页数据（沿用游标），仍停留在当前页，由用户再按一次。
     */
    function switchPage(delta) {
        if (state.pageMode === "all") return;
        const pages = computePages();
        const idx = currentPageIndex(pages);
        if (idx < 0) return;
        const target = idx + delta;
        if (target < 0) {
            if (state.loadedCount < state.buckets.length) {
                state.loadedCount += 1;
                render();
            }
            return;
        }
        if (target >= pages.length) return;
        setPage(pages[target].id);
    }

    function togglePageModePop(anchor) {
        const anchorEl = anchor ?? el.pageModeBtn;
        const open = el.pageModePop.hidden;
        el.pageModePop.hidden = !open;
        el.pageModeBtn.setAttribute("aria-expanded", String(open));
        if (!open) return;
        const rect = anchorEl.getBoundingClientRect();
        const width = 236;
        el.pageModePop.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
        el.pageModePop.style.top = `${rect.bottom + 6}px`;
        syncPageModePop();
    }

    function syncPageModePop() {
        el.pageModePop.querySelectorAll("[data-pm]").forEach((row) => {
            row.setAttribute("aria-checked", String(row.dataset.pm === state.pageMode));
        });
        el.pageModePop.querySelectorAll("[data-pm-interval]").forEach((chip) => {
            chip.setAttribute("aria-pressed", String(state.pageMode === "interval" && Number(chip.dataset.pmInterval) === state.intervalHours));
        });
        el.pageModePop.querySelectorAll("[data-pm-count]").forEach((chip) => {
            chip.setAttribute("aria-pressed", String(state.pageMode === "count" && Number(chip.dataset.pmCount) === state.countSize));
        });
    }

    // ── 悬浮卡 ──

    function annById(id) {
        for (const bucket of loadedBuckets()) {
            const ann = bucket.annotations.find((a) => a.id === id);
            if (ann != null) return { ann, bucket };
        }
        return null;
    }

    function srcBadge(ann) {
        if (ann.author !== "") {
            const time = new Date(ann.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
            return `<span class="src-badge agent" title="via wsh annotation add · ${time}">🤖 ${esc(ann.author)} · ${time}</span>`;
        }
        if (ann.source === "ai") {
            return `<span class="src-badge ai" title="AI 生成">✨ AI${ann.status === "draft" ? " · 草稿" : ""}</span>`;
        }
        return `<span class="src-badge you">You</span>`;
    }

    function closeCard() {
        state.cardSeq = null;
        state.pinned = false;
        el.cardLayer.innerHTML = "";
    }

    function cardMessage(seq) {
        return loadedBuckets().flatMap((b) => b.messages).find((m) => m.seq === seq);
    }

    function openCard(seq) {
        const list = clusters();
        const idx = list.findIndex((c) => c.seq === seq);
        if (idx < 0) return;
        const cluster = list[idx];
        state.cardSeq = seq;
        const msg = cardMessage(seq);
        const time = msg != null ? new Date(msg.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
        const preview =
            msg != null
                ? msg.role === "tool"
                    ? `${msg.tool} ${msg.text}`
                    : msg.role === "toolgroup"
                      ? (msg.tools ?? []).join(" · ")
                      : (msg.text ?? "")
                : "";
        const orphans = cluster.annotations.filter((ann) => ann.orphaned);
        const anns = cluster.annotations
            .slice()
            .sort((a, b) => a.t - b.t)
            .map((ann) => {
                const editable = ann.author === "";
                return (
                    `<div class="ann${ann.status === "draft" ? " ann-draft" : ""}" data-ann-id="${ann.id}">` +
                    `<div class="ann-title">${kindIcon(ann.kind)}<span>${esc(ann.title || (ann.kind === "node" ? "节点" : ""))}</span>${srcBadge(ann)}</div>` +
                    (ann.body !== "" || ann.kind !== "node" ? `<div class="ann-body">${esc(ann.body)}</div>` : "") +
                    (ann.tags.length > 0 ? `<div class="ann-tags">${ann.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : "") +
                    `<div class="ann-actions">` +
                    `<button class="acard-btn" type="button" data-edit="${ann.id}"${editable ? "" : ` disabled title="外部 agent 写入，只读"`}>Edit</button>` +
                    (ann.status === "draft"
                        ? `<button class="acard-btn" type="button" data-accept="${ann.id}">采纳</button><button class="acard-btn muted" type="button" data-discard="${ann.id}">丢弃</button>`
                        : "") +
                    `</div></div>`
                );
            })
            .join("");
        el.cardLayer.innerHTML =
            `<div class="acard" role="dialog" aria-modal="false" aria-label="节点 #${seq} 的批注" data-card-seq="${seq}">` +
            `<div class="acard-head">` +
            `<span class="node-id">${kindIcon(cluster.annotations[0].kind)}#${seq} · ${time}</span>` +
            `<span class="acard-actions">` +
            `<button class="acard-btn" type="button" data-card-jump="${seq}">Jump</button>` +
            (state.pinned ? `<button class="acard-btn muted" type="button" data-card-close="1" aria-label="关闭">✕</button>` : "") +
            `</span></div>` +
            (orphans.length > 0
                ? `<div class="orphan-banner" role="alert"><span aria-hidden="true">⚠</span><span>锚点已漂移（原文不匹配）</span>` +
                  `<button type="button" data-orphan-reanchor="${orphans[0].id}">重新指定</button>` +
                  `<button type="button" data-orphan-delete="${orphans[0].id}">删除</button></div>`
                : "") +
            (preview !== "" ? `<div class="node-orig">${esc(preview)}</div>` : "") +
            `<div class="ann-list">${anns}</div>` +
            `<div class="card-nav">` +
            `<button type="button" data-card-prev="1"${idx === 0 ? " disabled" : ""}>‹ 上一条</button>` +
            `<button type="button" data-card-next="1"${idx === list.length - 1 ? " disabled" : ""}>下一条 ›</button>` +
            `<span class="cn-pos">${idx + 1} / ${list.length}</span>` +
            `</div></div>`;
        positionCard();
    }

    function positionCard() {
        const card = el.cardLayer.querySelector(".acard");
        if (card == null) return;
        const stage = document.querySelector(".stage").getBoundingClientRect();
        const dot = el.railBody.querySelector(`.rail-dot[data-seq="${state.cardSeq}"] .rail-dot-pip`);
        const dotRect = dot != null ? dot.getBoundingClientRect() : null;
        const railRect = el.rail.getBoundingClientRect();
        const cardH = Math.min(card.offsetHeight || 320, window.innerHeight * 0.62);
        const top0 = dotRect != null ? dotRect.top + dotRect.height / 2 - 22 : stage.top + 8;
        const maxTop = Math.max(stage.top + 8, window.innerHeight - cardH - 12);
        card.style.left = `${railRect.right + 8}px`;
        card.style.top = `${Math.max(stage.top + 8, Math.min(top0, maxTop))}px`;
    }

    function cardStep(delta) {
        const list = clusters();
        const idx = list.findIndex((c) => c.seq === state.cardSeq);
        const next = list[idx + delta];
        if (next == null) return;
        state.activeSeq = next.seq;
        state.focusSeq = next.seq;
        openCard(next.seq);
        renderRail();
    }

    // ── 编辑器 ──

    function openEditor(annId) {
        const hit = annById(annId);
        if (hit == null) return;
        state.editorAnnId = annId;
        renderEditor();
        const input = el.modalLayer.querySelector("#edTitle");
        if (input != null) input.focus();
    }

    function closeEditor() {
        state.editorAnnId = null;
        el.modalLayer.hidden = true;
        el.modalLayer.innerHTML = "";
    }

    function renderEditor() {
        const hit = annById(state.editorAnnId);
        if (hit == null) return;
        const { ann, bucket } = hit;
        const readOnly = ann.author !== "";
        const msg = bucket.messages.find((m) => m.seq === ann.seq);
        const time = msg != null ? new Date(msg.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
        const chips = KINDS.map(
            (k) =>
                `<button class="kind-chip" type="button" data-kind="${k.key}" aria-pressed="${ann.kind === k.key}"${readOnly ? " disabled" : ""}>` +
                `<i class="kicon ${k.key}" aria-hidden="true">${k.glyph}</i>${k.label}</button>`
        ).join("");
        el.modalLayer.hidden = false;
        el.modalLayer.innerHTML =
            `<div class="editor" role="dialog" aria-modal="true" aria-label="编辑批注">` +
            `<div class="editor-head"><div><div class="editor-title">${ann.status === "draft" ? "草稿批注" : "编辑批注"}</div>` +
            `<div class="editor-sub">#${ann.seq} · ${time} · ${ann.status === "draft" ? "未采纳" : "已生效"}</div></div>` +
            `<button class="icon-btn" type="button" data-editor-close="1" aria-label="关闭">✕</button></div>` +
            (readOnly
                ? `<div class="editor-readonly" role="note">🤖 由 ${esc(ann.author)} 通过 wsh annotation add 写入：外部通道 append-only，只能新增不能修改。如需修正，请再写一条。</div>`
                : "") +
            `<div class="editor-row"><span class="editor-label">类型</span><div class="kind-chips">${chips}</div></div>` +
            `<div class="editor-row"><label class="editor-label" for="edTitle">标题</label>` +
            `<input id="edTitle" value="${esc(ann.title)}"${readOnly ? " readonly" : ""} /></div>` +
            `<div class="editor-row"><label class="editor-label" for="edBody">正文</label>` +
            `<textarea id="edBody"${readOnly ? " readonly" : ""}>${esc(ann.body)}</textarea></div>` +
            `<div class="editor-row"><label class="editor-label" for="edTags">标签（逗号分隔）</label>` +
            `<input id="edTags" value="${esc(ann.tags.join(", "))}"${readOnly ? " readonly" : ""} /></div>` +
            `<div class="editor-foot">` +
            (readOnly ? "" : `<button class="btn danger" type="button" data-editor-delete="1">删除</button>`) +
            `<button class="btn ghost" type="button" data-editor-ai="1"${readOnly ? " disabled" : ""}>✨ AI 补全</button>` +
            `<span class="spacer"></span>` +
            `<button class="btn" type="button" data-editor-cancel="1">取消</button>` +
            `<button class="btn primary" type="button" data-editor-save="1"${readOnly ? " disabled" : ""}>保存</button>` +
            `</div></div>`;
    }

    function saveEditor() {
        const hit = annById(state.editorAnnId);
        if (hit == null) return;
        const { ann } = hit;
        if (ann.author !== "") return;
        const title = el.modalLayer.querySelector("#edTitle");
        const body = el.modalLayer.querySelector("#edBody");
        const tags = el.modalLayer.querySelector("#edTags");
        const selected = el.modalLayer.querySelector('.kind-chip[aria-pressed="true"]');
        if (title != null) ann.title = title.value.trim();
        if (body != null) ann.body = body.value;
        if (tags != null) ann.tags = tags.value.split(",").map((t) => t.trim()).filter(Boolean);
        if (selected != null) ann.kind = selected.dataset.kind;
        ann.userEdited = true;
        if (ann.status === "draft") ann.status = "accepted";
        closeEditor();
        render();
    }

    function deleteAnnotation(id) {
        for (const bucket of state.buckets) {
            const idx = bucket.annotations.findIndex((a) => a.id === id);
            if (idx >= 0) {
                bucket.annotations.splice(idx, 1);
                break;
            }
        }
        state.pendingNew = state.pendingNew.filter((x) => x !== id);
        closeEditor();
        closeCard();
        render();
    }

    // ── 滚动 ──

    function updateFab() {
        el.fabLatest.hidden = el.flow.scrollTop >= el.flow.scrollHeight - el.flow.clientHeight - 300;
    }

    let scrollRaf = 0;
    // 消息 hover 的「◇ 标记节点」快捷钮
    el.flow.addEventListener("click", (event) => {
        const btn = event.target.closest(".node-add");
        if (btn == null) return;
        event.stopPropagation();
        createNode(Number(btn.dataset.nodeSeq));
    });

    el.flow.addEventListener("scroll", () => {
        if (scrollRaf !== 0) return;
        scrollRaf = window.requestAnimationFrame(() => {
            scrollRaf = 0;
            syncRailPositions();
            updateFab();
        });
    });

    // ── 动作 ──

    function prefersReducedMotion() {
        return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function jump(seq) {
        // 分页模式下目标不在当前页 → 先切到包含它的页（卡片与 rail 一并重算）
        if (state.pageMode !== "all") {
            const pages = computePages();
            const page = pages.find((p) => p.msgs.some((m) => m.seq === seq));
            if (page != null && page.id !== state.lockPageId) {
                state.lockPageId = page.id;
                state.pinned = false;
                state.cardSeq = null;
                el.cardLayer.innerHTML = "";
            }
        }
        let node = el.flow.querySelector(`#msg-${seq}`);
        if (node == null) {
            const idx = state.buckets.findIndex((b) => b.messages.some((m) => m.seq === seq));
            if (idx < 0) return;
            state.loadedCount = Math.max(state.loadedCount, idx + 1);
            render();
            node = el.flow.querySelector(`#msg-${seq}`);
        }
        if (node == null) return;
        state.activeSeq = seq;
        node.classList.remove("flash");
        void node.offsetWidth;
        node.classList.add("flash");
        window.setTimeout(() => node.classList.remove("flash"), FlashMs);
        if (typeof node.scrollIntoView === "function") {
            node.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }
        renderRail();
        if (state.cardSeq != null) openCard(state.cardSeq);
    }

    function applyOlder() {
        const prevHeight = el.flow.scrollHeight;
        const prevTop = el.flow.scrollTop;
        state.loadedCount += 1;
        render();
        // 前插补偿：视口内容不动（design §3.8）
        el.flow.scrollTop = prevTop + (el.flow.scrollHeight - prevHeight);
        syncRailPositions();
    }

    function requestOlder() {
        if (state.loadedCount >= state.buckets.length) return;
        if (state.scenario === "loading") {
            state.loadingState = "loading";
            renderRailMore();
            window.setTimeout(() => {
                state.loadingState = "idle";
                applyOlder();
            }, LoadDelayMs);
            return;
        }
        if (state.scenario === "error" && !state.retried) {
            state.loadingState = "error";
            renderRailMore();
            return;
        }
        applyOlder();
    }

    function retryOlder() {
        state.retried = true;
        state.loadingState = "loading";
        renderRailMore();
        window.setTimeout(() => {
            state.loadingState = "idle";
            applyOlder();
        }, 400);
    }

    function nextAnnId() {
        let max = 0;
        for (const bucket of state.buckets) {
            for (const ann of bucket.annotations) if (ann.id > max) max = ann.id;
        }
        return max + 1;
    }

    /**
     * 在消息上标记 Node 节点：时间线上的关键位置点，不要求写正文。
     * 已有节点则跳转查看（幂等），新节点直接落 accepted。
     */
    function createNode(seq) {
        const bucket = state.buckets.find((b) => b.messages.some((m) => m.seq === seq));
        if (bucket == null) return;
        let ann = bucket.annotations.find((a) => a.seq === seq && a.kind === "node");
        if (ann == null) {
            ann = { id: nextAnnId(), seq, kind: "node", title: "", body: "", tags: [], source: "user", author: "", t: Date.now() };
            bucket.annotations.push(ann);
        }
        state.pinned = true;
        state.activeSeq = seq;
        state.cardSeq = seq;
        render();
        jump(seq);
    }

    function goLatest() {
        if (state.pageMode !== "all") {
            const pages = computePages();
            if (pages.length > 0) setPage(pages[pages.length - 1].id);
            return;
        }
        if (typeof el.flow.scrollTo === "function") {
            el.flow.scrollTo({ top: el.flow.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        } else {
            el.flow.scrollTop = el.flow.scrollHeight;
        }
    }

    const EXT_TARGETS = [45, 42, 43, 40, 46];
    function simulateExternalWrite() {
        const bucket = state.buckets[0];
        state.extWrites += 1;
        const targetSeq =
            EXT_TARGETS.find((seq) => !bucket.annotations.some((ann) => ann.seq === seq)) ??
            EXT_TARGETS[state.extWrites % EXT_TARGETS.length];
        const ann = {
            id: 200 + state.extWrites,
            seq: targetSeq,
            kind: "note",
            title: `外部写入 #${state.extWrites} · 待审`,
            body: `wsh annotation add --session current --anchor seq:${targetSeq} --kind note --author pi（append-only，幂等键已写入）`,
            tags: ["acs", "agent"],
            source: "agent",
            author: "pi",
            t: Date.now(),
        };
        bucket.annotations.push(ann);
        state.pendingNew.push(ann.id);
        render();
    }

    function consumePendingNew() {
        if (state.pendingNew.length === 0) return;
        const id = state.pendingNew[0];
        const hit = annById(id);
        state.pendingNew = [];
        renderNewPill();
        if (hit != null) {
            const idx = state.buckets.findIndex((b) => b.messages.some((m) => m.seq === hit.ann.seq));
            if (idx >= 0) state.loadedCount = Math.max(state.loadedCount, idx + 1);
            jump(hit.ann.seq);
        }
    }

    function acceptAllDrafts() {
        for (const ann of allLoadedAnnotations()) {
            if (ann.status === "draft") {
                ann.status = "accepted";
                ann.source = "user";
            }
        }
        render();
    }

    function discardAllDrafts() {
        for (const bucket of state.buckets) bucket.annotations = bucket.annotations.filter((ann) => ann.status !== "draft");
        render();
    }

    // ── 日期跳转 / help ──

    function buildJumpMenu() {
        el.jumpMenu.innerHTML = state.buckets
            .map(
                (bucket, idx) =>
                    `<button class="jump-item" type="button" data-jump-index="${idx}">` +
                    `<span class="ji-label">${esc(bucket.label)}</span>` +
                    `<span class="ji-date">${esc(bucket.date)}</span>` +
                    (idx < state.loadedCount ? `<span class="ji-tag">已加载</span>` : "") +
                    `<span class="ji-count">${bucket.annotations.length} 条</span></button>`
            )
            .join("");
    }

    function openJumpMenu() {
        buildJumpMenu();
        el.jumpMenu.hidden = false;
        el.dateJump.setAttribute("aria-expanded", "true");
        const rect = el.dateJump.getBoundingClientRect();
        const width = 220;
        el.jumpMenu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
        el.jumpMenu.style.top = `${rect.bottom + 6}px`;
    }

    function closeJumpMenu() {
        el.jumpMenu.hidden = true;
        el.dateJump.setAttribute("aria-expanded", "false");
    }

    function toggleFilterPop() {
        el.filterPop.hidden = !el.filterPop.hidden;
        el.railFilterBtn.setAttribute("aria-expanded", String(!el.filterPop.hidden));
    }

    function closeFilterPop() {
        el.filterPop.hidden = true;
        el.railFilterBtn.setAttribute("aria-expanded", "false");
    }

    function toggleHelp() {
        el.helpPop.hidden = !el.helpPop.hidden;
        el.helpBtn.setAttribute("aria-expanded", String(!el.helpPop.hidden));
        if (!el.helpPop.hidden) {
            const rect = el.helpBtn.getBoundingClientRect();
            el.helpPop.style.left = `${Math.max(8, Math.min(window.innerWidth - 258, rect.right - 250))}px`;
            el.helpPop.style.top = `${rect.bottom + 6}px`;
        }
    }

    // ── 轴 scrub：悬停显示时间，点击跳最近批注 ──

    /** 轴上最近标记（按屏幕 y 距离）——标记已对齐内容行，所以这就是“点哪去哪”。 */
    function nearestClusterAtClientY(clientY) {
        const list = clusters();
        if (list.length === 0) return null;
        const bodyRect = el.railBody.getBoundingClientRect();
        const y = clientY - bodyRect.top;
        let best = null;
        let bestDist = Infinity;
        for (const question of el.railBody.querySelectorAll(".rail-dot[data-seq]")) {
            const markerY = parseFloat(question.style.top || "0") || 0;
            const dist = Math.abs(markerY - y);
            if (dist < bestDist) {
                bestDist = dist;
                best = Number(question.dataset.seq);
            }
        }
        const cluster = list.find((c) => c.seq === best);
        return cluster ?? list[0];
    }

    el.railBody.addEventListener("mousemove", (event) => {
        if (el.rail.classList.contains("collapsed")) return;
        if (event.target.closest(".rail-dot") != null) {
            el.railTip.hidden = true;
            return;
        }
        const cluster = nearestClusterAtClientY(event.clientY);
        if (cluster == null) {
            el.railTip.hidden = true;
            return;
        }
        const msg = cardMessage(cluster.seq);
        const time = msg != null ? new Date(msg.t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
        el.railTip.hidden = false;
        el.railTip.textContent = `#${cluster.seq} · ${time}`;
        el.railTip.style.top = `${event.clientY - el.rail.getBoundingClientRect().top}px`;
    });
    el.railBody.addEventListener("mouseleave", () => {
        el.railTip.hidden = true;
    });

    // ── 事件绑定 ──

    el.railBody.addEventListener("mouseover", (event) => {
        if (el.rail.classList.contains("collapsed")) return;
        const dot = event.target.closest(".rail-dot");
        if (dot == null) return;
        const seq = Number(dot.dataset.seq);
        if (state.hoverSeq === seq) return;
        state.hoverSeq = seq;
        window.setTimeout(() => {
            if (state.pinned) return;
            if (state.hoverSeq === seq) openCard(seq);
        }, HoverDelayMs);
    });
    el.railBody.addEventListener("mouseout", (event) => {
        const dot = event.target.closest(".rail-dot");
        if (dot != null && state.hoverSeq === Number(dot.dataset.seq)) state.hoverSeq = null;
    });
    el.railBody.addEventListener("mouseleave", () => {
        state.hoverSeq = null;
        if (state.pinned) return;
        window.setTimeout(() => {
            if (!state.pinned) closeCard();
        }, CloseDelayMs);
    });
    el.railBody.addEventListener("click", (event) => {
        const dot = event.target.closest(".rail-dot");
        if (dot != null) {
            const seq = Number(dot.dataset.seq);
            state.pinned = true;
            state.focusSeq = seq;
            openCard(seq);
            jump(seq);
            return;
        }
        const cluster = nearestClusterAtClientY(event.clientY);
        if (cluster != null) {
            state.activeSeq = cluster.seq;
            renderRail();
            openCard(cluster.seq);
        }
    });

    // 键盘：roving focus（design §4.4）
    el.railBody.addEventListener("keydown", (event) => {
        const buttons = [...el.railBody.querySelectorAll(".rail-dot button")];
        if (buttons.length === 0) return;
        const current = buttons.findIndex((b) => b.getAttribute("tabindex") === "0");
        const move = (target) => {
            const btn = buttons[target];
            if (btn == null) return;
            buttons.forEach((b) => b.setAttribute("tabindex", "-1"));
            btn.setAttribute("tabindex", "0");
            btn.focus();
            state.focusSeq = Number(btn.closest(".rail-dot").dataset.seq);
        };
        if (event.key === "ArrowDown") {
            event.preventDefault();
            move(Math.min(buttons.length - 1, current + 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(Math.max(0, (current < 0 ? 0 : current) - 1));
        } else if (event.key === "Home") {
            event.preventDefault();
            move(0);
        } else if (event.key === "End") {
            event.preventDefault();
            move(buttons.length - 1);
        }
    });

    el.cardLayer.addEventListener("click", (event) => {
        // 卡片内部交互重渲染会替换 DOM，阻止冒泡后 document 的“点外部关卡”不会再误判
        event.stopPropagation();
        const target = event.target;
        const jumpBtn = target.closest("[data-card-jump]");
        if (jumpBtn != null) {
            jump(Number(jumpBtn.dataset.cardJump));
            return;
        }
        if (target.closest("[data-card-close]") != null) {
            closeCard();
            return;
        }
        if (target.closest("[data-card-prev]") != null) return cardStep(-1);
        if (target.closest("[data-card-next]") != null) return cardStep(1);
        const editBtn = target.closest("[data-edit]");
        if (editBtn != null) {
            openEditor(Number(editBtn.dataset.edit));
            return;
        }
        const acceptBtn = target.closest("[data-accept]");
        if (acceptBtn != null) {
            const hit = annById(Number(acceptBtn.dataset.accept));
            if (hit != null) {
                hit.ann.status = "accepted";
                hit.ann.source = "user";
                render();
            }
            return;
        }
        const discardBtn = target.closest("[data-discard]");
        if (discardBtn != null) return deleteAnnotation(Number(discardBtn.dataset.discard));
        if (target.closest("[data-orphan-reanchor]") != null) {
            const hit = annById(Number(target.closest("[data-orphan-reanchor]").dataset.orphanReanchor));
            if (hit != null) {
                hit.ann.orphaned = false;
                render();
            }
            return;
        }
        const orphanDel = target.closest("[data-orphan-delete]");
        if (orphanDel != null) return deleteAnnotation(Number(orphanDel.dataset.orphanDelete));
    });
    el.cardLayer.addEventListener("mouseleave", () => {
        if (state.pinned) return;
        closeCard();
    });

    el.modalLayer.addEventListener("click", (event) => {
        // 弹窗内的点击不应触发 document 层的“关卡片/关菜单”
        event.stopPropagation();
        const target = event.target;
        if (target === el.modalLayer || target.closest("[data-editor-close]") != null || target.closest("[data-editor-cancel]") != null) {
            closeEditor();
            return;
        }
        if (target.closest("[data-editor-save]") != null) return saveEditor();
        if (target.closest("[data-editor-delete]") != null) return deleteAnnotation(state.editorAnnId);
        const chip = target.closest(".kind-chip");
        if (chip != null && !chip.disabled) {
            el.modalLayer.querySelectorAll(".kind-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
            chip.setAttribute("aria-pressed", "true");
            return;
        }
        if (target.closest("[data-editor-ai]") != null) {
            const title = el.modalLayer.querySelector("#edTitle");
            const body = el.modalLayer.querySelector("#edBody");
            if (title != null && title.value.trim() === "") title.value = "AI 拟定：解析链路统一";
            if (body != null && body.value.trim() === "") body.value = "AI 草稿：三处 provider 解析统一走 resolveModelName()，含 model_provider 前缀兜底。";
        }
    });

    // 全局：Esc 关最上层；卡片打开时 e 编辑
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            if (!el.modalLayer.hidden) return closeEditor();
            if (!el.filterPop.hidden) return closeFilterPop();
            if (!el.jumpMenu.hidden) return closeJumpMenu();
            if (!el.helpPop.hidden) return toggleHelp();
            if (state.cardSeq != null) return closeCard();
            return;
        }
        if ((event.key === "e" || event.key === "E") && state.cardSeq != null && el.modalLayer.hidden) {
            const list = clusters();
            const cluster = list.find((c) => c.seq === state.cardSeq);
            const first = cluster?.annotations.slice().sort((a, b) => a.t - b.t)[0];
            if (first != null) openEditor(first.id);
        }
        if (state.cardSeq != null && el.modalLayer.hidden && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            cardStep(event.key === "ArrowLeft" ? -1 : 1);
            return;
        }
        // 分页模式：无卡片时 ← / → 翻页（更早 / 更新）
        if (state.pageMode !== "all" && state.cardSeq == null && el.modalLayer.hidden && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            switchPage(event.key === "ArrowLeft" ? -1 : 1);
        }
    });

    document.addEventListener("click", (event) => {
        if (!el.filterPop.hidden && !event.target.closest("#filterPop") && !event.target.closest("#railFilterBtn")) closeFilterPop();
        if (!el.jumpMenu.hidden && !event.target.closest("#jumpMenu") && !event.target.closest("#dateJump")) closeJumpMenu();
        if (!el.helpPop.hidden && !event.target.closest("#helpPop") && !event.target.closest("#helpBtn")) toggleHelp();
        if (state.pinned && !el.cardLayer.contains(event.target) && !event.target.closest(".rail-dot")) closeCard();
        if (!el.pageModePop.hidden && !event.target.closest("#pageModePop") && !event.target.closest("#pageModeBtn")) {
            el.pageModePop.hidden = true;
            el.pageModeBtn.setAttribute("aria-expanded", "false");
        }
    });

    // rail 头部：过滤弹层 / 草稿 / 折叠 / 新批注
    el.railFilterBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFilterPop();
    });
    el.filterPop.addEventListener("click", (event) => {
        event.stopPropagation();
        const row = event.target.closest("[data-filter]");
        if (row != null) {
            const key = row.dataset.filter;
            if (state.filters.has(key)) state.filters.delete(key);
            else state.filters.add(key);
            state.focusSeq = null;
            render();
            return;
        }
        if (event.target.closest("#filterClear") != null) {
            state.filters = new Set();
            render();
            closeFilterPop();
        }
    });
    el.railDrafts.addEventListener("click", (event) => {
        if (event.target.closest("#acceptAll") != null) return acceptAllDrafts();
        if (event.target.closest("#discardAll") != null) return discardAllDrafts();
    });
    el.newPill.addEventListener("click", consumePendingNew);
    document.getElementById("railCollapse").addEventListener("click", (event) => {
        event.stopPropagation();
        el.rail.classList.add("collapsed");
        renderRail();
    });
    el.rail.addEventListener("click", (event) => {
        if (!el.rail.classList.contains("collapsed")) return;
        if (event.target.closest(".rail-head") != null) return;
        el.rail.classList.remove("collapsed");
        renderRail();
    });

    // 「加载更早」端帽（轴顶）：加载 / 失败 / 加载更多三态共用一个入口
    el.railMore.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.loadingState === "error") return retryOlder();
        if (state.loadingState === "loading") return;
        requestOlder();
    });

    el.fabLatest.addEventListener("click", goLatest);
    el.extWrite.addEventListener("click", simulateExternalWrite);
    // 分页：方式菜单 + 翻页条
    el.pageModeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePageModePop();
    });
    el.pageModePop.addEventListener("click", (event) => {
        const row = event.target.closest("[data-pm]");
        if (row != null) return setPageMode(row.dataset.pm, { user: true });
        const intervalChip = event.target.closest("[data-pm-interval]");
        if (intervalChip != null) {
            return setPageMode("interval", { intervalHours: Number(intervalChip.dataset.pmInterval), user: true });
        }
        const countChip = event.target.closest("[data-pm-count]");
        if (countChip != null) return setPageMode("count", { countSize: Number(countChip.dataset.pmCount), user: true });
    });
    el.pageInfo.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePageModePop(el.pageInfo);
    });
    el.pagePrev.addEventListener("click", () => switchPage(-1)); // 更早
    el.pageNext.addEventListener("click", () => switchPage(1)); // 更新
    el.dateJump.addEventListener("click", () => {
        if (el.jumpMenu.hidden) openJumpMenu();
        else closeJumpMenu();
    });
    el.helpBtn.addEventListener("click", toggleHelp);
    el.jumpMenu.addEventListener("click", (event) => {
        const item = event.target.closest("[data-jump-index]");
        if (item == null) return;
        const idx = Number(item.dataset.jumpIndex);
        state.loadedCount = Math.max(state.loadedCount, idx + 1);
        closeJumpMenu();
        // 分页模式下：跳转 = 切到包含该桶首页消息的页
        if (state.pageMode !== "all") {
            const bucket = state.buckets[idx];
            if (bucket != null && bucket.messages.length > 0) jump(bucket.messages[0].seq);
            return;
        }
        render();
        const bucket = state.buckets[idx];
        const head = el.flow.querySelector(`.bucket[data-key="${bucket.key}"] .bucket-head`);
        if (head != null && typeof head.scrollIntoView === "function") {
            head.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }
    });

    el.themeToggle.addEventListener("click", () => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = state.theme;
        el.themeToggle.textContent = state.theme === "dark" ? "Light" : "Dark";
    });

    el.scenario.addEventListener("change", () => setScenario(el.scenario.value));

    window.addEventListener("resize", () => {
        renderRail();
        syncRailPositions();
        if (state.cardSeq != null) positionCard();
    });

    // ── 启动 ──
    state.buckets = datasetFor("normal");
    render();

    // URL 参数（便于 review / 无头截图）：?scenario=dense&theme=light&card=44
    const params = new URLSearchParams(window.location.search);
    const initialScenario = params.get("scenario");
    if (initialScenario != null && [...el.scenario.options].some((o) => o.value === initialScenario)) {
        setScenario(initialScenario);
    }
    if (params.get("theme") === "light") {
        state.theme = "light";
        document.documentElement.dataset.theme = "light";
        el.themeToggle.textContent = "Dark";
    }
    const cardParam = params.get("card");
    if (cardParam != null && Number.isFinite(Number(cardParam))) {
        state.pinned = true;
        state.activeSeq = Number(cardParam);
        openCard(Number(cardParam));
        renderRail();
    }
    if (params.get("pop") === "filter") toggleFilterPop();
    if (params.get("mode") != null) setPageMode(params.get("mode"));
    if (params.get("interval") != null) setPageMode("interval", { intervalHours: Number(params.get("interval")) });
    if (params.get("count") != null) setPageMode("count", { countSize: Number(params.get("count")) });
    if (params.get("page") != null) {
        const page = Number(params.get("page"));
        const pages = computePages();
        if (Number.isFinite(page) && pages[page] != null) setPage(pages[page].id);
    }
    // 放在 mode/page 之后：setPageMode 会关闭弹层
    if (params.get("node") != null) createNode(Number(params.get("node")));
    if (params.get("pop") === "page") togglePageModePop();

    // smoke 测试入口（原型专用）
    window.__timelineProto = {
        state,
        KINDS,
        setScenario,
        render,
        renderRail,
        requestOlder,
        retryOlder,
        jump,
        openCard,
        closeCard,
        openEditor,
        closeEditor,
        saveEditor,
        deleteAnnotation,
        simulateExternalWrite,
        consumePendingNew,
        acceptAllDrafts,
        discardAllDrafts,
        clusters,
        openJumpMenu,
        togglePageModePop,
        setPageMode,
        setPage,
        switchPage,
        computePages,
        currentPage,
        autoPageMode,
        toggleFilterPop,
        closeFilterPop,
        nearestClusterAtClientY,
        syncRailPositions,
    };
})();
