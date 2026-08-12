/* Env Launch Entry 原型交互逻辑
   镜像真实行为：chip 选择/默认勾选、vendor +N▾ 展开、path 选择、
   env 弹窗（搜索/掩码/reveal/Copy All）+ 新增自定义变量 KV 编辑 */
(function () {
    "use strict";

    // ---------- profile chip：点击选中（单选），DefaultCheckButton 切换默认 ----------
    document.querySelectorAll(".chip[data-profile]").forEach((chip) => {
        chip.addEventListener("click", (event) => {
            const toggle = event.target.closest("[data-default-toggle]");
            if (toggle) {
                // 默认勾选切换（单选：同组内互斥）
                chip.parentElement.querySelectorAll(".chip[data-profile]").forEach((c) => {
                    c.querySelector(".chk").classList.toggle("on", c === chip && !chip.classList.contains("sel"));
                    syncChk(c);
                });
                return;
            }
            // 选中 profile（单选）
            chip.parentElement.querySelectorAll(".chip[data-profile]").forEach((c) => c.classList.remove("sel"));
            chip.classList.add("sel");
        });
    });

    // ---------- vendor chip：点击选中（单选） ----------
    document.querySelectorAll(".chip[data-vendor]").forEach((chip) => {
        chip.addEventListener("click", () => {
            const row = chip.closest("[data-vendor-row]");
            row.querySelectorAll(".chip[data-vendor]").forEach((c) => c.classList.remove("sel"));
            chip.classList.add("sel");
        });
    });

    // ---------- vendor +N▾ 展开/收起 ----------
    const moreBtn = document.querySelector("[data-vendor-more]");
    if (moreBtn) {
        moreBtn.addEventListener("click", () => {
            const expanded = moreBtn.getAttribute("aria-expanded") === "true";
            moreBtn.setAttribute("aria-expanded", String(!expanded));
            moreBtn.querySelector(".more-a").textContent = expanded ? "▾" : "▴";
            document.querySelectorAll(".chip.rest").forEach((c) => {
                c.hidden = expanded;
            });
        });
    }

    // ---------- path row：点击选中（单选），默认勾选切换 ----------
    document.querySelectorAll(".path-row").forEach((row) => {
        row.addEventListener("click", (event) => {
            const toggle = event.target.closest("[data-default-toggle]");
            if (toggle) {
                row.parentElement.querySelectorAll(".path-row").forEach((r) => {
                    r.querySelector(".chk").classList.toggle("on", r === row && !row.classList.contains("sel"));
                    syncChk(r);
                });
                return;
            }
            row.parentElement.querySelectorAll(".path-row").forEach((r) => r.classList.remove("sel"));
            row.classList.add("sel");
        });
    });

    // chk 内部元素切换：选中 → check 图标；未选中 → 空方块
    function syncChk(el) {
        const chk = el.querySelector(".chk");
        if (!chk) return;
        const isOn = chk.classList.contains("on");
        chk.innerHTML = isOn ? '<i class="fa-solid fa-check"></i>' : '<span class="chk-box"></span>';
    }

    // ---------- env 弹窗开合 ----------
    const overlay = document.getElementById("env-overlay");
    document.querySelectorAll("[data-open-env]").forEach((btn) => {
        btn.addEventListener("click", () => {
            overlay.hidden = false;
            document.getElementById("saved-tip").textContent = "";
        });
    });
    document.getElementById("env-cancel").addEventListener("click", () => {
        overlay.hidden = true;
    });
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) overlay.hidden = true;
    });

    // ---------- 生效 env：搜索过滤 ----------
    const searchEl = document.getElementById("env-search");
    const liveRows = Array.from(document.querySelectorAll("#live-env .env-row:not(.env-row-header)"));
    searchEl.addEventListener("input", () => {
        const q = searchEl.value.trim().toUpperCase();
        liveRows.forEach((row) => {
            row.hidden = q ? !(row.textContent.toUpperCase().includes(q)) : false;
        });
    });

    // ---------- 生效 env：Copy All（模拟） ----------
    document.getElementById("copy-all").addEventListener("click", () => {
        const lines = liveRows
            .filter((r) => !r.hidden)
            .map((r) => {
                const k = r.querySelector(".env-key").childNodes[0].textContent.trim();
                const v = r.querySelector(".env-value-text").textContent;
                return `${k}=${v}`;
            })
            .join("\n");
        alert("复制（原型模拟，真实走 clipboard）：\n\n" + lines);
    });

    // ---------- 生效 env：Show All / Hide All（敏感行） ----------
    function maskRow(row) {
        const text = row.querySelector(".env-value-text");
        if (!text.dataset.plain) text.dataset.plain = text.textContent;
        text.textContent = "••••••••";
        row.querySelector(".env-reveal").innerHTML = '<i class="fa-sharp fa-solid fa-eye"></i>';
    }
    function unmaskRow(row) {
        const text = row.querySelector(".env-value-text");
        if (text.dataset.plain) text.textContent = text.dataset.plain;
        row.querySelector(".env-reveal").innerHTML = '<i class="fa-sharp fa-solid fa-eye-slash"></i>';
    }
    liveRows.forEach((row) => {
        if (row.dataset.sensitive) {
            row.dataset.plainValue = row.querySelector(".env-value-text").textContent;
            maskRow(row);
            row.querySelector(".env-reveal").addEventListener("click", () => {
                const text = row.querySelector(".env-value-text");
                if (text.textContent === "••••••••") unmaskRow(row);
                else maskRow(row);
            });
        }
    });
    document.getElementById("show-all").addEventListener("click", () => {
        liveRows.forEach((r) => r.dataset.sensitive && unmaskRow(r));
    });
    document.getElementById("hide-all").addEventListener("click", () => {
        liveRows.forEach((r) => r.dataset.sensitive && maskRow(r));
    });

    // ---------- 自定义变量 KV 编辑器 ----------
    const customBody = document.getElementById("custom-body");
    const countEl = document.getElementById("custom-count");

    // 敏感 key 子串（镜像真实 envmodal.tsx SENSITIVE_KEY_SUBSTRS）
    const SENSITIVE = ["JWT", "TOKEN", "KEY", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "APIKEY"];
    function isSensitive(key) {
        if (!key) return false;
        const u = key.toUpperCase();
        return SENSITIVE.some((s) => u.includes(s));
    }

    function addRow(key, value) {
        const row = document.createElement("div");
        row.className = "custom-row";
        row.innerHTML =
            '<input class="custom-input k-input" placeholder="KEY" spellcheck="false">' +
            '<input class="custom-input v-input" placeholder="VALUE" spellcheck="false">' +
            '<button type="button" class="custom-del" title="删除此行">🗑</button>';
        row.querySelector(".k-input").value = key || "";
        row.querySelector(".v-input").value = value || "";
        const vInput = row.querySelector(".v-input");

        function applyMask() {
            const k = row.querySelector(".k-input").value;
            if (isSensitive(k)) {
                vInput.type = "password";
                vInput.classList.add("masked");
            } else {
                vInput.type = "text";
                vInput.classList.remove("masked");
            }
        }
        row.querySelector(".k-input").addEventListener("input", applyMask);
        row.querySelector(".custom-del").addEventListener("click", () => {
            row.remove();
            updateCount();
        });
        customBody.appendChild(row);
        applyMask();
        updateCount();
    }

    function updateCount() {
        let n = 0;
        customBody.querySelectorAll(".custom-row").forEach((r) => {
            if (r.querySelector(".k-input").value.trim()) n++;
        });
        countEl.textContent = `（${n} 项）`;
    }

    // 预置示例：Codex 浅色主题修复的 COLORTERM/TERM + 一行空行
    addRow("COLORTERM", "truecolor");
    addRow("TERM", "xterm-256color");
    addRow("", "");
    customBody.addEventListener("input", updateCount);

    document.getElementById("add-custom").addEventListener("click", () => addRow("", ""));

    // ---------- crumb 尾部省略（镜像真实 MiddleEllipsis variant="tail"：省略开头保留末尾） ----------
    document.querySelectorAll(".crumb").forEach((crumb) => {
        if (crumb.scrollWidth <= crumb.clientWidth) return;
        const text = crumb.textContent;
        const ellipsis = "…";
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:inherit";
        crumb.appendChild(probe);
        probe.textContent = ellipsis;
        const ellipsisW = probe.getBoundingClientRect().width;
        const available = crumb.clientWidth;
        let lo = 0;
        let hi = text.length - 1;
        const fits = (n) => {
            probe.textContent = text.slice(text.length - n);
            return ellipsisW + probe.getBoundingClientRect().width <= available;
        };
        while (lo < hi) {
            const mid = Math.ceil((lo + hi + 1) / 2);
            if (fits(mid)) lo = mid;
            else hi = mid - 1;
        }
        crumb.removeChild(probe);
        crumb.textContent = ellipsis + text.slice(text.length - lo);
    });

    // ---------- Save（模拟；真实走 SaveBlockEnvCommand 写 block cmd:env） ----------
    document.getElementById("env-save").addEventListener("click", () => {
        const rows = Array.from(customBody.querySelectorAll(".custom-row"))
            .map((r) => {
                const k = r.querySelector(".k-input").value.trim();
                const v = r.querySelector(".v-input").value.trim();
                return k ? `${k}=${v}` : null;
            })
            .filter(Boolean);
        const tip = document.getElementById("saved-tip");
        tip.textContent = rows.length
            ? "✓ 已保存本次启动自定义变量: " + rows.join("  ")
            : "未定义自定义变量（将只使用默认 env）";
        setTimeout(() => { overlay.hidden = true; }, 900);
    });
})();
