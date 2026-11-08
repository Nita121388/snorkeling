/* ============================================================
   Snorkling 群组成员管理 — 交互脚本
   角色切换 / 移除 / 添加成员弹窗
   ============================================================ */

// ---- 保存角色 ----
document.getElementById('btnSaveSettings')?.addEventListener('click', () => {
    const results = [...document.querySelectorAll('.member-item')].map((row) => ({
        name: row.dataset.name,
        role: row.querySelector('.member-role-select').value,
    }));
    console.log('[group-members] 保存角色:', results);

    // 角色徽章联动
    results.forEach(({ name, role }) => {
        const row = document.querySelector(`.member-item[data-name="${name}"]`);
        const badge = row?.querySelector('.badge');
        if (!badge) return;
        badge.className = 'badge';
        const map = {
            owner: 'badge-owner', moderator: 'badge-moderator', assistant: 'badge-assistant', observer: 'badge-observer',
        };
        badge.classList.add(map[role] || 'badge-observer');
        const labelMap = { owner: '所有者', moderator: '协调员', assistant: '助手', observer: '观察者' };
        badge.textContent = labelMap[role];
    });

    flashSave();
});

function flashSave() {
    const bar = document.createElement('div');
    bar.className = 'create-result';
    bar.innerHTML = '<i class="fa-solid fa-circle-check"></i> 成员设置已保存';
    document.querySelector('.member-actions-bar').before(bar);
    setTimeout(() => bar.remove(), 2500);
}

// ---- 移除成员 ----
document.querySelectorAll('.btn-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        const row = e.currentTarget.closest('.member-item');
        const name = row.dataset.name;
        if (confirm(`确定要将「${name}」移出群组吗？其记忆与角色设置将保留在会话中。`)) {
            row.classList.add('is-removing');
            setTimeout(() => row.remove(), 300);
            console.log(`[group-members] 移除: ${name}`);
        }
    });
});

// ---- 添加成员弹窗 ----
const modal = document.getElementById('addMemberModal');
const addBtn = document.getElementById('btnAddMember');
const confirmBtn = document.getElementById('btnConfirmAdd');
const sessionOpts = document.querySelectorAll('.session-option');

function closeModal() { modal.hidden = true; }

addBtn.addEventListener('click', () => { modal.hidden = false; });
modal.querySelectorAll('[data-close-modal]').forEach((el) => el.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

sessionOpts.forEach((opt) => {
    opt.addEventListener('click', () => opt.classList.toggle('is-selected'));
});

confirmBtn.addEventListener('click', () => {
    const selected = [...sessionOpts].filter((o) => o.classList.contains('is-selected'));
    const manual = document.getElementById('newMemberInput').value.trim();
    const names = [...selected.map((o) => o.querySelector('span:nth-child(2)').textContent)];
    if (manual) names.push(manual);
    if (names.length === 0) {
        alert('请选择至少一位成员');
        return;
    }
    closeModal();
    console.log('[group-members] 添加:', names);
    flashSave();
});