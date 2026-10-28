/* ============================================================
   AISessions 折叠重设计原型 —— 交互
   - 点击折叠卡头部切换 open
   - 键盘 Enter / Space 同样可切换（无障碍）
   - 运行中计时器演示
   ============================================================ */

(function () {
    "use strict";

    // ---- 折叠 / 展开 ----
    function toggleCard(card) {
        card.classList.toggle("open");
    }

    document.querySelectorAll("[data-fold]").forEach(function (card) {
        var head = card.querySelector(":scope > .fold-head");
        if (!head) return;

        // 点击头部（排除「打开」按钮自身的点击）
        head.addEventListener("click", function (e) {
            if (e.target.closest("[data-open-session]")) return;
            toggleCard(card);
        });

        // 键盘
        head.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleCard(card);
            }
        });
    });

    // ---- 「打开子会话」按钮：仅给出反馈，不跳转 ----
    document.querySelectorAll("[data-open-session]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            var original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 已打开';
            setTimeout(function () {
                btn.innerHTML = original;
            }, 1200);
        });
    });

    // ---- 运行中计时器：让「运行中…」每秒变化，演示真实感 ----
    document.querySelectorAll("[data-timer]").forEach(function (el) {
        var start = Date.now();
        setInterval(function () {
            var sec = Math.floor((Date.now() - start) / 1000);
            el.textContent = "运行中 · " + sec + "s";
        }, 1000);
    });
})();
