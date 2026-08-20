/* ============================================================
   Snorkling 主持模式配置 — 交互脚本
   ============================================================ */

const switchEl = document.getElementById('moderatorSwitch');
const modeSection = document.getElementById('modeSection');
const toggleLabel = document.getElementById('toggleLabel');
const toggleSub = document.getElementById('toggleSub');
const selectEl = document.getElementById('moderatorSelect');

// 当前配置
const config = { enabled: true, mode: 'select', moderator: 'claude-s1' };

// ---- 主持模式开关 ----
switchEl.addEventListener('change', () => {
    config.enabled = switchEl.checked;
    if (switchEl.checked) {
        modeSection.style.opacity = '1';
        modeSection.style.pointerEvents = 'auto';
        toggleLabel.textContent = '主持模式已开启';
    } else {
        modeSection.style.opacity = '0.35';
        modeSection.style.pointerEvents = 'none';
        toggleLabel.textContent = '主持模式已关闭';
        toggleSub.textContent = '所有消息将由所有 Agent 并行处理';
    }
    updateToggleSub();
});

// ---- 模式选择 ----
document.querySelectorAll('.mode-card input').forEach((radio) => {
    radio.addEventListener('change', (e) => {
        config.mode = e.target.value;
        document.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('is-selected'));
        e.target.closest('.mode-card').classList.add('is-selected');
        updateToggleSub();
    });
});

// ---- 主持人选择 ----
selectEl.addEventListener('change', () => {
    config.moderator = selectEl.value;
    updateToggleSub();
});

function updateToggleSub() {
    if (!config.enabled) {
        toggleSub.textContent = '所有消息将由所有 Agent 并行处理';
        return;
    }
    const name = selectEl.options[selectEl.selectedIndex].text.split(' · ')[0];
    const modeName = { select: '精选模式', route: '路由模式', filter: '过滤模式' }[config.mode];
    toggleSub.textContent = `${name} · ${modeName}`;
}

// ---- 保存配置 ----
document.getElementById('btnSaveConfig').addEventListener('click', () => {
    console.log('[moderator-setup] 保存配置:', config);
    const bar = document.createElement('div');
    bar.className = 'create-result';
    bar.innerHTML = `<i class="fa-solid fa-circle-check"></i> 配置已保存：${config.enabled ? '开启' : '关闭'} · 模式: ${config.mode} · 主持人: ${config.moderator}`;
    document.querySelector('.footer-bar').prepend(bar);
    setTimeout(() => bar.remove(), 3000);
});