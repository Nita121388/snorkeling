(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error:'no editor'});
  const out = {};
  // 1) toggle children indent: find node-containers that are descendants of a toggleList's child wrapper
  const tgl = root.querySelector('[data-block-type=toggleList]');
  if (tgl) {
    const wrap = tgl.closest('.node-container');
    const siblings = [];
    let n = wrap.nextElementSibling, i = 0;
    while (n && i < 4) { siblings.push({cls:(''+n.className).slice(0,60), padLeft:getComputedStyle(n).paddingLeft, style:(n.getAttribute('style')||'').slice(0,120), txt:(n.innerText||'').replace(/\s+/g,' ').slice(0,40), depth:(()=>{let d=0,p=n;while(p&&p!==root){p=p.parentElement;d++;}return d;})()}); n = n.nextElementSibling; i++; }
    out.toggleChildren = {wrapStyle: (wrap.getAttribute('style')||''), wrapPadLeft: getComputedStyle(wrap).paddingLeft, siblings};
  }
  // 2) all list-ish blocks with indentation
  out.lists = [...root.querySelectorAll('[data-block-type=bullList],[data-block-type=enumList],[data-block-type=todoList],[data-block-type=toggleList],[data-block-type=todoListPro]')].slice(0,18).map(b => {
    const cs = getComputedStyle(b);
    const inner = b.querySelector('.content-editable');
    const wrap = b.closest('.node-container');
    const chain = []; let p = b;
    while (p && p !== root) { const g = getComputedStyle(p); chain.push({tag:p.tagName, cls:(''+p.className).slice(0,40), padL:g.paddingLeft, marL:g.marginLeft}); p = p.parentElement; }
    return {type:b.getAttribute('data-block-type'), text:(b.innerText||'').replace(/\s+/g,' ').slice(0,26),
      blockPadLeft: cs.paddingLeft, innerPadLeft: inner?getComputedStyle(inner).paddingLeft:null,
      wrapStyle:(wrap?(wrap.getAttribute('style')||''):''), chain: chain.slice(0,6)};
  });
  // 3) simpleTable full
  const st = root.querySelector('[data-block-type=simpleTable]');
  if (st) out.simpleTable = {html: st.outerHTML.replace(/\s+/g,' ').slice(0, 4000)};
  // 4) divider + quote + callout ::before/after
  const details = {};
  for (const t of ['divider','quote','callout','image','page','templateButton','progressBar','subHeader','header','midHeader','tinyHeader','text','toggleList','code']) {
    const b = root.querySelector(`[data-block-type=${t}]`);
    if (!b) continue;
    const inner = b.querySelector('.content-editable');
    details[t] = {outerCls:(''+b.className).slice(0,70), outerStyle:(b.getAttribute('style')||'').slice(0,150),
      outerPad:getComputedStyle(b).padding, outerMar:getComputedStyle(b).margin, outerBr:getComputedStyle(b).borderRadius,
      outerBg:getComputedStyle(b).backgroundColor,
      innerCls: inner?(''+inner.className).slice(0,80):null, innerFs: inner?getComputedStyle(inner).fontSize:null,
      innerLh: inner?getComputedStyle(inner).lineHeight:null, innerFw: inner?getComputedStyle(inner).fontWeight:null,
      innerPad: inner?getComputedStyle(inner).padding:null, innerMar: inner?getComputedStyle(inner).margin:null,
      before: (g=>({content:g.content,bg:g.backgroundColor,w:g.width,borderLeft:g.borderLeft,borderRadius:g.borderRadius,pos:g.position,left:g.left,top:g.top,display:g.display}))(getComputedStyle(b,'::before')),
      after: (g=>({content:g.content,bg:g.backgroundColor,w:g.width,borderLeft:g.borderLeft,borderRadius:g.borderRadius,pos:g.position,left:g.left,top:g.top,display:g.display}))(getComputedStyle(b,'::after'))};
  }
  out.details = details;
  return JSON.stringify(out);
})()
