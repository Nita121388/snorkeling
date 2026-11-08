/* ============================================================
   Snorkling 群组消息列表 — 交互脚本
   模拟消息渲染 + @mention 触发
   ============================================================ */

// ---- 模拟数据 ----
let messages = [
    {
        id: 1, sender: 'Claude', type: 'agent', text: '大家好，我是本群组的协调员。有什么需要协调的任务吗？',
        time: '10:00', isGroup: true, role: '协调员',
    },
    {
        id: 2, sender: '我', type: 'user', text: '你好 Claude，请帮我把群组当前的任务分配一下。',
        time: '10:02', isGroup: true, role: '',
    },
    {
        id: 3, sender: 'Claude', type: 'agent', text: '@我 好的，我基于产品需求将任务拆分为：\n1. 用户注册流程优化 → @Codex\n2. 支付体验提升 → @Codex\n3. 通知系统完善 → @GPT-4',
        time: '10:05', isGroup: true, role: '协调员',
    },
    {
        id: 4, sender: 'Codex', type: 'agent', text: '收到，我负责 1/2 两项的技术实现方案，稍后输出。',
        time: '10:07', isGroup: true, role: '助手',
    },
];

const listEl = document.getElementById('messagesList');
const inputEl = document.getElementById('messageInput');
const sendBtn = document.getElementById('btnSend');
const mentionEl = document.getElementById('mentionDropdown');

// ---- 渲染 ----
function renderMessages() {
    listEl.innerHTML = '';
    let lastMinute = '';
    for (const m of messages) {
        const marker = document.createElement('div');
        marker.className = 'time-marker';
        marker.textContent = m.time;
        if (m.time.slice(0, 2) !== lastMinute) {
            listEl.appendChild(marker);
            lastMinute = m.time.slice(0, 2);
        }
        const el = document.createElement('div');
        el.className = `message by-${m.type === 'user' ? 'me' : 'agent'}${m.isGroup ? ' is-group' : ''}`;
        // 高亮 @mention
        const htmlText = m.text.replace(/@([\w-]+)/g, '<span class="mention">@$1</span>');
        el.innerHTML = `
            <div class="message-header">
                <span class="msg-sender">${m.sender}</span>
                ${m.role ? `<span class="msg-role badge ${m.role === '协调员' ? 'badge-moderator' : 'badge-assistant'}">${m.role}</span>` : ''}
            </div>
            <div class="message-body">${htmlText}</div>
            <div class="message-time">${m.time}</div>
        `;
        listEl.appendChild(el);
    }
    listEl.scrollTop = listEl.scrollHeight;
}

// ---- 发送 ----
function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    messages.push({
        id: Date.now(), sender: '我', type: 'user', text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isGroup: true, role: '',
    });
    renderMessages();
    // 模拟一个 Agent 回应
    setTimeout(() => {
        messages.push({
            id: Date.now() + 1, sender: 'Claude', type: 'agent', text: `收到「${text.slice(0, 40)}${text.length > 40 ? '…' : ''}」，我稍后处理。`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isGroup: true, role: '协调员',
        });
        renderMessages();
    }, 900);
}

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// ---- @mention ----
let mentionActive = false;
inputEl.addEventListener('input', () => {
    const caretPos = inputEl.selectionStart;
    const before = inputEl.value.slice(0, caretPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx >= 0 && before.slice(atIdx).length <= 12) {
        mentionActive = true;
        mentionEl.hidden = false;
        const rect = inputEl.getBoundingClientRect();
        mentionEl.style.left = Math.min(rect.left + atIdx * 7, window.innerWidth - 240) + 'px';
        mentionEl.style.top = rect.top - 170 + 'px';
    } else {
        mentionActive = false;
        mentionEl.hidden = true;
    }
});
mentionEl.querySelectorAll('.mention-item').forEach((item) => {
    item.addEventListener('click', () => {
        const name = item.dataset.name;
        const before = inputEl.value.slice(0, inputEl.selectionStart);
        const atIdx = before.lastIndexOf('@');
        inputEl.value = inputEl.value.slice(0, atIdx) + `@${name} ` + inputEl.value.slice(inputEl.selectionStart);
        mentionEl.hidden = true;
        inputEl.focus();
    });
});
document.addEventListener('click', (e) => {
    if (!mentionEl.contains(e.target) && mentionActive) {
        mentionEl.hidden = true;
        mentionActive = false;
    }
});

// 初始化
renderMessages();