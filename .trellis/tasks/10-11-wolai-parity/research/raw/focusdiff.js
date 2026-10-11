(() => {
  const root = document.querySelector('.mac-editor');
  const blocks = [...root.querySelectorAll('[data-block-type]')];
  const target = blocks.find(b => b.getAttribute('data-block-type')==='text' && (b.innerText||'').trim().length>4) || blocks[0];
  const rec = (b) => {
    const inner = b.querySelector('.content-editable');
    const g1 = getComputedStyle(b), g2 = inner?getComputedStyle(inner):null;
    const wrap = b.closest('.node-container');
    const gw = wrap?getComputedStyle(wrap):null;
    return {
      type: b.getAttribute('data-block-type'), ce: inner?inner.getAttribute('contenteditable'):null,
      block: {bg:g1.backgroundColor, col:g1.color, pad:g1.padding, br:g1.borderRadius, outline:g1.outline, boxShadow:g1.boxShadow, border:g1.border},
      inner: g2?{col:g2.color, fs:g2.fontSize, lh:g2.lineHeight, fw:g2.fontWeight, pad:g2.padding, bg:g2.backgroundColor, border:g2.border, outline:g2.outline, boxShadow:g2.boxShadow, caretColor:g2.caretColor, opacity:g2.opacity}:null,
      wrap: gw?{bg:gw.backgroundColor, style:(wrap.getAttribute('style')||''), br:gw.borderRadius}:null,
      outerHTMLhead: b.outerHTML.replace(/\s+/g,' ').slice(0,300)
    };
  };
  const before = rec(target);
  return JSON.stringify({label:'before-focus', url:location.href, targetId: target.getAttribute('data-block-id'), before,
    allEditable: blocks.slice(0,0), countContentEditableTrue: root.querySelectorAll('.content-editable[contenteditable=true]').length,
    countContentEditableFalse: root.querySelectorAll('.content-editable[contenteditable=false]').length,
    countBlocks: blocks.length,
    anyNonEditableSamples: [...root.querySelectorAll('.content-editable[contenteditable=false]')].slice(0,5).map(e=>({cls:(''+e.className).slice(0,60), txt:(e.innerText||'').slice(0,30), parentType:(e.closest('[data-block-type]')||{getAttribute:()=>null}).getAttribute('data-block-type')}))
  });
})()
