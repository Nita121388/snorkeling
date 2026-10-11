(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error:'no .mac-editor'});
  // all block-ish nodes: those with data-block-id or data-block-type
  const all = [...root.querySelectorAll('[data-block-id]')];
  const out = [];
  const styleKeys = ['display','fontSize','lineHeight','paddingTop','paddingBottom','paddingLeft','paddingRight','marginTop','marginBottom','borderRadius','gap','fontWeight','color','backgroundColor'];
  for (const n of all) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    const st = {}; for (const k of styleKeys) st[k] = cs[k];
    out.push({
      tag: n.tagName,
      cls: (typeof n.className === 'string' ? n.className : '').slice(0,120),
      blockId: n.getAttribute('data-block-id'),
      type: n.getAttribute('data-type'),
      blockType: n.getAttribute('data-block-type'),
      area: n.getAttribute('data-area'),
      screenId: n.getAttribute('data-screen-id') ? 'y' : undefined,
      depth: (()=>{let d=0,p=n; while(p&&p!==root){p=p.parentElement;d++;} return d;})(),
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      text: (n.innerText||'').replace(/\s+/g,' ').trim().slice(0,90),
      style: st
    });
  }
  return JSON.stringify({pageTitle: document.title, url: location.href, total: out.length, blocks: out});
})()
