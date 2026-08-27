// ============================================================
//   Snorkeling 保存状态优化 — 原型交互
//   演示：① Tab 脏点出现/消失 ② 冲突弹窗 + 复制差异预览
//   ============================================================

(function () {
    "use strict";

    // ---------- 场景一：Tab 脏点 ----------
    const DOM = {
        tabB: document.querySelector('.inline-tab-block-tab[data-block="note-b.md"]'),
        dotB: document.querySelector('.inline-tab-block-tab[data-block="note-b.md"] .inline-tab-block-tab-dirty-dot'),
        stateStrip: document.getElementById("tabStateStrip"),
        btnEditB: document.getElementById("btnEditB"),
        btnSaveB: document.getElementById("btnSaveB"),
        btnResetDemo: document.getElementById("btnResetDemo"),
    };

    function renderTabState() {
        const dirty = DOM.tabB.getAttribute("data-dirty") === "true";
        DOM.tabB.setAttribute("data-dirty", dirty ? "true" : "false");
        DOM.dotB.classList.toggle("hidden", !dirty);
        const rows = [
            `<span class="tag"><span class="dot-sample"></span> note-b.md 草稿: <b>${dirty ? "未保存 (draftContent ≠ null)" : "已保存/干净"}</b></span>`,
            `<span class="tag">note-a.md: 干净</span>`,
            `<span class="tag">agent.md: 脏点 + Agent 完成状态点共存</span>`,
        ];
        DOM.stateStrip.innerHTML = rows.join("");
    }

    DOM.btnEditB.addEventListener("click", () => {
        DOM.tabB.setAttribute("data-dirty", "true");
        renderTabState();
        // 切到 note-b（模拟用户正在编辑它）
        document.querySelectorAll(".inline-tab-block-tab").forEach((t) => t.classList.remove("active"));
        DOM.tabB.classList.add("active");
    });
    DOM.btnSaveB.addEventListener("click", () => {
        DOM.tabB.setAttribute("data-dirty", "false");
        renderTabState();
    });
    DOM.btnResetDemo.addEventListener("click", () => {
        document.querySelectorAll(".inline-tab-block-tab").forEach((t) => t.classList.remove("active"));
        document.querySelector('.inline-tab-block-tab[data-block="note-a.md"]').classList.add("active");
        DOM.tabB.setAttribute("data-dirty", "false");
        renderTabState();
    });
    // tab 点击：切换 active
    document.querySelectorAll(".inline-tab-block-tab-button").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".inline-tab-block-tab").forEach((t) => t.classList.remove("active"));
            btn.closest(".inline-tab-block-tab").classList.add("active");
        });
    });

    // ---------- 场景二：冲突弹窗 + 复制差异 ----------
    const BASE = "# Hello\n- 第一行\n- 第二行";
    const MINE = "# Hello\n- 第一行\n- 第二行\n- 我新增的第三行";
    const THEIRS = "# Hello\n- 第一行\n- Agent 改写第二行";
    const PATH = "notes/note-b.md";

    const conflictModal = document.getElementById("conflictModal");
    const copyOutput = document.getElementById("copyOutput");
    const copyOutputText = document.getElementById("copyOutputText");

    function closeModal() {
        conflictModal.hidden = true;
    }

    document.getElementById("btnTriggerConflict").addEventListener("click", () => {
        conflictModal.hidden = false;
    });

    conflictModal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    document.getElementById("btnCancel").addEventListener("click", closeModal);
    document.getElementById("btnDiscard").addEventListener("click", () => {
        closeModal();
        copyOutput.hidden = true;
        // 模拟：放弃 → 重载磁盘为 theirs
        DOM.tabB.setAttribute("data-dirty", "false");
        renderTabState();
    });
    document.getElementById("btnOverwrite").addEventListener("click", () => {
        closeModal();
        copyOutput.hidden = true;
        // 模拟：覆盖 → 草稿落盘，脏点消失
        DOM.tabB.setAttribute("data-dirty", "false");
        renderTabState();
    });

    // ---------- 复制差异（Part C：conflict-copy.ts 输出格式）----------
    const buildConflictCopyText = (path, base, mine, theirs) => {
        const unidiff = (aName, bName, a, b) => {
            // 简化演示用统一 diff（真实实现用 jsdiff createTwoFilesPatch）
            const aLines = a.split("\n");
            const bLines = b.split("\n");
            const out = [`--- a/${aName} (base)`, `+++ b/${bName}`];
            let hunk = [];
            let removed = 0;
            let added = 0;
            const max = Math.max(aLines.length, bLines.length);
            for (let i = 0; i < max; i++) {
                const al = aLines[i];
                const bl = bLines[i];
                if (al === bl) {
                    if (hunk.length === 0) {
                        hunk.push(` ${al}`);
                    }
                    hunk.push(` ${al}`);
                    if (hunk.length >= 8) {
                        out.push(`@@ -${1 + i - hunk.length} +${1 + i - hunk.length} @@`);
                        out.push(...hunk);
                        hunk = [];
                    }
                } else {
                    if (hunk.length === 0) {
                        out.push(`@@ -${1 + i - removed} +${1 + i - added} @@`);
                    }
                    if (al !== undefined) { out.push(`-${al}`); removed++; }
                    if (bl !== undefined) { out.push(`+${bl}`); added++; }
                }
            }
            if (hunk.length > 0) {
                out.push(`@@ -${1 + Math.max(0, max - hunk.length)} +${1 + Math.max(0, max - hunk.length)} @@`);
                out.push(...hunk);
            }
            return out.join("\n");
        };
        return [
            `文件冲突: ${path}`,
            "该文件在你编辑期间被外部修改（可能是 AI Agent），你的未保存修改与磁盘当前内容冲突。",
            "",
            "---",
            "",
            "== 你的未保存修改 (base → 你的草稿) ==",
            "",
            unidiff(path, "your draft", base, mine),
            "",
            "== 外部修改 (base → 磁盘当前) ==",
            "",
            unidiff(path, "current disk", base, theirs),
            "",
            "---",
            "",
            "请分析两处修改，输出合并后的完整文件内容。",
        ].join("\n");
    };

    document.getElementById("btnCopyDiff").addEventListener("click", async () => {
        const text = buildConflictCopyText(PATH, BASE, MINE, THEIRS);
        copyOutputText.textContent = text;
        copyOutput.hidden = false;
        try {
            await navigator.clipboard.writeText(text);
            btnCopyDiffFeedback(true);
        } catch {
            btnCopyDiffFeedback(false);
        }
        closeModal();
    });

    document.getElementById("btnDismissCopy").addEventListener("click", () => {
        copyOutput.hidden = true;
    });

    function btnCopyDiffFeedback(ok) {
        const btn = document.getElementById("btnCopyDiff");
        const original = btn.innerHTML;
        btn.innerHTML = ok
            ? '<i class="fa-solid fa-check"></i> 已复制'
            : '<i class="fa-solid fa-triangle-exclamation"></i> 复制失败（浏览器限制）';
        setTimeout(() => { btn.innerHTML = original; }, 1600);
    }

    // 键盘：ESC 关闭弹窗
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
    });

    // 初始渲染
    renderTabState();
})();