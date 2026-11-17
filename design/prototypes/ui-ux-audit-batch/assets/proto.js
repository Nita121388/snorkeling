/* Snorkeling UI/UX Audit Batch — shared prototype behaviour.
   Kept dependency-free so every page works from file:// */

(function () {
    const KEY = "snorkeling-ux-audit-theme";

    function readTheme() {
        const param = new URLSearchParams(location.search).get("theme");
        if (param === "light" || param === "dark") return param;
        const saved = localStorage.getItem(KEY);
        if (saved === "light" || saved === "dark") return saved;
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        const btn = document.querySelector("[data-theme-toggle]");
        if (btn) btn.textContent = theme === "light" ? "☀ Light" : "☾ Dark";
        localStorage.setItem(KEY, theme);
    }

    function toggleTheme() {
        applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
    }

    // theme before first paint (script is loaded in <head> with defer omitted)
    applyTheme(readTheme());

    document.addEventListener("DOMContentLoaded", function () {
        applyTheme(readTheme());

        document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
            btn.addEventListener("click", toggleTheme);
        });

        // generic toggle switches
        document.querySelectorAll(".tg-switch").forEach(function (sw) {
            sw.addEventListener("click", function () {
                sw.classList.toggle("on");
                const label = sw.getAttribute("data-label");
                if (label) {
                    const out = document.querySelector(sw.getAttribute("data-out"));
                    if (out) out.textContent = sw.classList.contains("on") ? "ON" : "OFF";
                }
            });
        });

        // generic segmented controls: [data-seg] > button[data-seg-value]
        document.querySelectorAll("[data-seg]").forEach(function (seg) {
            const targetSel = seg.getAttribute("data-seg-target");
            seg.querySelectorAll("[data-seg-value]").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    seg.querySelectorAll("[data-seg-value]").forEach(function (b) {
                        b.classList.remove("seg-on");
                    });
                    btn.classList.add("seg-on");
                    if (targetSel) {
                        const target = document.querySelector(targetSel);
                        if (target) target.setAttribute("data-seg-state", btn.getAttribute("data-seg-value"));
                    }
                });
            });
        });

        // reveal-on-hover helper for demo rows
        document.querySelectorAll("[data-copy]").forEach(function (el) {
            el.addEventListener("click", function () {
                const text = el.getAttribute("data-copy");
                if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
                const old = el.getAttribute("data-copy-label") || el.textContent;
                el.textContent = "Copied";
                setTimeout(function () { el.textContent = old; }, 900);
            });
        });
    });

    window.protoTheme = { apply: applyTheme, toggle: toggleTheme };
})();
