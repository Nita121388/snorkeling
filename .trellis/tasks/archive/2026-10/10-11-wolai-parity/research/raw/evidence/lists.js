(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error:'no editor'});
  const out = {types: {}, samples: []};
  const seen = {};
  for (const b of root.querySelectorAll('[data-block-type]')) {
    const t = b.getAttribute('data-block-type');
    out.types[t] = (out.types[t]||0)+1;
    if (!/List|list/.test(t) || seen[t]) continue;
    seen[t] = 1;
    const wrap = b.parentElement;
    const marker = wrap.querySelector('[class*=node-btn], [class*=marker], [class*=index], [class*=action]');
    const inner = b.querySelector('.content-editable');
    out.samples.push({type:t, text:(b.innerText||'').replace(/\s+/g,' ').slice(0,34),
      wrapCls:(''+wrap.className).slice(0,60), wrapStyle:(wrap.getAttribute('style')||'').slice(0,120),
      wrapPadLeft:getComputedStyle(wrap).paddingLeft, wrapMarLeft:getComputedStyle(wrap).marginLeft,
      blockPadLeft:getComputedStyle(b).paddingLeft, innerPadLeft:inner?getComputedStyle(inner).paddingLeft:null,
      markerHTML: marker?marker.outerHTML.replace(/\s+/g,' ').slice(0,420):null,
      blockHTMLhead: b.outerHTML.replace(/\s+/g,' ').slice(0,700)});
  }
  return JSON.stringify(out);
})()
