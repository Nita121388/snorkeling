// pi 启动提示解读 · 交互
// 功能：复制按钮、修复后整行 description 的复制

document.addEventListener('DOMContentLoaded', () => {
  // data-copy：复制固定字符串
  document.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const txt = btn.dataset.copy;
      await copyText(txt, btn);
    });
  });

  // data-copy-line：从页面上的代码行提取复制（跳过行号）
  document.querySelectorAll('.copy-btn[data-copy-line]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.copyLine;
      const block = btn.closest('.code-block');
      const pre = block ? block.querySelector('pre') : null;
      let txt = '';
      if (pre) {
        // 克隆后去掉行号 span，再取纯文本（保留行内高亮标记的文本）
        const clone = pre.cloneNode(true);
        clone.querySelectorAll('.ln').forEach(n => n.remove());
        const all = clone.textContent || '';
        // 只取包含该键名的那一行（去掉 frontmatter 的 --- 分隔线）
        txt = all.split('\n').find(l => l.includes(key)) || all;
      }
      if (!txt) txt = key;
      await copyText(txt.trim(), btn);
    });
  });

  async function copyText(txt, btn) {
    try {
      await navigator.clipboard.writeText(txt);
      flash(btn, '已复制 ✓');
    } catch (e) {
      // 兜底：兼容非 secure context
      const ta = document.createElement('textarea');
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); flash(btn, '已复制 ✓'); }
      catch { flash(btn, '复制失败'); }
      document.body.removeChild(ta);
    }
  }

  function flash(btn, msg) {
    const old = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = old;
      btn.classList.remove('done');
    }, 1500);
  }
});
