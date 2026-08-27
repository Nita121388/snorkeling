/* ============================================================
   Snorkling 创建群组 — 交互脚本
   模拟提交，不做真实持久化（原型用途）
   ============================================================ */

const form = document.getElementById('groupCreateForm');
const cancelBtn = document.getElementById('btnCancel');

function showResult(message, isError = false) {
    // 移除旧反馈
    document.querySelector('.create-result')?.remove();
    const el = document.createElement('div');
    el.className = `create-result${isError ? ' is-error' : ''}`;
    el.innerHTML = `<i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>${message}`;
    form.appendChild(el);
}

form.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = document.getElementById('groupName').value.trim();
    const members = document.getElementById('groupMembers').value.trim();
    const desc = document.getElementById('groupDesc').value.trim();

    if (!name) {
        showResult('请输入群组名称', true);
        document.getElementById('groupName').focus();
        return;
    }
    if (name.length < 2 || name.length > 32) {
        showResult('群组名称长度需在 2-32 个字符之间', true);
        return;
    }

    const payload = {
        name,
        description: desc || null,
        members: members ? members.split(',').map((m) => m.trim()).filter(Boolean) : [],
        createdAt: new Date().toISOString(),
    };

    // 原型：模拟成功反馈。真实实现走 window.api.groupChatCreate(payload)
    console.log('[group-create] 提交:', payload);
    showResult(`群组「${name}」创建成功，等待进入群聊界面…`);
    form.querySelectorAll('input').forEach((i) => (i.disabled = true));
    setTimeout(() => {
        form.querySelectorAll('input').forEach((i) => (i.disabled = false));
    }, 1600);
});

cancelBtn.addEventListener('click', () => {
    // 原型：模拟关闭
    console.log('[group-create] 取消');
});