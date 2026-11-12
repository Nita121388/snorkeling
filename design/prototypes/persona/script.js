// Persona System 原型交互
// 三场景：A 右键创建+向导 · B widget 悬浮登场 · C 人设名册
// 设计文档：design/plans/persona-system.md（§4/§4.5/§5/§6/§7）

(() => {
    "use strict";

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    /* ── 主题切换 ── */
    const themeBtn = $("#themeBtn");
    themeBtn.addEventListener("click", () => {
        const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
        document.documentElement.dataset.theme = cur;
    });

    /* ── 场景切换 ── */
    const stages = { A: $("#scnA"), B: $("#scnB"), C: $("#scnC") };
    $$(".scn").forEach((btn) =>
        btn.addEventListener("click", () => {
            $$(".scn").forEach((b) => b.classList.toggle("active", b === btn));
            Object.entries(stages).forEach(([k, el]) => (el.hidden = k !== btn.dataset.scn));
        })
    );

    /* ════════ 场景 A：右键 + 向导 ════════ */

    const ctxMenu = $("#ctxMenu");
    const wizardWrap = $("#wizardWrap");
    const toast = $("#toast");
    let ctxTarget = null; // 当前右键的会话行

    function showToast(text) {
        toast.textContent = text;
        toast.hidden = false;
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => (toast.hidden = true), 2600);
    }

    // 会话行右键 → 菜单
    $$(".sess-row").forEach((row) => {
        row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            ctxTarget = row;
            $$(".sess-row").forEach((r) => r.classList.toggle("sel", r === row));
            ctxMenu.hidden = false;
            const pad = 6;
            ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 216 - pad) + "px";
            ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 190 - pad) + "px";
        });
    });
    document.addEventListener("click", (e) => {
        if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeCtx();
        if (!ctxMenu.hidden && e.target.closest(".ctx-item")) closeCtx();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeCtx();
            wizardWrap.hidden = true;
            $("#emojiPop").hidden = true;
        }
        if (!ctxMenu.hidden && (e.key === "p" || e.key === "P")) {
            e.preventDefault();
            closeCtx();
            openWizard();
        }
    });
    function closeCtx() {
        ctxMenu.hidden = true;
        if (ctxTarget) ctxTarget.classList.remove("sel");
    }
    ctxMenu.addEventListener("click", (e) => {
        const item = e.target.closest(".ctx-item");
        if (!item) return;
        if (item.dataset.act === "persona") openWizard();
        else showToast(`${item.textContent.trim()}（原型示意）`);
    });

    // 打开向导：预填来自目标会话
    function openWizard() {
        const name = ctxTarget?.dataset.title ?? "备份管家";
        const short = name.split(/[：:，,（(]/)[0].replace(/[vV]\d.*$/, "").replace(/\s+$/, "").trim();
        $("#personaName").value = short.length > 12 ? short.slice(0, 12).replace(/\s+$/, "") : short;
        updateSlug();
        $("#derivedLine").innerHTML = `来源会话 <b>${esc(name)}</b> · ${esc(
            ctxTarget?.dataset.provider ?? "pi"
        )} · ${esc(ctxTarget?.dataset.model ?? "deepseek-v4.1")} · ${esc(ctxTarget?.dataset.proj ?? "")}`;
        setStep(1);
        wizardWrap.hidden = false;
    }

    // 目录名自动生成（演示用 zh→slug 小词典；真实实现见设计 §3：AI 翻译或拼音）
    // 注意：词典键是多字词，必须按**最长匹配**扫描，不能逐字查（否则中文名永远命中不了）
    const ZH_SLUG = {
        备份: "backup", 管家: "guard", 数据: "data", 发布: "release", 专员: "envoy",
        巡检: "patrol", 日志: "log", 图表: "chart", 监控: "monitor", 实时: "live",
        修复: "fix", 批注: "annotate", 时间线: "timeline", 设计: "design",
        原型: "proto", 界面: "ui", 逻辑: "logic", 快照: "snapshot", 采集: "collect",
        补丁: "patch", 伸缩: "resize", 深入: "deep", 挂件: "widget",
    };
    const ZH_KEYS = Object.keys(ZH_SLUG).sort((a, b) => b.length - a.length);

    function zhSlug(name) {
        // parts：词块数组（中文词 / 连续 ASCII 段 / 分隔符空串），join("-") 后折叠多余连字符
        const parts = [];
        let cur = "";
        let matched = false;
        const flush = () => {
            if (cur) { parts.push(cur); cur = ""; }
        };
        let i = 0;
        while (i < name.length) {
            const hit = ZH_KEYS.find((k) => name.startsWith(k, i));
            if (hit) {
                flush();
                parts.push(ZH_SLUG[hit]);
                matched = true;
                i += hit.length;
                continue;
            }
            const ch = name[i];
            if (/[a-zA-Z0-9]/.test(ch)) { cur += ch.toLowerCase(); matched = true; }
            else {
                flush();
                parts.push(""); // 分隔符或未收录汉字（真实实现走 AI 翻译）：词边界
            }
            i += 1;
        }
        flush();
        const slug = parts.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        if (!matched || !slug) return "persona-" + Math.abs(hash(name)).toString(36).slice(0, 6);
        return slug;
    }
    function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
    function updateSlug() {
        $("#slugPreview").textContent = zhSlug($("#personaName").value);
    }
    $("#personaName").addEventListener("input", updateSlug);

    // emoji picker
    const emojiPop = $("#emojiPop");
    $("#emojiBtn").addEventListener("click", (e) => {
        e.stopPropagation();
        emojiPop.hidden = !emojiPop.hidden;
    });
    emojiPop.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        $("#emojiBtn").textContent = btn.textContent;
        emojiPop.hidden = true;
    });
    document.addEventListener("click", (e) => {
        if (!emojiPop.hidden && !emojiPop.contains(e.target) && e.target !== $("#emojiBtn")) emojiPop.hidden = true;
    });

    // 向导步骤
    let step = 1;
    function setStep(n) {
        step = n;
        $("#wizStepNo").textContent = n;
        $("#wizStep1").hidden = n !== 1;
        $("#wizStep2").hidden = n !== 2;
        $("#wizPrev").hidden = n !== 2;
        $("#wizNext").textContent = n === 1 ? "下一步 →" : "创建人设";
        if (n === 2) renderTree();
    }
    $("#wizNext").addEventListener("click", () => {
        if (step === 1) setStep(2);
        else {
            wizardWrap.hidden = true;
            showToast(`🎭 ${$("#personaName").value} 已创建 · 据点 D:/Data/personas/${$("#slugPreview").textContent}/`);
        }
    });
    $("#wizPrev").addEventListener("click", () => setStep(1));
    $("#wizCancel").addEventListener("click", () => (wizardWrap.hidden = true));

    // 文件树预览（创建即生成，展示即真实）
    function renderTree() {
        const slug = $("#slugPreview").textContent;
        const root = "D:/Data/personas/";
        const lines = [
            ["dir", root + "                     ← 设置 → 🎭 人设 可改"],
            ["dim", "├─ .index/                  ← 派生，gitignore"],
            ["dim", "│  └─ PERSONAS.md           名册（扫描生成，L0 注入源）"],
            ["dir", `└─ ${slug}/                ← 据点（干净的「项目根」）`],
            ["file", "   ├─ .persona/            ← 档案区（隐藏，随 git 同步）"],
            ["file", "   │  ├─ persona.json     "],
            ["dim", "   │  │    { schemaVersion, id, name, emoji, provider, model }"],
            ["file", "   │  ├─ persona.local.json   "],
            ["dim", "   │  │    { workdir, sync.mode }   ← 本机专属，gitignore"],
            ["file", "   │  ├─ CHARTER.md       职责书（唯一真源）"],
            ["file", "   │  ├─ MEMORY/"],
            ["file", "   │  │  ├─ facts.md      ## TL;DR ≤5 条（注入面）+ 正文"],
            ["file", "   │  │  ├─ lessons.md    ## 标题分节（注入只带标题）"],
            ["file", "   │  │  ├─ playbook/     按需读（L2）"],
            ["new",  "   │  │  ├─ journal.md    当班流水（按月轮转到 archive/）"],
            ["new",  "   │  │  ├─ inbox.md      提议区：facts/lessons/CHARTER 经此入档"],
            ["dim",  "   │  │  └─ archive/2026-11.md   归档=记忆，随 git 同步"],
            ["new",  "   │  └─ agents/        生成物，gitignore（登场幂等重建）"],
            ["dim",  "   │     ├─ AGENTS.md  ├─ CLAUDE.md  └─ GEMINI.md"],
            ["new",  "   ├─ AGENTS.md          根级指针 16 行（GENERATED，gitignore）"],
            ["new",  "   └─ work/              工作产物（gitignore，跨机不同步）"],
        ];
        $("#treePreview").innerHTML = lines
            .map(([k, t]) => `<span class="t-${k}">${esc(t)}</span>`)
            .join(String.fromCharCode(10));
    }

    /* ════════ 场景 B：widget 悬浮登场 ════════ */

    const personaWidget = $("#personaWidget");
    const personaPop = $("#personaPop");
    const widgetHover = $("#personaWidget");
    let hoverTimer = null;

    // hover >300ms → 弹窗；点击 → 打开名册场景（原型中以场景 C 代替）
    widgetHover.addEventListener("mouseenter", () => {
        hoverTimer = setTimeout(() => {
            const r = personaWidget.getBoundingClientRect();
            positionPop(r);
            personaPop.hidden = false;
            personaWidget.classList.add("on");
        }, 300);
    });
    widgetHover.addEventListener("mouseleave", (e) => {
        clearTimeout(hoverTimer);
        // 移入弹窗本身不算离开
        setTimeout(() => {
            if (!personaPop.matches(":hover")) {
                personaPop.hidden = true;
                personaWidget.classList.remove("on");
            }
        }, 220);
    });
    personaPop.addEventListener("mouseleave", () => {
        if (!personaWidget.matches(":hover")) {
            personaPop.hidden = true;
            personaWidget.classList.remove("on");
        }
    });
    widgetHover.addEventListener("click", (e) => {
        e.stopPropagation();
        personaPop.hidden = true;
        $$('.scn[data-scn="C"]').click();
        showToast("点击 🎭 → 打开「人设名册」Block（场景 C）");
    });

    function positionPop(widgetRect) {
        personaPop.hidden = true; // 先显示才能量宽
        personaPop.hidden = false;
        const w = personaPop.offsetWidth || 340;
        const h = personaPop.offsetHeight || 480;
        let left = widgetRect.right - w - 10;
        left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
        let top = widgetRect.top - h - 8;
        if (top < 10) top = Math.min(widgetRect.bottom + 8, window.innerHeight - h - 10);
        personaPop.style.left = left + "px";
        personaPop.style.top = Math.max(10, top) + "px";
    }

    // 弹窗内选择态 + 汇总行
    const agentState = { agent: "pi", model: "deepseek-v4.1", persona: "backup-guard", personaName: "备份管家" };
    $$("#agentGrid .agent-cell").forEach((cell) =>
        cell.addEventListener("click", () => {
            $$("#agentGrid .agent-cell").forEach((c) => c.classList.toggle("active", c === cell));
            agentState.agent = cell.dataset.agent;
            updateSummary();
        })
    );
    $("#modelSel").addEventListener("change", (e) => {
        agentState.model = e.target.value;
        updateSummary();
    });
    $$("#personaList .prow").forEach((row) =>
        row.addEventListener("click", (e) => {
            if (row.dataset.new) {
                e.stopPropagation();
                $$('.scn[data-scn="A"]').click();
                showToast("「新建人设」→ 打开创建向导（场景 A）");
                return;
            }
            $$("#personaList .prow").forEach((r) => r.classList.toggle("active", r === row));
            agentState.persona = row.dataset.id;
            agentState.personaName = row.dataset.name;
            updateSummary();
        })
    );
    function updateSummary() {
        $("#popSummary").textContent = `${agentState.agent} · ${agentState.model} · ${agentState.personaName}`;
    }

    // 注入开关
    $("#injectChk").addEventListener("change", (e) => {
        $("#injectPath").hidden = !e.target.checked;
        const block = $("#launchedBlock");
        if (!block.hidden) renderLaunched(e.target.checked);
    });

    // 开始登场 → 新 block
    $("#launchBtn").addEventListener("click", () => {
        renderLaunched($("#injectChk").checked);
        const lb = $("#launchedBlock");
        lb.hidden = false;
        lb.scrollIntoView({ behavior: "smooth", block: "nearest" });
        personaPop.hidden = true;
        personaWidget.classList.remove("on");
        showToast(`🎭 ${agentState.personaName} 已登场 · cwd = 人设据点`);
    });
    function renderLaunched(injected) {
        $("#launchedBlock .ws-block-head").innerHTML = `
            <span class="dot dot-work"></span> 🧰 ${esc(agentState.personaName)}
            <span class="bh-sep">·</span> ${esc(agentState.agent)}
            <span class="bh-sep">·</span> ${esc(agentState.model)}
            <span class="bh-right">cwd D:/Data/personas/${esc(agentState.persona)}/</span>`;
        const injectLine = injected
            ? `<div class="term-line"><span class="term-prompt">[登场上下文]</span> 本次主工作目录: <b>E:/code/snorkeling</b></div>`
            : `<div class="term-line term-dim">（未注入主工作目录 · 纯人设任务）</div>`;
        $("#launchedBlock .ws-block-body").innerHTML =
            injectLine +
            `<div class="term-line term-dim">读取 CHARTER.md · MEMORY/facts.md TL;DR · PERSONAS.md（3 位同事）</div>
             <div class="term-line term-dim">注入 ≈ 640 tokens（L0 名册 3 行 + L1 本人摘要，硬顶 2K）</div>
             <div class="term-line">&gt; ${esc(agentState.personaName)}就位 <span class="term-cursor">▌</span></div>`;
    }

    /* ════════ 场景 C：名册 ════════ */

    const personaData = {
        "backup-guard": {
            emoji: "🧰", name: "备份管家", meta: "pi · deepseek-v4.1 · 创建于 11-06 · <span class='badge-human'>人建</span>",
            state: "● 登场中 2h13m", live: true,
            charter: [
                "每日备份检查：确认关键目录有当日快照",
                "归档异常：失败重试 + 台账登记",
                "不管：代码修改、发版（那是发布专员的活）",
            ],
            base: "D:/Data/personas/backup-guard/",
            mem: [12, 8, 3, "1.1K"],
        },
        "data-butler": {
            emoji: "📊", name: "数据管家", meta: "pi · kimi-k2 · 创建于 10-28 · <span class='badge-ai'>⚡AI 自建</span>",
            state: "○ 空闲 · 3 天前登场", live: false,
            charter: ["数据清洗与报表：qc.json / research.json", "不碰：备份归档（备份管家的据点）"],
            base: "D:/Data/personas/data-butler/",
            mem: [21, 14, 5, "1.6K"],
        },
        "release-envoy": {
            emoji: "🌐", name: "发布专员", meta: "claude · sonnet-4.5 · 创建于 09-14 · <span class='badge-human'>人建</span>",
            state: "○ 空闲 · 昨日 21:40 登场", live: false,
            charter: ["发版：bump → tag → push → Release", "Stable/Beta 通道管理", "不管：备份、数据"],
            base: "D:/Releases/personas/release-envoy/（单独据点）",
            mem: [9, 6, 4, "0.9K"],
        },
    };

    $$(".rrow[data-id]").forEach((row) =>
        row.addEventListener("click", () => {
            $$(".rrow").forEach((r) => r.classList.toggle("active", r === row));
            renderDetail(personaData[row.dataset.id]);
        })
    );
    $(".rrow-new[data-new]").addEventListener("click", () => {
        $$('.scn[data-scn="A"]').click();
        showToast("「新建人设」→ 场景 A 向导");
    });

    function renderDetail(d) {
        $("#rdTitle").textContent = d.name;
        $(".rd-emoji").textContent = d.emoji;
        $("#rdMeta").innerHTML = d.meta;
        const stateEl = $("#rdState");
        stateEl.textContent = d.state;
        stateEl.className = "chip " + (d.live ? "chip-live" : "");
        $("#rdCharter").innerHTML = d.charter.map((c) => `<li>${esc(c)}</li>`).join("");
        $("#rdBase").innerHTML = `${esc(d.base)} <button class="mini-btn">打开</button>`;
        const cells = $$(".mem-cell");
        cells[0].querySelector("b").textContent = d.mem[0];
        cells[1].querySelector("b").textContent = d.mem[1];
        cells[2].querySelector("b").textContent = d.mem[2];
        cells[3].querySelector("b").textContent = d.mem[3];
        $(".mem-bar span").style.width = Math.min(100, (parseInt(d.mem[3]) / 2000) * 100) + "%";
        $(".mem-note").textContent = `L0 名册 3 行 + L1 本人摘要 ≈ ${d.mem[3]} tok（硬顶 2K）`;
    }

    // 待批准：批准 → 进列表；驳回 → 消失
    $("#pendingBox").addEventListener("click", (e) => {
        if (e.target.closest("[data-approve]")) {
            $("#pendingBox").hidden = true;
            showToast("🎭 日志巡检员 已批准 · 据点已 scaffold · 名册 L0 新增一行");
        } else if (e.target.closest("[data-reject]")) {
            $("#pendingBox").hidden = true;
            showToast("已驳回 · 提议不落盘（proposals/ 仅记录保留）");
        }
    });

    // 休眠折叠
    $("#dormantToggle").addEventListener("click", () => {
        const body = $("#dormantBody");
        body.hidden = !body.hidden;
        $("#dormantToggle .chev").textContent = body.hidden ? "▸" : "▾";
    });

    // 叫TA登场（详情页）→ 场景 B 演示登场的 block
    $("#rdLaunch").addEventListener("click", () => {
        $$('.scn[data-scn="B"]').click();
        showToast("切到场景 B：右侧 🎭 图标 hover 可重演登场弹窗");
    });

    /* ── util ── */
    function esc(s) {
        return String(s).replace(/[&<>"']/g, (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
        );
    }
})();
