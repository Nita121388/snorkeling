(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error:'no editor'});
  const g = (n) => { const c = getComputedStyle(n); const r = n.getBoundingClientRect(); return {
    fs:c.fontSize, lh:c.lineHeight, ff:c.fontFamily.slice(0,40), pad:[c.paddingTop,c.paddingRight,c.paddingBottom,c.paddingLeft].join(' '),
    mar:[c.marginTop,c.marginRight,c.marginBottom,c.marginLeft].join(' '), br:c.borderRadius, bg:c.backgroundColor, col:c.color, w:Math.round(r.width), h:Math.round(r.height) }; };
  const out = {};
  const code = root.querySelector('[data-block-type=code]');
  if (code) {
    out.code = {html: code.outerHTML.replace(/\s+/g,' ').slice(0, 5000),
      outer: g(code),
      inner: [...code.querySelectorAll('*')].slice(0, 25).map(e => ({tag:e.tagName, cls:(''+e.className).slice(0,50), txt:(e.innerText||'').slice(0,30), style:g(e)}))};
  }
  // nested list structure: find list blocks whose parent has padding-left
  const lists = [];
  for (const b of root.querySelectorAll('[data-block-type=bullList],[data-block-type=enumList],[data-block-type=todoList],[data-block-type=toggleList]')) {
    const wrap = b.closest('[data-area]') || b.parentElement;
    const indent = parseFloat(getComputedStyle(b).paddingLeft) || 0;
    const marker = b.parentElement.querySelector('[class*=node-btn]');
    lists.push({type: b.getAttribute('data-block-type'), text:(b.innerText||'').slice(0,30),
      blockPadLeft: getComputedStyle(b).paddingLeft, innerPadLeft: (b.querySelector('.content-editable')?getComputedStyle(b.querySelector('.content-editable')).paddingLeft:null),
      wrapCls: (''+wrap.className).slice(0,60), wrapStyle: (wrap.getAttribute('style')||'').slice(0,120),
      wrapPadLeft: getComputedStyle(wrap).paddingLeft,
      markerHTML: marker ? marker.outerHTML.replace(/\s+/g,' ').slice(0,350) : null});
    if (lists.length >= 12) break;
  }
  out.lists = lists;
  // toggle arrow / collapsed state
  const tg = root.querySelector('[data-block-type=toggleList]');
  out.toggle = tg ? {html: tg.parentElement.outerHTML.replace(/\s+/g,' ').slice(0,1800)} : null;
  return JSON.stringify(out);
})()
