/* 原型交互 — 模拟后端 ScanShells + GetConfiguredShellPath 行为。
 *
 * 真实链路:        Settings 打开 → wsh client getshells RPC → ScanShells()
 * 原型:             setTimeout 模拟异步,直接给一段 mock 数据。
 *
 * 这里只演示原型可见的部分:
 *   1. 扫描动画 + 异步填充 Discovered 列表
 *   2. WSL 列举超时(1.5s)被跳过 → 显示 skip-note
 *   3. 自动选中 Auto 项 + 括号里展示 Auto 实际指向
 *   4. 选中 Custom → 展开 Custom 入口 + Validate 按钮
 *   5. Validate 通过/失败 → inline status
 *   6. Save → footer-status 反馈
 *   7. 启动失败 fallback → toast(用一个按钮触发模拟)
 */

const SCAN_DELAY_MS = 700;
const WSL_TIMEOUT_MS = 1500;

// 假装这是 ScanShells() 在 Windows 上的返回(不含 WSL,因为超时被跳过)
// 跟 pkg/util/shellutil/scanshells.go 设计的 ShellEntry 结构对应
const MOCK_DISCOVERED = [
    {
        id: "pwsh",
        label: "PowerShell 7.4.1",
        path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        category: "powershell",
    },
    {
        id: "powershell",
        label: "Windows PowerShell 5.1",
        path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        category: "powershell",
    },
    {
        id: "cmd",
        label: "Command Prompt",
        path: "C:\\Windows\\System32\\cmd.exe",
        category: "cmd",
    },
    {
        id: "gitbash",
        label: "Git Bash 4.4.23",
        path: "C:\\Program Files\\Git\\bin\\bash.exe",
        category: "bash",
    },
];

// 假装这是 DetectLocalShellPath() 的返回值,Auto 选项括号显示的就是它
const MOCK_AUTO_RESOLVED = {
    label: "PowerShell 7.4.1",
    path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
};

// 假装这是已知存在的可执行文件(供 Custom Validate 用)
const MOCK_KNOWN_EXISTING = new Set([
    "c:\\program files\\git\\bin\\bash.exe",
    "c:\\program files\\powershell\\7\\pwsh.exe",
    "c:\\windows\\system32\\cmd.exe",
    "c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe",
]);

function $(id) {
    return document.getElementById(id);
}

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

function makeRow(entry) {
    const label = el("label", "shell-row");
    label.dataset.id = entry.id;

    const input = el("input");
    input.type = "radio";
    input.name = "defaultshell";
    input.value = entry.id;

    const radio = el("span", "row-radio");
    const main = el("div", "row-main");
    const lbl = el("div", "row-label", entry.label);
    const meta = el("div", "row-meta");
    meta.appendChild(el("span", "meta-shell-name", entry.path));
    main.appendChild(lbl);
    main.appendChild(meta);
    const path = el("span", "row-path", entry.path);
    path.title = entry.path;

    label.appendChild(input);
    label.appendChild(radio);
    label.appendChild(main);
    label.appendChild(path);

    label.addEventListener("click", () => {
        input.checked = true;
        onSelectionChange(entry.id);
    });

    return label;
}

function fillAutoHint() {
    $("auto-resolve-name").textContent = MOCK_AUTO_RESOLVED.label;
    $("row-meta-auto").querySelector(".meta-shell-name").textContent = MOCK_AUTO_RESOLVED.path;
    $("row-path-auto").textContent = MOCK_AUTO_RESOLVED.path;
    $("row-path-auto").title = MOCK_AUTO_RESOLVED.path;
}

function showScanning(show) {
    $("scanning-row").hidden = !show;
}

function fillDiscovered() {
    const container = $("discovered-rows");
    container.innerHTML = "";
    MOCK_DISCOVERED.forEach((entry) => container.appendChild(makeRow(entry)));
    $("discovered-label").hidden = false;
}

function showWslSkipNote(show) {
    $("wsl-skip-note").hidden = !show;
}

function onSelectionChange(id) {
    const isCustom = id === "custom";
    $("custom-input-block").hidden = !isCustom;
    clearCustomStatus();
}

function clearCustomStatus() {
    const s = $("custom-status");
    s.hidden = true;
    s.textContent = "";
    s.classList.remove("is-ok", "is-error");
    $("custom-path").classList.remove("is-error");
}

function setCustomStatus(text, kind) {
    const s = $("custom-status");
    s.hidden = false;
    s.textContent = text;
    s.classList.remove("is-ok", "is-error");
    s.classList.add(kind === "ok" ? "is-ok" : "is-error");
    if (kind === "error") {
        $("custom-path").classList.add("is-error");
    } else {
        $("custom-path").classList.remove("is-error");
    }
}

function validateCustomPath() {
    const raw = $("custom-path").value.trim();
    if (!raw) {
        setCustomStatus("路径不能为空。", "error");
        return false;
    }
    if (MOCK_KNOWN_EXISTING.has(raw.toLowerCase())) {
        setCustomStatus("校验通过 — 路径存在且可执行。", "ok");
        return true;
    }
    setCustomStatus("找不到该路径或不可执行,保存前请修正。", "error");
    return false;
}

function currentSelection() {
    const checked = document.querySelector('input[name="defaultshell"]:checked');
    return checked ? checked.value : "auto";
}

function attemptSave() {
    const sel = currentSelection();
    if (sel === "custom") {
        if (!validateCustomPath()) {
            setFooterStatus("Custom path 校验失败,无法保存。", true);
            return;
        }
    }
    const label =
        sel === "auto"
            ? `Auto detect (${MOCK_AUTO_RESOLVED.label})`
            : MOCK_DISCOVERED.find((e) => e.id === sel)?.label || "Custom path";
    setFooterStatus(`已保存。新建 terminal block 默认使用:${label}`, false);
}

function setFooterStatus(text, isError) {
    const s = $("footer-status");
    s.hidden = false;
    s.textContent = text;
    s.classList.toggle("has-error", !!isError);
}

function showToast(text) {
    const t = $("toast");
    $("toast-text").textContent = text;
    t.hidden = false;
}

function hideToast() {
    $("toast").hidden = true;
}

function init() {
    fillAutoHint();
    showScanning(true);

    // 模拟 ScanShells()
    setTimeout(() => {
        showScanning(false);
        fillDiscovered();
    }, SCAN_DELAY_MS);

    // 模拟 WSL 列举超时 → 跳过,显示 skip-note
    setTimeout(() => {
        showWslSkipNote(true);
    }, WSL_TIMEOUT_MS);

    // 单选变更
    document.querySelectorAll('input[name="defaultshell"]').forEach((input) => {
        input.addEventListener("change", () => onSelectionChange(input.value));
    });

    // Validate 按钮
    $("btn-validate").addEventListener("click", validateCustomPath);

    // Custom input 失焦也校验一次
    $("custom-path").addEventListener("blur", validateCustomPath);

    $("btn-save").addEventListener("click", attemptSave);

    $("btn-cancel").addEventListener("click", () => setFooterStatus("已取消,改动未保存。", false));

    // toast 上的 Configure 按钮模拟链路回到 Settings(原型已经在 Settings,所以这里关 toast)
    $("toast-action").addEventListener("click", hideToast);

    // 演示 fallback toast:5 秒后弹一下"启动失败回退 auto"
    // 真实链路是 shellcontroller 拉子进程失败时发 WPS event → frontend toast
    setTimeout(() => {
        showToast(
            "Configured shell 'Git Bash' not found on this machine, fell back to PowerShell."
        );
    }, 6500);
}

document.addEventListener("DOMContentLoaded", init);
