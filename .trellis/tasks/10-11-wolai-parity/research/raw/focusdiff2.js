(() => {
  const root = document.querySelector('.mac-editor');
  const b = window.__ft;
  const inner = b.querySelector('.content-editable');
  const g1 = getComputedStyle(b), g2 = inner?getComputedStyle(inner):null;
  const wrap = b.closest('.node-container');
  const gw = wrap?getComputedStyle(wrap):null;
  return JSON.stringify({label:'after-focus', activeIsTarget: document.activeElement===inner,
    block: {bg:g1.backgroundColor, col:g1.color, pad:g1.padding, br:g1.borderRadius, outline:g1.outline, boxShadow:g1.boxShadow, border:g1.border},
    inner: g2?{col:g2.color, fs:g2.fontSize, lh:g2.lineHeight, fw:g2.fontWeight, pad:g2.padding, bg:g2.backgroundColor, border:g2.border, outline:g2.outline, boxShadow:g2.boxShadow, caretColor:g2.caretColor, opacity:g2.opacity}:null,
    wrap: gw?{bg:gw.backgroundColor, style:(wrap.getAttribute('style')||''), br:gw.borderRadius}:null,
    outerHTMLhead: b.outerHTML.replace(/\s+/g,' ').slice(0,300)});
})()
