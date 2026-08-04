/* Env Launch Entry 原型交互逻辑 */
(function () {
    // ---------- tab 切换（New Agent / New Terminal）----------
    const tabs = document.querySelectorAll(".tab-btn");
    const panels = document.querySelectorAll(".tab-panel");
    tabs.forEach((btn) => {
        btn.addEventListener("click", () => {
            tabs.forEach((b) => b.classList.remove("active"));
            panels.forEach((p) => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
        });
    });

    // ---------- path 选中 ----------
    document.querySelectorAll(".path-row").forEach((item) => {
        item.addEventListener("click", () => {
            item.parentElement.querySelectorAll(".path-row").forEach((i) => i.classList.remove("sel"));
            item.classList.add("sel");
        });
    });

    // ---------- env 弹窗开合 ----------
    const envModal = document.getElementById("env-modal");
    const openEnv = () => {
        envModal.style.display = "flex";
    };
    const closeEnv = () => {
        envModal.style.display = "none";
    };
    document.querySelectorAll(".icon-btn[data-open-env]").forEach((b) => b.addEventListener("click", openEnv));
    document.getElementById("env-save").addEventListener("click", () => {
        collectCustom();
        closeEnv();
    });
    document.getElementById("env-cancel").addEventListener("click", closeEnv);

    // ---------- Custom env KV 编辑器 ----------
    const customBody = document.getElementById("custom-body");
    const countEl = document.getElementById("custom-count");

    // 敏感 key 子串（镜像真实 envmodal.tsx 的 SENSITIVE_KEY_SUBSTRS）
    const SENSITIVE = ["JWT", "TOKEN", "KEY", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "APIKEY"];

    function isSensitive(key) {
        if (!key) return false;
        const u = key.toUpperCase();
        return SENSITIVE.some((s) => u.includes(s));
    }

    function addRow(key = "", value = "", legacySensitive = false) {
        const row = document.createElement("div");
        row.className = "custom-row";
        row.innerHTML =
            '<input class="custom-input k-input" placeholder="KEY" value="__KEY__">' +
            '<input class="custom-input v-input" placeholder="VALUE" value="__VALUE__">' +
            '<button class="custom-del" title="删除">🗑</button>';
        row.querySelector(".k-input").value = key;
        row.querySelector(".v-input").value = value;
        // 敏感 key 掩码逻辑
        const vInput = row.querySelector(".v-input");
        function applyMask() {
            const k = row.querySelector(".k-input").value;
            if (isSensitive(k)) {
                vInput.setAttribute("type", "password");
                row.dataset.sensitive = "1";
            } else {
                vInput.setAttribute("type", "text");
                delete row.dataset.sensitive;
            }
        }
        row.querySelector(".k-input").addEventListener("input", applyMask);
        applyMask();
        row.querySelector(".custom-del").addEventListener("click", () => {
            row.remove();
            updateCount();
        });
        customBody.appendChild(row);
        updateCount();
    }

    function updateCount() {
        const rows = customBody.querySelectorAll(".custom-row");
        let n = 0;
        rows.forEach((r) => {
            if (r.querySelector(".k-input").value.trim()) n++;
        });
        countEl.textContent = n;
    }

    document.querySelectorAll(".custom-row").forEach((r) => r.remove());
    // 预置示例：两行浅色 Codex 主题预设 + 一行空行
    addRow("COLORTERM", "truecolor");
    addRow("TERM", "xterm-256color");
    addRow("", "");

    document.getElementById("add-custom").addEventListener("click", () => addRow("", ""));
    customBody.addEventListener("input", updateCount);

    // Copy All（模拟只读上半区）
    document.getElementById("copy-all").addEventListener("click", () => {
        const rows = Array.from(customBody.querySelectorAll(".custom-row"))
            .filter((r) => r.querySelector(".k-input").value.trim())
            .map((r) => `${r.querySelector(".k-input").value}=${r.querySelector(".v-input").value}`)
            .join("\n");
        alert("复制（原型模拟）:\n" + rows);
    });

    // Show All / Hide All（原型仅示意）
    document.getElementById("reveal-all").addEventListener("click", () => {
        document.querySelectorAll(".env-row").forEach((r) => {
            const m = r.querySelector(".mask");
            if (m) m.textContent = m.dataset.plain || "";
        });
    });
    document.getElementById("hide-all").addEventListener("click", () => {
        document.querySelectorAll(".env-row .mask").forEach((m) => {
            m.dataset.plain = m.textContent;
            m.textContent = "••••••••";
        });
        // 记录原文
        document.querySelectorAll(".env-row").forEach((r) => {
            const m = r.querySelector(".mask");
            if (m && !m.dataset.orig) m.dataset.orig = m.textContent;
        });
        document.querySelectorAll(".env-row .mask").forEach((m) => {
            if (!m.dataset.orig) m.dataset.orig = "••••••••";
        });
    });

    // 把自定义编辑器收集结果回写到示例行（Save 演示）
    function collectCustom() {
        // 真实实现走 RPC 写入 block cmd:env；原型仅弹提示
        const rows = Array.from(customBody.querySelectorAll(".custom-row"))
            .map((r) => {
                const k = r.querySelector(".k-input").value.trim();
                const v = r.querySelector(".v-input").value.trim();
                return k ? `${k}=${v}` : null;
            })
            .filter(Boolean);
        const el = document.getElementById("saved-tip");
        el.textContent = rows.length
            ? "已保存本次启动自定义变量: " + rows.join("  ")
            : "未定义自定义变量";
    }
})();