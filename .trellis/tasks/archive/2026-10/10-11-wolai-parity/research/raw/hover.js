(() => {
  const root = document.querySelector('.mac-editor');
  const blocks = [...root.querySelectorAll('[data-block-type]')];
  const target = blocks.find(b => b.getAttribute('data-block-type') === 'text' && (b.innerText||'').trim().length > 3) || blocks[0];
  const r = target.getBoundingClientRect();
  const opt = {bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10};
  target.dispatchEvent(new MouseEvent('mouseover', opt));
  target.dispatchEvent(new MouseEvent('mouseenter', opt));
  target.dispatchEvent(new MouseEvent('mousemove', opt));
  const rootWrap = target.closest('.node-container') || target;
  // capture everything that became visible in the block row
  const grab = (sel) => [...rootWrap.querySelectorAll(sel)].map(e => {
    const g = getComputedStyle(e), b = e.getBoundingClientRect();
    return {cls: ('' + e.className).slice(0, 90), html: e.outerHTML.replace(/\s+/g,' ').slice(0, 500),
      opacity: g.opacity, disp: g.display, vis: g.visibility, transform: g.transform,
      w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y)};
  });
  return JSON.stringify({targetType: target.getAttribute('data-block-type'), targetText: (target.innerText||'').slice(0,40),
    targetRect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
    wrapHTML: rootWrap.outerHTML.replace(/\s+/g,' ').slice(0, 3000),
    candidates: grab('*').filter(c => c.w < 60 && c.h < 60 && c.w > 0)});
})()
