// 批注时间线 v2 原型脚本。
//
// 覆盖设计文档（design/plans/aisessions-annotation-timeline-v2.md）三块：
//   D1 时间桶分页：窗口 = 最近 N 个桶；「加载更早」前插并补偿 scrollTop；
//      日期跳转补齐窗口后滚到桶头；「回到最新」回底。
//   D2 UI：桶 = 日期分段头（sticky）+ 密度微条 + 稀疏折叠行；rail 圆点三态 + agent 角标。
//   D3 外部写入：模拟 wsh annotation add 落库 → agent 角标 + 新批注 pill（不劫持滚动）。
//
// 纯静态演示，不含真实 RPC；数据固定，便于 smoke 测试断言。

(function () {
    "use strict";

    const DAY = 86400000;
    const BASE = new Date(2026, 10, 11); // 2026-11-11 本地时间，mock 的「今天」
    const HoverDelayMs = 150; // 对齐真实 annotation-rail.tsx
    const CloseDelayMs = 320;
    const FlashMs = 1200; // 对齐真实 AnnotationFlashMs
    const RailDotMinGap = 28; // 对齐真实 RailDotGap
    const RailPad = 16;

    function at(dayOffset, hh, mm) {
        const d = new Date(BASE.getTime() + dayOffset * DAY);
        d.setHours(hh, mm, 0, 0);
        return d.getTime();
    }

    // 桶数组：newest → oldest。offset 相对 BASE 的天偏移，用于算稀疏间隔。
    const BUCKETS = [
        {
            key: "b0",
            offset: 0,
            label: "今天",
            date: "11-11",
            messages: [
                { seq: 40, t: at(0, 9, 12), role: "user", text: "会话恢复后 agent 卡片一直显示「未指定」，查下 pi/codex 的模型解析。" },
                { seq: 41, t: at(0, 9, 14), role: "assistant", text: "定位到 provider 的 model 字段有两套：pi 走 model，codex 走 model_provider/model，需要统一 resolveModelName()。" },
                { seq: 42, t: at(0, 9, 31), role: "tool", tool: "read", text: "pkg/aisessions/provider_pi.go" },
                { seq: 43, t: at(0, 9, 40), role: "tool", tool: "bash", text: "go test ./pkg/aisessions -run Model" },
                { seq: 44, t: at(0, 10, 2), role: "assistant", text: "三处解析统一走 resolveModelName()，回归测试全绿（12 passed）。" },
                { seq: 45, t: at(0, 10, 24), role: "assistant", text: "顺手把 agent 卡片的 chip 收口到 AgentStatusView，避免三个面不一致。" },
                { seq: 46, t: at(0, 10, 40), role: "user", text: "行，那就按这个方向继续。" },
            ],
            annotations: [
                {
                    id: 1,
                    seq: 41,
                    kind: "note",
                    title: "模型解析双源",
                    body: "pi/codex 的 model 字段来源不同，需统一 resolveModelName()；注意 codex 的 model_provider 前缀不能丢。",
                    tags: ["provider", "bug"],
                    source: "user",
                    author: "",
                    t: at(0, 9, 20),
                },
                {
                    id: 2,
                    seq: 44,
                    kind: "milestone",
                    title: "解析修复完成",
                    body: "12 个回归用例全绿；会话恢复后卡片不再显示「未指定」。由 agent 在跑完测试后自动记录。",
                    tags: ["done"],
                    source: "agent",
                    author: "pi",
                    t: at(0, 10, 8),
                },
                {
                    id: 3,
                    seq: 46,
                    kind: "decision",
                    title: "继续收口状态 chip",
                    body: "下一步做 AgentStatusView 跨面一致性，Done 随 seen 联动。",
                    tags: ["plan"],
                    source: "user",
                    author: "",
                    t: at(0, 10, 42),
                },
            ],
        },
        {
            key: "b1",
            offset: -1,
            label: "昨天",
            date: "11-10",
            messages: [
                { seq: 30, t: at(-1, 14, 2), role: "user", text: "外部 agent 能不能给自己的会话写批注？" },
                { seq: 31, t: at(-1, 14, 6), role: "assistant", text: "可以走 wsh 控制面：wsh annotation add --session <key> --anchor seq:31，append-only。" },
                { seq: 32, t: at(-1, 14, 30), role: "tool", tool: "bash", text: "wsh annotation list --session current" },
                { seq: 33, t: at(-1, 15, 1), role: "assistant", text: "幂等键命中时返回原条目，不产生第二条。" },
                { seq: 34, t: at(-1, 15, 20), role: "tool", tool: "edit", text: "pkg/wshrpc/wshrpctypes.go" },
                { seq: 35, t: at(-1, 15, 44), role: "assistant", text: "外部通道只允许 append，改删一律走人审后的 AnnotationSave。" },
                { seq: 36, t: at(-1, 16, 10), role: "assistant", text: "审计：每条写入带 agentName + idempotencyKey，可在 Audit 面板追溯。" },
            ],
            annotations: [
                {
                    id: 4,
                    seq: 31,
                    kind: "question",
                    title: "append-only 够用吗？",
                    body: "agent 想纠正自己写错的批注时怎么办？先按「写错就再写一条修正」，修改能力留给人审。",
                    tags: ["open"],
                    source: "ai",
                    author: "",
                    status: "draft",
                    t: at(-1, 14, 12),
                },
                {
                    id: 5,
                    seq: 36,
                    kind: "note",
                    title: "审计链路",
                    body: "写入 → agentdata patch → 备份 + 审计，无第二套写路径。",
                    tags: ["acs"],
                    source: "agent",
                    author: "codex",
                    t: at(-1, 16, 15),
                },
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
                { seq: 24, t: at(-5, 11, 52), role: "tool", tool: "bash", text: "npx vitest run timeline-virtual" },
                { seq: 25, t: at(-5, 12, 6), role: "assistant", text: "测试全绿，滚动锚定不再跳。" },
                { seq: 26, t: at(-5, 12, 30), role: "user", text: "好，先合这一版。" },
            ],
            annotations: [
                {
                    id: 6,
                    seq: 23,
                    kind: "milestone",
                    title: "行高估算落地",
                    body: "按行类型估算 + measureElement 校正，重影问题消失。",
                    tags: ["perf"],
                    source: "user",
                    author: "",
                    t: at(-5, 11, 40),
                },
                {
                    id: 7,
                    seq: 26,
                    kind: "note",
                    title: "合并范围",
                    body: "只合前端，不碰 pkg。",
                    tags: [],
                    source: "user",
                    author: "",
                    t: at(-5, 12, 32),
                },
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
                {
                    id: 8,
                    seq: 17,
                    kind: "decision",
                    title: "只持久化显式字段",
                    body: "避免把默认值写进 storage 导致后续默认值变更失效。",
                    tags: ["state"],
                    source: "user",
                    author: "",
                    t: at(-8, 10, 2),
                },
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
                { seq: 12, t: at(-11, 16, 30), role: "tool", tool: "read", text: "frontend/app/view/overview/board-card.tsx" },
                { seq: 13, t: at(-11, 17, 0), role: "assistant", text: "卡片关闭 / 删除动作顺手一起收口。" },
                { seq: 14, t: at(-11, 17, 20), role: "user", text: "先把删除的确认流程想清楚。" },
            ],
            annotations: [
                {
                    id: 9,
                    seq: 9,
                    kind: "note",
                    title: "跳转定位方式",
                    body: "blockId + tabId 组合定位；不能只按进程 PID，重连后 PID 会变。",
                    tags: ["overview"],
                    source: "user",
                    author: "",
                    t: at(-11, 15, 30),
                },
                {
                    id: 10,
                    seq: 14,
                    kind: "question",
                    title: "彻底删除要不要二次确认",
                    body: "删 block 会连带删内联 tab 组，误删代价高，倾向于二次确认 + 可撤销 toast。",
                    tags: ["ux"],
                    source: "user",
                    author: "",
                    t: at(-11, 17, 22),
                },
            ],
        },
    ];

    // 初始窗口：最近 2 个桶（对齐设计文档 §3.3「初始只加载一页」）。
    const state = {
        loadedCount: 2,
        theme: "dark",
        pinnedSeq: null,
        hoverSeq: null,
        pendingNew: [],
        extWriteCount: 0,
        cardSeq: null,
        activeSeq: null,
    };

    const $ = (sel) => document.querySelector(sel);
    const el = {
        rail: $("#rail"),
        railBody: $("#railBody"),
        railToggle: $("#railToggle"),
        newPill: $("#newPill"),
        flow: $("#flow"),
        loadOlder: $("#loadOlder"),
        fabLatest: $("#fabLatest"),
        jumpMenu: $("#jumpMenu"),
        dateJump: $("#dateJump"),
        extWrite: $("#extWrite"),
        themeToggle: $("#themeToggle"),
        cardLayer: $("#cardLayer"),
        readout: $("#stateReadout"),
    };

    // ── 窗口派生数据 ──

    function loadedBuckets() {
        return BUCKETS.slice(0, state.loadedCount);
    }

    function loadedAnnotations() {
        return loadedBuckets().flatMap((bucket) => bucket.annotations);
    }

    function clusterAnnotations(annotations) {
        const map = new Map();
        for (const ann of annotations) {
            const bucket = loadedBuckets().find((item) => item.annotations.includes(ann));
            if (bucket == null) continue;
            const msg = bucket.messages.find((m) => m.seq === ann.seq);
            const ts = msg != null ? msg.t : ann.t;
            let cluster = map.get(ann.seq);
            if (cluster == null) {
                cluster = { seq: ann.seq, ts, annotations: [] };
                map.set(ann.seq, cluster);
            }
            cluster.annotations.push(ann);
        }
        return [...map.values()].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
    }

    function clusters() {
        return clusterAnnotations(loadedAnnotations());
    }

    function bucketGapDays(newerIdx) {
        const newer = BUCKETS[newerIdx];
        const older = BUCKETS[newerIdx + 1];
        if (newer == null || older == null) return 0;
        return Math.max(0, newer.offset - older.offset - 1);
    }

    // ── rail ──

    // 时间分布 + 最小间距松弛：与 timeline-virtual.ts 的 relaxTimelinePositions 同思路，
    // 原型里用一次性前推 + 回推夹取，避免挤在一起的批注互相重叠。
    function relaxPositions(ideal, minGap, minY, maxY) {
        const out = ideal.slice();
        for (let i = 1; i < out.length; i++) {
            if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap;
        }
        let overflow = out.length > 0 ? out[out.length - 1] - maxY : 0;
        if (overflow > 0) {
            for (let i = out.length - 1; i >= 0; i--) {
                const cap = i === out.length - 1 ? maxY : out[i + 1] - minGap;
                if (out[i] > cap) out[i] = cap;
            }
        }
        if (out.length > 0 && out[0] < minY) {
            const shift = minY - out[0];
            for (let i = 0; i < out.length; i++) out[i] += shift;
        }
        return out;
    }

    function railGeometry() {
        const height = Math.max(240, el.railBody.clientHeight || 0);
        const list = clusters();
        if (list.length === 0) return { height, positions: [] };
        const top = RailPad;
        const bottom = Math.max(top + RailDotMinGap, height - RailPad);
        const usable = bottom - top;
        const minTs = Math.min(...list.map((c) => c.ts));
        const maxTs = Math.max(...list.map((c) => c.ts));
        const span = Math.max(1, maxTs - minTs);
        const ideal = list.map((c) =>
            list.length === 1 ? top + usable / 2 : top + ((c.ts - minTs) / span) * usable
        );
        const positions = relaxPositions(ideal, RailDotMinGap, top, bottom);
        return { height, positions, minTs, maxTs };
    }

    function renderRail() {
        const { height, positions, minTs, maxTs } = railGeometry();
        const list = clusters();
        const parts = [];

        // 桶刻度 / 稀疏标记：放在「相邻两桶批注的时间中点」，比桶日界线稳定
        // （日界线常落在窗口时间范围外，直接映射会被钳到两端、刻度跑到轴头）。
        if (minTs != null && maxTs != null && maxTs > minTs) {
            const geoTop = RailPad;
            const geoBottom = Math.max(geoTop + RailDotMinGap, height - RailPad);
            const frac = (ts) => Math.min(1, Math.max(0, (ts - minTs) / (maxTs - minTs)));
            loadedBuckets().forEach((bucket, idx) => {
                if (idx === 0) return; // 最新桶无上边界
                const newer = loadedBuckets()[idx - 1];
                const msgTs = (bucketRef, ann) =>
                    bucketRef.messages.find((m) => m.seq === ann.seq)?.t ?? ann.t;
                const newerTs = Math.max(...newer.annotations.map((ann) => msgTs(newer, ann)));
                const olderTs = Math.min(...bucket.annotations.map((ann) => msgTs(bucket, ann)));
                const boundaryTs = (newerTs + olderTs) / 2;
                const y = geoTop + frac(boundaryTs) * (geoBottom - geoTop);
                parts.push(`<div class="rail-tick" style="top:${y.toFixed(1)}px"></div>`);
                const gap = bucketGapDays(idx - 1);
                if (gap > 0) {
                    parts.push(`<div class="rail-gap" style="top:${y.toFixed(1)}px">···</div>`);
                }
            });
        }

        parts.push(`<div class="rail-axis"></div>`);

        list.forEach((cluster, index) => {
            const top = positions[index];
            const hasAgent = cluster.annotations.some((ann) => ann.author !== "");
            const hasDraft = cluster.annotations.some((ann) => ann.status === "draft");
            const isActive = state.activeSeq === cluster.seq;
            const size = isActive ? 16 : 10;
            const cls = [
                "rail-dot",
                hasDraft ? "is-draft" : "",
                hasAgent ? "has-agent" : "",
                isActive ? "is-active" : "",
            ]
                .filter(Boolean)
                .join(" ");
            const count = cluster.annotations.length;
            parts.push(
                `<div class="${cls}" data-seq="${cluster.seq}" style="top:${top.toFixed(1)}px">` +
                    `<button type="button" aria-label="Jump to annotation at #${cluster.seq}" title="#${cluster.seq} · ${count} 条批注">` +
                    `<span class="rail-dot-pip" style="width:${size}px;height:${size}px"></span>` +
                    `</button></div>`
            );
        });

        parts.push(`<div class="rail-playhead" id="playhead" hidden></div>`);
        el.railBody.innerHTML = parts.join("");

        // 折叠态只留轴线。
        if (el.rail.classList.contains("collapsed")) {
            el.railBody.innerHTML = `<div class="rail-axis"></div>`;
        }
    }

    // ── flow ──

    function kindKicon(kind) {
        const glyph = { note: "✎", milestone: "◆", decision: "⚖", question: "?" }[kind] ?? "✎";
        return `<i class="kicon ${kind}" aria-hidden="true">${glyph}</i>`;
    }

    function esc(text) {
        return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    }

    function renderFlow() {
        const parts = [];
        const loaded = loadedBuckets();
        const remaining = BUCKETS.length - state.loadedCount;

        el.loadOlder.hidden = remaining === 0;
        el.loadOlder.textContent = remaining > 0 ? `↑ 加载更早 · 还有 ${remaining} 个时间桶` : "";

        // 展示顺序 = 旧 → 新（聊天流方向）。
        for (let i = loaded.length - 1; i >= 0; i--) {
            const bucket = loaded[i];
            // 相邻已加载桶之间的稀疏折叠（未知间隔不画，避免谎报天数）。
            if (i + 1 < loaded.length) {
                const gap = bucketGapDays(i);
                if (gap > 0) {
                    parts.push(`<div class="gap-row" data-gap="${gap}">… 跳过 ${gap} 天 …</div>`);
                }
            }
            const dens = bucket.annotations
                .map((ann) => `<i class="${esc(ann.kind)}" title="${esc(ann.kind)} · ${esc(ann.title)}"></i>`)
                .join("");
            parts.push(
                `<div class="bucket" data-key="${bucket.key}" data-offset="${bucket.offset}">` +
                    `<div class="bucket-head">` +
                    `<span class="bucket-label">${esc(bucket.label)}</span>` +
                    `<span class="bucket-date">${esc(bucket.date)}</span>` +
                    `<span class="bucket-count">${bucket.annotations.length} 条批注</span>` +
                    `<span class="dens" aria-hidden="true">${dens}</span>` +
                    `</div>`
            );
            for (const msg of bucket.messages) {
                const anns = bucket.annotations.filter((ann) => ann.seq === msg.seq);
                const hasAgent = anns.some((ann) => ann.author !== "");
                const isTool = msg.role === "tool";
                const roleLabel = { user: "You", assistant: "Agent", tool: "Tool" }[msg.role] ?? msg.role;
                const time = new Date(msg.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
                if (isTool) {
                    parts.push(
                        `<div class="msg is-tool" data-seq="${msg.seq}" id="msg-${msg.seq}">` +
                            `<span class="tool-status"></span>` +
                            `<span class="tool-name">${esc(msg.tool)}</span>` +
                            `<span>${esc(msg.text)}</span>` +
                            (anns.length > 0 ? badge(anns) : "") +
                            `</div>`
                    );
                    continue;
                }
                parts.push(
                    `<div class="msg is-${msg.role}" data-seq="${msg.seq}" id="msg-${msg.seq}">` +
                        `<div class="msg-meta"><span class="msg-role">${esc(roleLabel)}</span><span>#${msg.seq}</span><span>${time}</span></div>` +
                        `<div class="msg-text">${esc(msg.text)}</div>` +
                        (anns.length > 0 ? badge(anns) : "") +
                        `</div>`
                );
            }
            parts.push(`</div>`);
        }
        el.flow.innerHTML = parts.join("");
        const fab = el.fabLatest;
        fab.hidden = true;
    }

    function badge(anns) {
        const hasAgent = anns.some((ann) => ann.author !== "");
        return `<span class="ann-badge${hasAgent ? " has-agent" : ""}" data-badge-seq="${anns[0].seq}">🏷 ${anns.length}</span>`;
    }

    function renderReadout() {
        el.readout.textContent = `窗口 ${state.loadedCount}/${BUCKETS.length} 桶 · ${loadedAnnotations().length} 条批注`;
    }

    function render() {
        renderFlow();
        renderRail();
        renderReadout();
        renderNewPill();
        if (state.cardSeq != null) openCard(state.cardSeq);
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

    // ── 悬浮卡 ──

    function closeCard(force) {
        if (state.pinnedSeq != null && !force) return;
        state.cardSeq = null;
        state.pinnedSeq = null;
        state.hoverSeq = null;
        el.cardLayer.innerHTML = "";
        renderRail();
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

    function openCard(seq) {
        const list = clusters();
        const cluster = list.find((c) => c.seq === seq);
        if (cluster == null) return;
        state.cardSeq = seq;
        const bucket = loadedBuckets().find((b) => b.annotations.some((ann) => ann.seq === seq));
        const msg = bucket?.messages.find((m) => m.seq === seq);
        const time = msg != null ? new Date(msg.t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
        const nodeType = msg == null ? "note" : msg.role === "tool" ? "milestone" : "note";
        const preview = msg != null ? (msg.role === "tool" ? `${msg.tool} ${msg.text}` : msg.text) : "";
        const anns = cluster.annotations
            .slice()
            .sort((a, b) => a.t - b.t)
            .map(
                (ann) =>
                    `<div class="ann">` +
                    `<div class="ann-title">${kindKicon(ann.kind)}<span>${esc(ann.title)}</span>${srcBadge(ann)}</div>` +
                    `<div class="ann-body">${esc(ann.body)}</div>` +
                    (ann.tags.length > 0
                        ? `<div class="ann-tags">${ann.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("")}</div>`
                        : "") +
                    `</div>`
            )
            .join("");
        const pinned = state.pinnedSeq != null;
        el.cardLayer.innerHTML =
            `<div class="acard" role="dialog" aria-label="Annotations at #${seq}">` +
            `<div class="acard-head">` +
            `<span class="node-id">${kindKicon(cluster.annotations[0].kind)}#${seq} · ${time}</span>` +
            `<span class="acard-actions">` +
            `<button class="acard-btn" type="button" data-card-jump="${seq}">Jump</button>` +
            (pinned ? `<button class="acard-btn muted" type="button" data-card-close="1" aria-label="Close">✕</button>` : "") +
            `</span></div>` +
            (preview !== "" ? `<div class="node-orig">${esc(preview)}</div>` : "") +
            `<div class="ann-list">${anns}</div>` +
            `</div>`;
        positionCard(seq);
    }

    function positionCard(seq) {
        const card = el.cardLayer.querySelector(".acard");
        const dot = el.railBody.querySelector(`.rail-dot[data-seq="${seq}"] .rail-dot-pip`);
        if (card == null || dot == null) return;
        const stageRect = document.querySelector(".stage").getBoundingClientRect();
        const dotRect = dot.getBoundingClientRect();
        const cardW = 320;
        const cardH = Math.min(card.offsetHeight || 300, stageRect.height * 0.6);
        const left = stageRect.left + 44 + 8;
        const preferTop = dotRect.top + dotRect.height / 2 - 24;
        const maxTop = stageRect.top + stageRect.height - cardH - 12;
        const top = Math.max(stageRect.top + 8, Math.min(preferTop, maxTop));
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.width = `${Math.min(cardW, stageRect.width - 44 - 24)}px`;
    }

    // ── 滚动：playhead / 回到最新 ──

    function firstVisibleMessage() {
        const nodes = el.flow.querySelectorAll(".msg[data-seq]");
        const flowRect = el.flow.getBoundingClientRect();
        let best = null;
        for (const node of nodes) {
            const rect = node.getBoundingClientRect();
            if (rect.bottom > flowRect.top + 40) {
                best = node;
                break;
            }
        }
        return best;
    }

    function updatePlayhead() {
        const playhead = el.railBody.querySelector("#playhead");
        if (playhead == null) return;
        const node = firstVisibleMessage();
        if (node == null) {
            playhead.hidden = true;
            return;
        }
        const seq = Number(node.dataset.seq);
        const bucket = loadedBuckets().find((b) => b.messages.some((m) => m.seq === seq));
        const msg = bucket?.messages.find((m) => m.seq === seq);
        const geo = railGeometry();
        if (msg == null || geo.minTs == null) {
            playhead.hidden = true;
            return;
        }
        const span = Math.max(1, geo.maxTs - geo.minTs);
        const frac = Math.min(1, Math.max(0, (msg.t - geo.minTs) / span));
        const top = RailPad + frac * Math.max(0, geo.height - RailPad * 2);
        playhead.hidden = false;
        playhead.style.top = `${top.toFixed(1)}px`;
    }

    function updateFab() {
        const atBottom = el.flow.scrollTop < el.flow.scrollHeight - el.flow.clientHeight - 300;
        el.fabLatest.hidden = !atBottom;
    }

    let scrollRaf = 0;
    el.flow.addEventListener("scroll", () => {
        if (scrollRaf !== 0) return;
        scrollRaf = window.requestAnimationFrame(() => {
            scrollRaf = 0;
            updatePlayhead();
            updateFab();
        });
    });

    // ── 动作 ──

    function jump(seq) {
        let node = el.flow.querySelector(`#msg-${seq}`);
        if (node == null) {
            // 目标所在桶还没加载：补齐窗口后重试（对应设计文档 §3.3 日期跳转 / pill 跳转）。
            const idx = BUCKETS.findIndex((b) => b.messages.some((m) => m.seq === seq));
            if (idx < 0) return;
            state.loadedCount = Math.max(state.loadedCount, idx + 1);
            render();
            node = el.flow.querySelector(`#msg-${seq}`);
        }
        if (node == null) return;
        state.activeSeq = seq;
        node.classList.remove("flash");
        void node.offsetWidth; // 重启动画
        node.classList.add("flash");
        window.setTimeout(() => node.classList.remove("flash"), FlashMs);
        if (typeof node.scrollIntoView === "function") {
            node.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }
        renderRail();
    }

    function prefersReducedMotion() {
        return window.matchMedia != null && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function loadOlder() {
        if (state.loadedCount >= BUCKETS.length) return;
        const prevHeight = el.flow.scrollHeight;
        const prevTop = el.flow.scrollTop;
        state.loadedCount += 1;
        render();
        // 内容前插：补偿 scrollTop，视口内容不动（对齐设计文档 §3.3）。
        const delta = el.flow.scrollHeight - prevHeight;
        el.flow.scrollTop = prevTop + delta;
        updatePlayhead();
    }

    function goLatest() {
        if (typeof el.flow.scrollTo === "function") {
            el.flow.scrollTo({ top: el.flow.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        } else {
            el.flow.scrollTop = el.flow.scrollHeight;
        }
    }

    const EXT_TARGETS = [45, 42, 43, 40, 46];
    function simulateExternalWrite() {
        const bucket = BUCKETS[0];
        state.extWriteCount += 1;
        const targetSeq =
            EXT_TARGETS.find((seq) => !bucket.annotations.some((ann) => ann.seq === seq)) ??
            EXT_TARGETS[state.extWriteCount % EXT_TARGETS.length];
        const ann = {
            id: 100 + state.extWriteCount,
            seq: targetSeq,
            kind: "note",
            title: `外部写入 #${state.extWriteCount} · 待审`,
            body: `wsh annotation add --session current --anchor seq:${targetSeq} --kind note --author pi（append-only，幂等键已写入）`,
            tags: ["acs", "agent"],
            source: "agent",
            author: "pi",
            t: Date.now(),
        };
        bucket.annotations.push(ann);
        state.pendingNew.push(ann.id);
        if (state.cardSeq === targetSeq) state.cardSeq = targetSeq;
        render();
        el.newPill.hidden = false;
        el.newPill.textContent = `${state.pendingNew.length} 条新批注 ↓`;
    }

    function consumePendingNew() {
        if (state.pendingNew.length === 0) return;
        const seq = state.pendingNew[0];
        const ann = loadedAnnotations().find((item) => item.id === seq);
        state.pendingNew = [];
        renderNewPill();
        if (ann != null) jump(ann.seq);
    }

    // ── 日期跳转菜单 ──

    function buildJumpMenu() {
        el.jumpMenu.innerHTML = BUCKETS.map(
            (bucket, idx) =>
                `<button class="jump-item" type="button" data-jump-index="${idx}">` +
                `<span class="ji-label">${esc(bucket.label)}</span>` +
                `<span class="ji-date">${esc(bucket.date)}</span>` +
                (idx < state.loadedCount ? `<span class="ji-tag">已加载</span>` : "") +
                `<span class="ji-count">${bucket.annotations.length} 条</span>` +
                `</button>`
        ).join("");
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

    // ── 事件绑定 ──

    // rail：150ms hover 出卡 / 单击钉住 + 跳转（对齐真实组件）
    el.railBody.addEventListener("mouseover", (event) => {
        if (el.rail.classList.contains("collapsed")) return;
        const dot = event.target.closest(".rail-dot");
        if (dot == null) return;
        const seq = Number(dot.dataset.seq);
        if (state.hoverSeq === seq) return;
        state.hoverSeq = seq;
        window.setTimeout(() => {
            if (state.hoverSeq !== seq) return;
            if (state.pinnedSeq != null) return; // 钉住的卡不被 hover 抢走
            openCard(seq);
        }, HoverDelayMs);
    });
    el.railBody.addEventListener("mouseout", (event) => {
        const dot = event.target.closest(".rail-dot");
        if (dot == null) return;
        state.hoverSeq = null;
        if (state.pinnedSeq != null) return;
        window.setTimeout(() => {
            if (state.hoverSeq == null && state.pinnedSeq == null) closeCard(true);
        }, CloseDelayMs);
    });
    el.railBody.addEventListener("click", (event) => {
        const dot = event.target.closest(".rail-dot");
        if (dot == null) return;
        const seq = Number(dot.dataset.seq);
        state.pinnedSeq = seq;
        openCard(seq);
        jump(seq);
    });

    el.cardLayer.addEventListener("mouseover", () => {
        // 进卡后保持开启（真实组件用 timer 取消，这里简化为钉住即保持）。
    });
    el.cardLayer.addEventListener("mouseleave", () => {
        if (state.pinnedSeq != null) return;
        closeCard(true);
    });
    el.cardLayer.addEventListener("click", (event) => {
        const jumpBtn = event.target.closest("[data-card-jump]");
        if (jumpBtn != null) {
            jump(Number(jumpBtn.dataset.cardJump));
            return;
        }
        if (event.target.closest("[data-card-close]") != null) closeCard(true);
    });

    // 点击空白处收起卡
    document.addEventListener("click", (event) => {
        if (el.cardLayer.contains(event.target)) return;
        if (event.target.closest(".rail-dot")) return;
        if (state.pinnedSeq != null) closeCard(true);
        if (!el.jumpMenu.hidden && !event.target.closest("#jumpMenu") && !event.target.closest("#dateJump")) {
            closeJumpMenu();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeCard(true);
            closeJumpMenu();
        }
    });

    // 流程按钮
    el.loadOlder.addEventListener("click", loadOlder);
    el.fabLatest.addEventListener("click", goLatest);
    el.extWrite.addEventListener("click", simulateExternalWrite);
    el.newPill.addEventListener("click", consumePendingNew);
    el.dateJump.addEventListener("click", () => {
        if (el.jumpMenu.hidden) openJumpMenu();
        else closeJumpMenu();
    });
    el.jumpMenu.addEventListener("click", (event) => {
        const item = event.target.closest("[data-jump-index]");
        if (item == null) return;
        const idx = Number(item.dataset.jumpIndex);
        state.loadedCount = Math.max(state.loadedCount, idx + 1);
        render();
        closeJumpMenu();
        const bucket = BUCKETS[idx];
        const head = el.flow.querySelector(`.bucket[data-key="${bucket.key}"] .bucket-head`);
        if (head != null && typeof head.scrollIntoView === "function") {
            head.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }
    });

    // rail 折叠
    el.railToggle.addEventListener("click", (event) => {
        event.stopPropagation();
        el.rail.classList.add("collapsed");
        renderRail();
    });
    el.rail.addEventListener("click", () => {
        if (!el.rail.classList.contains("collapsed")) return;
        el.rail.classList.remove("collapsed");
        renderRail();
    });

    // 主题
    el.themeToggle.addEventListener("click", () => {
        state.theme = state.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = state.theme;
        el.themeToggle.textContent = state.theme === "dark" ? "Light" : "Dark";
    });

    window.addEventListener("resize", () => {
        renderRail();
        if (state.cardSeq != null) positionCard(state.cardSeq);
    });

    // ── 启动 ──
    render();
    updatePlayhead();

    // smoke 测试入口（原型专用，不供生产使用）
    window.__timelineProto = {
        state,
        BUCKETS,
        render,
        renderRail,
        loadOlder,
        jump,
        openCard,
        closeCard,
        simulateExternalWrite,
        consumePendingNew,
        clusters,
        openJumpMenu,
    };
})();
