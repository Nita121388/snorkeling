(() => {
  const root = document.querySelector('.mac-editor');
  if (!root) return JSON.stringify({error:'no editor'});
  const out = {};
  const st = root.querySelector('[data-block-type=simpleTable]');
  if (st) {
    out.simpleTable = {html: st.outerHTML.replace(/\s+/g,' ').slice(0, 6000)};
    const tbl = st.querySelector('table');
    if (tbl) {
      const cells = [...tbl.querySelectorAll('th,td')].slice(0,6).map(c => { const g=getComputedStyle(c); const r=c.getBoundingClientRect(); return {
        tag:c.tagName, cls:(''+c.className).slice(0,40), border:g.border, borderColor:g.borderColor, pad:g.padding, bg:g.backgroundColor,
        fs:g.fontSize, fw:g.fontWeight, col:g.color, w:Math.round(r.width), h:Math.round(r.height), html:c.outerHTML.replace(/\s+/g,' ').slice(0,300)}; });
      out.tableStyle = {tableStyle: tbl.getAttribute('style'), tableCls: tbl.className, borderCollapse: getComputedStyle(tbl).borderCollapse, trCount: tbl.querySelectorAll('tr').length};
      out.cells = cells;
    }
  }
  // column / row layout
  const col = root.querySelector('.column-node');
  if (col) { const g=getComputedStyle(col); const r=col.getBoundingClientRect(); out.column = {cls:col.className, style:col.getAttribute('style'), display:g.display, w:Math.round(r.width), pad:g.padding, mar:g.margin, borderRight:g.borderRight}; }
  const row = root.querySelector('[class*=page-row-layout], ._3rVYD');
  if (row) { out.row = {cls:(''+row.className).slice(0,80), style:row.getAttribute('style'), display:getComputedStyle(row).display, gap:getComputedStyle(row).gap, padTop:getComputedStyle(row).paddingTop, kids:[...row.children].map(c=>{const g=getComputedStyle(c);const rr=c.getBoundingClientRect();return {cls:(''+c.className).slice(0,50), style:(c.getAttribute('style')||'').slice(0,90), w:Math.round(rr.width), display:g.display};})}; }
  return JSON.stringify(out);
})()
