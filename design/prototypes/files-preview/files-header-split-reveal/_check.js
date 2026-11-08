
(function () {
  const I = {
    file:'<svg class="fill" viewBox="0 0 16 16"><path d="M3 1.5h6l4 4v9H3z" opacity=".55"/></svg>',
    dir:'<svg class="fill" viewBox="0 0 16 16"><path d="M1.6 3.6c0-.55.45-1 1-1h3.2l1.4 1.6h6.2c.55 0 1 .45 1 1v7.2c0 .55-.45 1-1 1H2.6c-.55 0-1-.45-1-1z"/></svg>',
    goto:'<svg class="fill" viewBox="0 0 16 16"><path d="M1.6 3.6c0-.55.45-1 1-1h3.2l1.4 1.6h6.2c.55 0 1 .45 1 1v7.2c0 .55-.45 1-1 1H2.6c-.55 0-1-.45-1-1z"/><path d="M9.5 9l2 2-2 2" stroke="currentColor" fill="none" stroke-width="1.6"/></svg>',
    tree:'<svg class="stroke" viewBox="0 0 16 16"><path d="M3 3v10M3 7h5M3 11h5"/><circle cx="11" cy="7" r="1.5"/><circle cx="11" cy="11" r="1.5"/></svg>',
    html:'<svg class="stroke" viewBox="0 0 16 16"><polyline points="5,4 1.5,8 5,12"/><polyline points="11,4 14.5,8 11,12"/></svg>',
    target:'<svg class="stroke" viewBox="0 0 16 16"><rect x="2" y="2" width="6" height="6" rx="1"/><rect x="8.5" y="8.5" width="6" height="6" rx="1"/><path d="M8 4h4v3"/></svg>',
    vcs:'<svg class="stroke" viewBox="0 0 16 16"><circle cx="4" cy="3.5" r="1.4"/><circle cx="4" cy="12.5" r="1.4"/><circle cx="12" cy="8" r="1.4"/><path d="M4 5v6M5.3 4.2l5.4 3.1"/></svg>',
    eye:'<svg class="stroke" viewBox="0 0 16 16"><path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.6"/></svg>',
    book:'<svg class="stroke" viewBox="0 0 16 16"><path d="M2 3h5v10H2zM9 3h5v10H9z"/></svg>',
    booko:'<svg class="stroke" viewBox="0 0 16 16"><path d="M8 4.5C6 3 3 3 2 3.6v8.8C3 12 6 12 8 13.5c2-1.5 5-1.5 6-.7V3.6C13 3 10 3 8 4.5z"/></svg>',
    dots:'<svg class="fill" viewBox="0 0 16 16"><circle cx="3" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="13" cy="8" r="1.1"/></svg>',
    magnify:'<svg class="stroke" viewBox="0 0 16 16"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>',
    box:'<svg class="stroke" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 10h12"/></svg>',
    refresh:'<svg class="stroke" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.8-3.8"/><polyline points="13,2 13,5 10,5"/></svg>',
    pen:'<svg class="stroke" viewBox="0 0 16 16"><rect x="2" y="2" width="9" height="9" rx="1"/><path d="M9 12l5-5 1.5 1.5-5 5H9z"/></svg>',
    x:'<svg class="stroke" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
  };
  const SCENES = {
    markdown:{ path:"README.md", icon:"file",
      left:["goto","html","target"], right:["vcs","book","booko","dots","magnify","box"], pinned:["refresh","pen","x"] },
    dir:{ path:"frontend/app/view/preview", icon:"dir",
      left:["goto","tree","target"], right:["vcs","eye","dots","magnify","box"], pinned:["refresh","pen","x"] },
    file:{ path:"preview-model.tsx", icon:"file",
      left:["goto","html","target"], right:["vcs","dots","magnify","box"], pinned:["refresh","pen","x"] }
  };
  const LABELS = { goto:"Go to Path", tree:"Switch To Tree View", html:"HTML Open Mode",
    target:"Open in directional block", vcs:"Version Control", eye:"Show Hidden Files",
    book:"Table of Contents", booko:"Open in Obsidian", dots:"More actions",
    magnify:"Magnify Block", box:"Merge into Previous Block",
    refresh:"Refresh", pen:"Edit", x:"Close" };
  const KEYS = { vcs:"⌃⇧B", magnify:"⌃⇧M", refresh:"⌃R", x:"⌃W" };
  const PRIO = { box:6, magnify:5, booko:4, book:4, eye:3, html:3, target:2, goto:2, tree:2,
    vcs:0, dots:0, refresh:1, pen:1, x:0 };
  const NEVER = new Set(["vcs","dots","x"]);
  const PAD = 12, TYPE_W = 16, PX = 26;
  const state = { scene:"markdown", width:300, grace:400 };

  const totalOf = (s) => s.left.length + s.right.length + s.pinned.length;

  function tierFor(w, total) {
    const needFull = total * PX + PAD + TYPE_W;
    const halfLine = PAD + TYPE_W + Math.ceil(total / 2) * PX;
    if (w >= needFull) return 0;
    if (w >= Math.max(halfLine, 240)) return 1;
    if (w >= 192) return 2;
    if (w >= 88) return 3;
    return 4;
  }

  /* ══ 锁存状态机（纯函数，可单测） ══ */
  function reduce(st, ev) {
    const s = { zone: st.zone, pendingReset: st.pendingReset, frozen: st.frozen };
    if (ev.type === "ENTER") {
      if (s.frozen) return s;
      if (s.zone) { s.pendingReset = false; return s; }   // 宽限内回来 → 沿用原方向
      s.zone = ev.x < ev.mid ? "left" : "right";
      s.pendingReset = false;
      return s;
    }
    if (ev.type === "LEAVE") {
      if (s.frozen) return s;
      if (s.zone) s.pendingReset = true;
      return s;
    }
    if (ev.type === "RESET") {
      if (s.frozen) return s;
      if (s.pendingReset) { s.zone = null; s.pendingReset = false; }
      return s;
    }
    if (ev.type === "FREEZE") { s.frozen = true; s.pendingReset = false; return s; }
    if (ev.type === "UNFREEZE") { s.frozen = false; s.zone = null; s.pendingReset = false; return s; }
    return s;
  }

  function plan(w, zone, sceneKey) {
    const s = SCENES[sceneKey];
    const all = [...s.left, ...s.right, ...s.pinned];
    const tier = tierFor(w, totalOf(s));
    if (!zone) return { tier, yieldLeft:false, shown:all, hidden:[], mode:"idle" };
    if (zone === "left") return { tier, yieldLeft:false, shown:all, hidden:[], mode:"left" };

    const yieldLeft = true;
    const maxSlots = Math.max(0, Math.floor((w - PAD - TYPE_W) / PX));
    if (tier === 4) return { tier, yieldLeft, shown:[], hidden:all, mode:"flyout" };
    if (tier === 3) return { tier, yieldLeft, shown:["dots"], hidden:all.filter(k=>k!=="dots"), mode:"overflow" };

    const must = all.filter(k=>NEVER.has(k));
    const rest = all.filter(k=>!NEVER.has(k)).sort((a,b)=>PRIO[a]-PRIO[b]);
    const shown = [...must];
    for (const k of rest) { if (shown.length >= maxSlots) break; shown.push(k); }
    const ordered = all.filter(k=>shown.includes(k));
    const hidden = all.filter(k=>!ordered.includes(k));
    return { tier, yieldLeft, shown:ordered, hidden, mode:"overflow" };
  }

  function ibtn(key, cls) {
    const b = document.createElement("button");
    b.className = "ibtn" + (cls ? " " + cls : "");
    b.dataset.key = key;
    b.title = LABELS[key] || key;
    b.setAttribute("aria-label", LABELS[key] || key);
    b.innerHTML = I[key] || "";
    return b;
  }

  function buildHeader(sceneKey) {
    const s = SCENES[sceneKey];
    const hdr = document.createElement("div");
    hdr.className = "bhdr";
    hdr.dataset.latched = "";
    const left = document.createElement("div");
    left.className = "left-zone";
    const chev = document.createElement("button");
    chev.className = "pre-chev"; chev.title = "Go to parent directory"; chev.textContent = "‹";
    left.appendChild(chev);
    const vi = document.createElement("button");
    vi.className = "viewicon"; vi.dataset.key = "viewicon"; vi.title = s.path;
    vi.style.cssText = "border:none;background:none;cursor:pointer;padding:0";
    vi.innerHTML = I[s.icon];
    left.appendChild(vi);
    const pname = document.createElement("span");
    pname.className = "pname"; pname.textContent = s.path;
    left.appendChild(pname);
    hdr.appendChild(left);
    const gl = document.createElement("div"); gl.className = "grp grp-left"; hdr.appendChild(gl);
    const gr = document.createElement("div"); gr.className = "grp grp-right"; hdr.appendChild(gr);
    const pin = document.createElement("div"); pin.className = "pinned"; hdr.appendChild(pin);
    const badge = document.createElement("div"); badge.className = "tier-badge"; hdr.appendChild(badge);
    return hdr;
  }

  function render(hdr, w, zone, sceneKey) {
    const s = SCENES[sceneKey];
    const p = plan(w, zone, sceneKey);
    hdr.dataset.latched = zone || "";
    hdr.dataset.tier = String(p.tier);
    hdr.querySelector(".tier-badge").textContent = "tier " + p.tier + " · " + Math.round(w) + "px";
    hdr.classList.toggle("yielded", p.yieldLeft);
    const gl = hdr.querySelector(".grp-left");
    const gr = hdr.querySelector(".grp-right");
    const pin = hdr.querySelector(".pinned");
    gl.innerHTML = ""; gr.innerHTML = ""; pin.innerHTML = "";
    gl.classList.remove("on"); gr.classList.remove("on");
    if (!zone) return p;

    if (zone === "left") {
      const slots = Math.max(1, Math.floor((w - PAD - TYPE_W - 22 - 40) / PX));
      const keep = s.left.slice(0, Math.max(1, slots - (s.left.length > slots ? 1 : 0)));
      keep.forEach(k=>gl.appendChild(ibtn(k)));
      if (keep.length < s.left.length) {
        const ov = ibtn("dots","overflow"); ov.dataset.ov = "left"; gl.appendChild(ov);
      }
      gl.classList.add("on");
      return p;
    }
    const inLeft = p.shown.filter(k=>s.left.includes(k));
    const inRight = p.shown.filter(k=>s.right.includes(k) && k !== "dots");
    const inPin = p.shown.filter(k=>s.pinned.includes(k));
    inLeft.forEach(k=>gl.appendChild(ibtn(k)));
    inRight.forEach(k=>gr.appendChild(ibtn(k)));
    if (p.shown.includes("dots")) {
      const ov = ibtn("dots","overflow"); ov.dataset.ov = "right"; gr.appendChild(ov);
    }
    inPin.forEach(k=>pin.appendChild(ibtn(k)));
    gr.classList.add("on");
    if (inLeft.length) gl.classList.add("on");
    return p;
  }

  /* ══ 面板 ══ */
  const PANELS = [
    { id:"latch", name:"锁存式（推荐）", note:"pointerenter 判定一次 → 会话内锁死；离开 + 宽限后恢复" },
    { id:"live", name:"实时中线（有缺陷）", note:"每次 pointermove 重算；右组越中线 → 翻区 → 点不到" }
  ];
  const panelsHost = document.getElementById("panels");
  const inst = {};

  function buildPanels() {
    panelsHost.innerHTML = "";
    Object.keys(inst).forEach(k=>delete inst[k]);

    PANELS.forEach(pn => {
      const row = document.createElement("div");
      row.className = "cmp-row";
      row.innerHTML =
        '<div class="lbl"><b>' + pn.name + '</b><span class="pill" id="pill-' + pn.id + '">—</span><span>' + pn.note + '</span></div>' +
        '<div class="bframe" style="--frame-w:' + state.width + 'px"></div>' +
        '<div class="readout"></div>';
      panelsHost.appendChild(row);

      const frame = row.querySelector(".bframe");
      const readout = row.querySelector(".readout");
      const pill = row.querySelector("#pill-" + pn.id);
      const s = SCENES[state.scene];
      const total = totalOf(s);

      const hdr = buildHeader(state.scene);
      const menu = document.createElement("div"); menu.className = "ovmenu";
      const flyout = document.createElement("div"); flyout.className = "flyout";
      frame.appendChild(hdr); frame.appendChild(menu); frame.appendChild(flyout);
      const body = document.createElement("div");
      body.className = "bbody";
      body.innerHTML =
        '<div class="brow"><span class="g">▸</span>app/</div>' +
        '<div class="brow"><span class="g">▸</span>element/</div>' +
        '<div class="brow"><span class="g">·</span>' + s.path + '</div>';
      frame.appendChild(body);

      let st = { zone:null, pendingReset:false, frozen:false };
      let timer = null;
      let lastPlan = plan(state.width, null, state.scene);

      const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
      const startTimer = () => {
        cancelTimer();
        timer = setTimeout(() => {
          timer = null;
          st = reduce(st, { type:"RESET" });
          refresh();
        }, state.grace);
      };

      function refresh() {
        lastPlan = render(hdr, state.width, st.zone, state.scene);
        pill.textContent = "tier " + lastPlan.tier;
        pill.style.color = lastPlan.tier >= 2 ? "var(--warn)" : "var(--secondary-text-color)";
        const hr = hdr.getBoundingClientRect();
        const vis = Array.from(hdr.querySelectorAll(".ibtn")).filter(b => {
          if (getComputedStyle(b.parentElement).display === "none") return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.left < hr.right - 1 && r.right > hr.left + 1;
        }).length;
        const reach = !st.zone ? total : lastPlan.shown.length + lastPlan.hidden.length;
        const label = st.zone ? "LATCHED_" + st.zone.toUpperCase() : "NEUTRAL";
        readout.innerHTML =
          '<span>状态：<code class="' + (st.zone ? "ok" : "") + '">' + label + '</code></span>' +
          '<span>宽限中：<code>' + (st.pendingReset ? "yes" : "no") + '</code></span>' +
          '<span>可见：<code class="ok">' + vis + '</code></span>' +
          '<span>溢出：<code>' + (lastPlan.mode === "flyout" ? "—" : lastPlan.hidden.length) + '</code></span>' +
          '<span>可达：<code class="' + (reach === total ? "ok" : "bad") + '">' + reach + '/' + total + '</code></span>';
      }

      function enter(x) {
        const r = hdr.getBoundingClientRect();
        const mid = r.left + r.width / 2;
        if (pn.id === "live") { st.zone = x < mid ? "left" : "right"; }
        else { cancelTimer(); st = reduce(st, { type:"ENTER", x, mid }); }
        refresh();
      }
      function leave() {
        if (pn.id === "live") { st.zone = null; refresh(); return; }
        st = reduce(st, { type:"LEAVE" });
        if (st.pendingReset) startTimer();
        refresh();
      }
      function move(x) {
        if (pn.id !== "live") return;
        const r = hdr.getBoundingClientRect();
        const mid = r.left + r.width / 2;
        const z = x < mid ? "left" : "right";
        if (z !== st.zone) { st.zone = z; refresh(); }
      }

      hdr.addEventListener("pointerenter", e=>enter(e.clientX));
      hdr.addEventListener("pointerleave", ()=>leave());
      hdr.addEventListener("pointermove", e=>move(e.clientX));

      [menu, flyout].forEach(el => {
        el.addEventListener("pointerenter", ()=>{ if (pn.id === "latch") cancelTimer(); });
        el.addEventListener("pointerleave", ()=>{
          if (pn.id !== "latch") return;
          st = reduce(st, { type:"LEAVE" });
          if (st.pendingReset) startTimer();
        });
      });

      hdr.addEventListener("click", e=>{
        const ov = e.target.closest(".ibtn.overflow");
        if (ov) {
          const open = !menu.classList.contains("open");
          menu.classList.toggle("open", open);
          ov.classList.toggle("open", open);
          if (pn.id === "latch") { st = reduce(st, { type: open ? "FREEZE" : "UNFREEZE" }); cancelTimer(); }
          if (open) {
            menu.innerHTML = "";
            const keys = lastPlan.hidden.length ? lastPlan.hidden : s.left.concat(s.right, s.pinned);
            const groups = [
              ["LEFT", keys.filter(k=>s.left.includes(k))],
              ["RIGHT", keys.filter(k=>s.right.includes(k) && k !== "dots")],
              ["PINNED", keys.filter(k=>s.pinned.includes(k))]
            ];
            groups.forEach((g,gi)=>{
              if (!g[1].length) return;
              if (gi > 0) { const sp = document.createElement("div"); sp.className = "ovsep"; menu.appendChild(sp); }
              g[1].forEach(k=>{
                const b = document.createElement("button");
                b.className = "ovitem";
                b.innerHTML = (I[k]||"") + "<span>" + LABELS[k] + "</span><span class='gt'>" + g[0] + "</span>" +
                  (KEYS[k] ? "<span class='k'>" + KEYS[k] + "</span>" : "");
                menu.appendChild(b);
              });
            });
            const hr = hdr.getBoundingClientRect(), fr = frame.getBoundingClientRect();
            menu.style.top = (hr.bottom - fr.top + 2) + "px";
            menu.style.left = Math.max(0, Math.min(hr.right - fr.left - 210, fr.width - 210)) + "px";
          }
          refresh();
          return;
        }
        const vi = e.target.closest(".viewicon");
        if (vi && lastPlan.tier === 4 && pn.id === "latch") {
          const open = !flyout.classList.contains("open");
          flyout.classList.toggle("open", open);
          if (open && flyout.children.length === 0) {
            const add = (keys, lbl) => {
              if (!keys.length) return;
              const l = document.createElement("span"); l.className = "flbl"; l.textContent = lbl;
              flyout.appendChild(l);
              keys.forEach(k=>flyout.appendChild(ibtn(k)));
              const sp = document.createElement("div"); sp.className = "gsep"; flyout.appendChild(sp);
            };
            add(s.left,"L"); add(s.right.filter(k=>k!=="dots"),"R"); add(s.pinned,"P");
          }
        }
      });

      inst[pn.id] = {
        hdr, frame, menu, flyout,
        get st(){ return st; },
        enter, leave, move, refresh, cancelTimer,
        hardReset(){ cancelTimer(); st = { zone:null, pendingReset:false, frozen:false }; menu.classList.remove("open"); flyout.classList.remove("open"); refresh(); }
      };
      refresh();
    });
  }

  /* ══ 自动验证 ══ */
  const sleep = ms => new Promise(r=>setTimeout(r, ms));
  const log = [];
  function push(step, zone) { log.push([step, zone]); }

  function fireEnter(hdr, x) {
    hdr.dispatchEvent(new PointerEvent("pointerenter", { clientX:x, clientY:hdr.getBoundingClientRect().top + 15, bubbles:false }));
  }
  function fireLeave(hdr) {
    hdr.dispatchEvent(new PointerEvent("pointerleave", { clientX:-10, clientY:-10, bubbles:false }));
  }
  function fireMove(hdr, x) {
    hdr.dispatchEvent(new PointerEvent("pointermove", { clientX:x, clientY:hdr.getBoundingClientRect().top + 15, bubbles:true }));
  }

  function setVerdict(id, pass, text) {
    const el = document.getElementById(id);
    el.className = "verdict " + (pass ? "pass" : "fail");
    el.textContent = (pass ? "PASS" : "FAIL") + " · " + text;
  }

  async function runA() {
    log.length = 0;
    const o = inst.latch;
    o.hardReset();
    await sleep(80);
    const hr = o.hdr.getBoundingClientRect();
    // 从右半进入
    fireEnter(o.hdr, hr.left + hr.width * 0.8);
    await sleep(120);
    push("ENTER @80% → " + o.st.zone, o.st.zone);
    const startZone = o.st.zone;

    // 横穿全宽（含已展开 icon 的位置，含越中线）
    const icons = Array.from(o.hdr.querySelectorAll(".grp-right .ibtn, .pinned .ibtn"))
      .filter(b => getComputedStyle(b.parentElement).display !== "none");
    let flipped = false;
    for (const b of icons) {
      const r = b.getBoundingClientRect();
      fireMove(o.hdr, r.left + r.width / 2);
      await sleep(60);
      if (o.st.zone !== startZone) flipped = true;
      push("MOVE @icon " + (b.dataset.key||"?") + " x=" + Math.round(r.left + r.width/2 - hr.left) + " mid=" + Math.round(hr.width/2), o.st.zone);
    }
    for (const frac of [0.05, 0.25, 0.5, 0.75, 0.98]) {
      fireMove(o.hdr, hr.left + hr.width * frac);
      await sleep(50);
      if (o.st.zone !== startZone) flipped = true;
      push("MOVE @" + Math.round(frac*100) + "%", o.st.zone);
    }
    setVerdict("vA", !flipped && startZone === "right",
      flipped ? "横穿时翻区了" : "横穿全宽（含 icon 越中线）全程 zone=right，未翻区");
    showTrace();
  }

  async function runB() {
    log.length = 0;
    const o = inst.latch;
    o.hardReset();
    await sleep(80);
    const hr = o.hdr.getBoundingClientRect();
    fireEnter(o.hdr, hr.left + hr.width * 0.8);
    await sleep(100);
    push("ENTER @80% → right", o.st.zone);
    fireLeave(o.hdr);
    push("LEAVE → 宽限中", o.st.zone);
    await sleep(Math.max(30, state.grace - 150));   // 宽限内回来
    fireEnter(o.hdr, hr.left + hr.width * 0.15);      // 从左侧进入
    await sleep(80);
    const ok = o.st.zone === "right";
    push("宽限内 ENTER @15%（左侧）→ 应保持 right", o.st.zone);
    setVerdict("vB", ok, ok ? "宽限内回来沿用原方向 right（未因进入点变左而翻区）" : "宽限内回来错误地翻成 " + o.st.zone);
    showTrace();
  }

  async function runC() {
    log.length = 0;
    const o = inst.latch;
    o.hardReset();
    await sleep(80);
    const hr = o.hdr.getBoundingClientRect();
    fireEnter(o.hdr, hr.left + hr.width * 0.8);
    await sleep(100);
    push("ENTER @80% → right", o.st.zone);
    fireLeave(o.hdr);
    push("LEAVE", o.st.zone);
    await sleep(state.grace + 200);                   // 超过宽限
    push("超过宽限后（应 NEUTRAL）", o.st.zone);
    const neutral = o.st.zone == null;
    fireEnter(o.hdr, hr.left + hr.width * 0.15);
    await sleep(100);
    const switched = o.st.zone === "left";
    push("从左侧 ENTER → 应切换 left", o.st.zone);
    setVerdict("vC", neutral && switched,
      (neutral ? "超过宽限已回 NEUTRAL" : "超过宽限仍是 " + o.st.zone) + "；" +
      (switched ? "再次从左侧进入成功切到 left" : "再次进入未切换（" + o.st.zone + "）"));
    showTrace();
  }

  function showTrace() {
    const t = document.getElementById("trace");
    t.style.display = "block";
    t.innerHTML = "";
    const head = document.createElement("div");
    head.className = "t-head";
    head.textContent = "── 锁存面板事件序列 ──";
    t.appendChild(head);
    log.forEach(([step, zone]) => {
      const d = document.createElement("div");
      d.className = zone === "right" ? "t-right" : zone === "left" ? "t-left" : "t-none";
      d.textContent = "  " + step.padEnd(52) + " zone=" + (zone || "null");
      t.appendChild(d);
    });
  }

  /* ══ 可达性表 ══ */
  function buildReach() {
    const tbody = document.getElementById("reachTable");
    tbody.innerHTML = "";
    const s = SCENES[state.scene];
    const total = totalOf(s);
    let allPass = true;
    [40,62,88,120,160,192,240,300,360,520].forEach(w => {
      const p = plan(w, "right", state.scene);
      const wrap = document.createElement("div");
      wrap.className = "bframe";
      wrap.style.cssText = "position:absolute;left:-9999px;top:0;width:" + w + "px;--frame-w:" + w + "px";
      document.body.appendChild(wrap);
      const hdr = buildHeader(state.scene);
      wrap.appendChild(hdr);
      render(hdr, w, "right", state.scene);
      void hdr.offsetWidth;
      const hr = hdr.getBoundingClientRect();
      const vis = Array.from(hdr.querySelectorAll(".ibtn")).filter(b => {
        if (getComputedStyle(b.parentElement).display === "none") return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.left < hr.right - 1 && r.right > hr.left + 1;
      }).length;
      const clipped = Array.from(hdr.querySelectorAll(".ibtn")).filter(b => {
        if (getComputedStyle(b.parentElement).display === "none") return false;
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.right > hr.right - 1;
      }).length;
      wrap.remove();

      const viaFly = p.mode === "flyout" ? total : 0;
      const viaMenu = p.mode === "flyout" ? 0 : p.hidden.length;
      const sum = vis + viaMenu + viaFly;
      const pass = sum === total && clipped === 0;
      if (!pass) allPass = false;
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td><code>" + w + "px</code></td>" +
        "<td><code class="" + (p.tier >= 2 ? "warn" : "") + "">tier " + p.tier + "</code></td>" +
        "<td><code class="" + (vis ? "ok" : "warn") + "">" + vis + "</code> 个" +
          (clipped ? " <span class="bad">(" + clipped + " 被切)</span>" : "") + "</td>" +
        "<td><code>" + (viaFly ? "—" : viaMenu) + "</code> 个</td>" +
        "<td><code>" + (viaFly ? total : "—") + "</code></td>" +
        "<td><b class="" + (pass ? "ok" : "bad") + "">" + sum + " / " + total + "</b></td>" +
        "<td><b class="" + (pass ? "ok" : "bad") + "">" + (pass ? "PASS" : "FAIL") + "</b></td>";
      tbody.appendChild(tr);
    });
    const v = document.getElementById("reachVerdict");
    v.className = "verdict " + (allPass ? "pass" : "fail");
    v.textContent = allPass
      ? "PASS — 10 个宽度全部满足「可见 + 溢出 + 浮层 = " + total + "」且无 icon 被硬切"
      : "FAIL — 存在宽度下功能不可达或被裁切";
  }

  /* ══ 控件 ══ */
  function seg(id, cb) {
    document.getElementById(id).addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      document.querySelectorAll("#" + id + " button").forEach(x=>x.classList.toggle("active", x === b));
      cb(b.dataset.v);
    });
  }
  seg("segTheme", v=>{ document.body.dataset.theme = v; });
  seg("segScene", v=>{ state.scene = v; buildPanels(); buildReach(); });
  document.getElementById("width").addEventListener("input", e=>{
    state.width = Number(e.target.value);
    document.getElementById("widthVal").textContent = state.width + "px";
    buildPanels();
  });
  document.getElementById("grace").addEventListener("input", e=>{
    state.grace = Number(e.target.value);
    document.getElementById("graceVal").textContent = state.grace + "ms";
  });
  document.getElementById("zones").addEventListener("change", e=>{
    document.body.dataset.zones = e.target.checked ? "1" : "0";
  });
  document.getElementById("runA").addEventListener("click", runA);
  document.getElementById("runB").addEventListener("click", runB);
  document.getElementById("runC").addEventListener("click", runC);

  buildPanels();
  buildReach();
})();
