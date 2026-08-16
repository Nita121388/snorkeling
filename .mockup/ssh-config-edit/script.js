/**
 * SSH Config 快速编辑入口 — 原型交互
 * 镜像真实：frontend/app/modals/conntypeahead.tsx（createBlock 新增 block）
 */

(function () {
    "use strict";

    const editSshItem = document.getElementById("editSshItem");
    const blocksStack = document.getElementById("blocksStack");
    const emptyHint = document.getElementById("emptyHint");
    const connButton = document.getElementById("connButton");
    const connIcon = document.getElementById("connIcon");
    const connNameEl = document.getElementById("connName");
    const switchBtns = document.querySelectorAll(".switch-btn");

    let currentScene = "local";
    let blockCount = 0;

    // ---- 场景数据 ----
    const scenes = {
        local: {
            connDisplayName: "nita-MacBook",
            connIconClass: "fa-solid fa-laptop",
            connIconColor: "var(--color-secondary)",
            connNameClass: "",
            connTitle: "Connected to Local Machine",
            badgeLabel: "本地",
            badgeClass: "badge-local",
            filePath: "~/.ssh/config",
            headerConnClass: "fa-solid fa-laptop",
            headerConnColor: "var(--color-secondary)",
        },
        remote: {
            connDisplayName: "myhost",
            connIconClass: "fa-solid fa-arrow-right-arrow-left",
            connIconColor: "var(--conn-icon-color-2)",
            connNameClass: "remote",
            connTitle: "Connected to myhost",
            badgeLabel: "ssh myhost",
            badgeClass: "badge-remote",
            filePath: "~/.ssh/config  (ssh://myhost)",
            headerConnClass: "fa-solid fa-arrow-right-arrow-left",
            headerConnColor: "var(--conn-icon-color-2)",
        },
    };

    // ---- 切换场景 ----
    function applyScene(sceneName) {
        currentScene = sceneName;
        const s = scenes[sceneName];

        connNameEl.textContent = s.connDisplayName;
        connNameEl.className = "conn-name" + (s.connNameClass ? " " + s.connNameClass : "");
        connIcon.className = s.connIconClass;
        connIcon.style.color = s.connIconColor;
        connButton.title = s.connTitle;

        switchBtns.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.scene === sceneName);
        });
    }

    switchBtns.forEach((btn) => {
        btn.addEventListener("click", () => applyScene(btn.dataset.scene));
    });

    // ---- 新增一个 block（镜像 createBlock + preview 视图） ----
    function addSshConfigBlock() {
        const s = scenes[currentScene];
        blockCount += 1;

        const block = document.createElement("div");
        block.className = "ssh-config-block";
        block.innerHTML = `
            <div class="block-frame-default-header">
                <div class="header-left">
                    <span class="view-icon"><i class="fa-solid fa-file-lines"></i></span>
                    <span class="view-type">preview</span>
                </div>
                <div class="header-center">
                    <div class="conn-button block-conn" title="${s.connTitle}">
                        <span class="fa-stack conn-icon-stack">
                            <i class="${s.headerConnClass} fa-stack-1x" style="color: ${s.headerConnColor}"></i>
                        </span>
                        <span class="conn-name ${s.connNameClass}">${s.connDisplayName}</span>
                    </div>
                </div>
                <div class="header-right"></div>
            </div>
            <div class="preview-editor">
                <div class="preview-toolbar">
                    <div class="preview-breadcrumb">
                        <span class="bc-seg">~</span>
                        <span class="bc-sep">/</span>
                        <span class="bc-seg">.ssh</span>
                        <span class="bc-sep">/</span>
                        <span class="bc-file">config</span>
                    </div>
                    <div class="preview-toolbar-right">
                        <span class="preview-badge ${s.badgeClass}">${s.badgeLabel}</span>
                        <span class="preview-save-hint">Cmd+S 保存</span>
                        <button class="block-close" title="关闭 block" aria-label="close">✕</button>
                    </div>
                </div>
                <div class="preview-code">
                    <pre><span class="line"><span class="kw">Host</span> <span class="val">myhost</span></span>
<span class="line">  <span class="kw">HostName</span>        <span class="val">203.0.113.254</span></span>
<span class="line">  <span class="kw">User</span>            <span class="val">deploy</span></span>
<span class="line">  <span class="kw">Port</span>            <span class="val">22</span></span>
<span class="line">  <span class="kw">IdentityFile</span>    <span class="val">~/.ssh/id_ed25519</span></span>
<span class="line"></span>
<span class="line"><span class="kw">Host</span> <span class="val">dev-server</span></span>
<span class="line">  <span class="kw">HostName</span>        <span class="val">10.0.0.42</span></span>
<span class="line">  <span class="kw">User</span>            <span class="val">dev</span></span>
<span class="line">  <span class="kw">ForwardAgent</span>    <span class="val">yes</span></span>
<span class="line"></span>
<span class="line"><span class="kw">Host</span> <span class="val">*</span></span>
<span class="line">  <span class="kw">AddKeysToAgent</span>  <span class="val">yes</span></span>
<span class="line">  <span class="kw">IdentitiesOnly</span> <span class="val">no</span></span></pre>
                </div>
                <div class="preview-statusbar">
                    <span class="status-file">${s.filePath} · block #${blockCount}</span>
                    <span class="status-pos">Ln 12, Col 1</span>
                </div>
            </div>
        `;

        // 关闭按钮
        block.querySelector(".block-close").addEventListener("click", () => {
            block.remove();
            if (blocksStack.children.length === 0) {
                emptyHint.style.display = "";
            }
        });

        // 新 block 进入动画
        block.classList.add("block-enter");
        emptyHint.style.display = "none";
        blocksStack.appendChild(block);

        // 滚动到新 block
        requestAnimationFrame(() => {
            block.scrollIntoView({ behavior: "smooth", block: "nearest" });
            requestAnimationFrame(() => block.classList.add("block-enter-done"));
        });
    }

    editSshItem.addEventListener("click", addSshConfigBlock);
})();
