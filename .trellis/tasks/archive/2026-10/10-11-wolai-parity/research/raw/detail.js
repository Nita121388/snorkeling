(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error: 'no .mac-editor', url: location.href});
  const norm = (n) => ({
    tag: n.tagName,
    cls: (typeof n.className === 'string' ? n.className : '').slice(0, 140),
    blockId: n.getAttribute('data-block-id'),
    dataType: n.getAttribute('data-type'),
    blockType: n.getAttribute('data-block-type'),
    area: n.getAttribute('data-area'),
    attrs: [...n.attributes].map(a => a.name).filter(x => x.startsWith('data-')).join(','),
    text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    html: n.outerHTML.replace(/\s+/g, ' ').slice(0, 1400)
  });
  const out = {};
  // one representative per block type
  const byType = {};
  for (const n of root.querySelectorAll('[data-block-type]')) {
    const t = n.getAttribute('data-block-type');
    if (!byType[t]) byType[t] = n;
  }
  for (const [t, n] of Object.entries(byType)) out[t] = norm(n);
  // structural numbers for each representative
  const cs = {};
  for (const [t, n] of Object.entries(byType)) {
    const g = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    cs[t] = {display: g.display, fontSize: g.fontSize, lineHeight: g.lineHeight, fontWeight: g.fontWeight,
      padding: [g.paddingTop, g.paddingRight, g.paddingBottom, g.paddingLeft].join(' '),
      margin: [g.marginTop, g.marginRight, g.marginBottom, g.marginLeft].join(' '),
      borderRadius: g.borderRadius, gap: g.gap, color: g.color, background: g.backgroundColor,
      borderLeft: g.borderLeftWidth + ' ' + g.borderLeftStyle + ' ' + g.borderLeftColor,
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y)};
  }
  return JSON.stringify({url: location.href, title: document.title,
    typesPresent: Object.keys(byType), nodes: out, styles: cs,
    editorBox: (() => { const r = root.getBoundingClientRect(); const g = getComputedStyle(root);
      return {w: Math.round(r.width), x: Math.round(r.x), paddingLeft: g.paddingLeft, paddingRight: g.paddingRight, maxWidth: g.maxWidth}; })()
  });
})()
