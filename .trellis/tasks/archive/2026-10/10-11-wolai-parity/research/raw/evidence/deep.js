(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error: 'no editor'});
  const px = (n) => { const g = getComputedStyle(n); const r = n.getBoundingClientRect(); return {
    fs: g.fontSize, lh: g.lineHeight, fw: g.fontWeight, ff: g.fontFamily.slice(0, 30),
    pad: [g.paddingTop, g.paddingRight, g.paddingBottom, g.paddingLeft].join(' '),
    mar: [g.marginTop, g.marginRight, g.marginBottom, g.marginLeft].join(' '),
    br: g.borderRadius, bg: g.backgroundColor, col: g.color, bd: g.borderTopWidth + '/' + g.borderBottomWidth,
    bl: g.borderLeft, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
    disp: g.display, pos: g.position }; };
  const pseudo = (n, which) => { const g = getComputedStyle(n, which); return {
    content: g.content, w: g.width, h: g.height, bg: g.backgroundColor, bl: g.borderLeft, br: g.borderRadius,
    pos: g.position, left: g.left, top: g.top, mar: g.margin, disp: g.display, fs: g.fontSize, col: g.color }; };
  const out = {};
  const seen = {};
  for (const n of root.querySelectorAll('[data-block-type]')) {
    const t = n.getAttribute('data-block-type');
    if (seen[t] === 2) continue;
    seen[t] = (seen[t] || 0) + 1;
    const ed = n.querySelector('.content-editable, .text-block, [contenteditable]');
    const rec = {outer: px(n), inner: ed ? px(ed) : null,
      innerCls: ed ? (typeof ed.className === 'string' ? ed.className : '').slice(0, 110) : null,
      editable: ed ? ed.getAttribute('contenteditable') : null,
      before: pseudo(n, '::before'), after: pseudo(n, '::after'),
      childrenTags: [...n.children].map(c => c.tagName + '.' + (typeof c.className === 'string' ? c.className : '').slice(0, 50)).slice(0, 8)};
    if (ed) { rec.innerBefore = pseudo(ed, '::before'); rec.innerAfter = pseudo(ed, '::after'); }
    out[t] = out[t] || []; out[t].push(rec);
  }
  // layout containers (columns / rows)
  const layout = [];
  for (const n of root.querySelectorAll('[class*=row], [class*=column], [style*=flex]')) {
    const g = getComputedStyle(n);
    if (g.display.includes('flex') && n.children.length > 1) {
      const r = n.getBoundingClientRect();
      layout.push({cls: ('' + n.className).slice(0, 70), disp: g.display, gap: g.gap, flexWrap: g.flexWrap,
        w: Math.round(r.width), h: Math.round(r.height), kids: n.children.length,
        kidW: [...n.children].map(c => Math.round(c.getBoundingClientRect().width)).slice(0, 6),
        kidStyle: [...n.children].map(c => (c.getAttribute('style') || '').slice(0, 90)).slice(0, 4),
        dataAttrs: [...n.attributes].map(a => a.name).filter(x => x.startsWith('data-')).join(',')});
      if (layout.length > 6) break;
    }
  }
  // list markers
  const lists = [];
  for (const n of root.querySelectorAll('[data-block-type=bullList],[data-block-type=enumList],[data-block-type=todoList],[data-block-type=toggleList]')) {
    const wrap = n.parentElement;
    lists.push({type: n.getAttribute('data-block-type'),
      indent: getComputedStyle(wrap).paddingLeft + '/' + getComputedStyle(wrap).marginLeft,
      markerHTML: (wrap.querySelector('[class*=node-btn],[class*=marker],[class*=action]') || {outerHTML: ''}).outerHTML.slice(0, 420),
      wrapCls: ('' + wrap.className).slice(0, 70),
      wrapStyle: (wrap.getAttribute('style') || '').slice(0, 160)});
    if (lists.length > 14) break;
  }
  // code block internals
  const code = [];
  for (const n of root.querySelectorAll('[data-block-type=code]')) {
    code.push({outer: n.outerHTML.replace(/\s+/g, ' ').slice(0, 2200)});
    if (code.length > 1) break;
  }
  return JSON.stringify({url: location.href, title: document.title, editorVar: [...root.querySelectorAll('*')].length,
    blocks: out, layout, lists, code});
})()
