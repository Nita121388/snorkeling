/* ===========================================================
   Agent Card 强调线改造 — 原型交互
   文案逐字对齐 frontend/app/agent-status/agent-status-derive.ts
   =========================================================== */

const LOGO =
  '<svg viewBox="0 0 24 24"><path d="M9.813 4.183a4.5 4.5 0 0 1 6.372 0l4.183 4.183a4.5 4.5 0 0 1 0 6.372l-4.183 4.183a4.5 4.5 0 0 1-6.372 0L5.63 14.738a4.5 4.5 0 0 1 0-6.372zM12 8.1a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8"/></svg>';

const COPY_ICON =
  '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v16z"/></svg>';

const STATE = {
  working: { accent: "var(--agent-working-color)", label: "Working", dot: "is-working" },
  done: { accent: "var(--agent-done-color)", label: "Done", dot: "" },
  blocked: { accent: "var(--warning-color)", label: "Blocked · waiting for input", dot: "" },
  error: { accent: "var(--error-color)", label: "Error · rate limit exceeded", dot: "" },
};

const SESSION_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const NOTE = "记得把 subagent-card 的串行加载队列也接上虚拟滚动，别让主时间线等它。";
const TAGS = ["refactor", "aisessions", "p1"];

/* 四个方案（v0 是现状，用于对照） */
const VARIANTS = [
  {
    key: "v0",
    name: "0 · 现状（对照）",
    tag: { text: "bad", cls: "is-bad" },
    desc: "<b>border-left: 3px</b> + <b>border-radius: 8px</b>。圆角把左侧边框切成斜段，色条两头向外翻。",
    note:
      "圆角同时作用于四个角。左上的斜切把色条起点拉向右、右上的斜切又把它拉回来，两端形成小钩子。" +
      "色条越粗越明显。这是唯一需要改的规则。",
    code: `<span class="cmt">/* info-card.scss —— 现状 */</span>
.info-card.agent-card {
  <span class="del">  border-left: 3px solid var(--info-card-accent, …);</span>
  <span class="del">  border-radius: 8px;</span>
}`,
  },
  {
    key: "vA",
    name: "A · 全直角 + 通长直条",
    tag: { text: "minimal", cls: "" },
    desc: "<b>border-radius: 0</b>。色条从顶到底一条直线，通长。",
    note:
      "最硬最干净，跟终端 / 面板的语言一致。卡片右上也跟着变方，" +
      "如果希望右缘保持柔和，用方案 B。",
    code: `.info-card.agent-card {
  <span class="add">  border-radius: 0;</span>
  <span class="cmt">/* 其余不变 */</span>
}`,
  },
  {
    key: "vB",
    name: "B · 左直角 + 右圆角",
    tag: { text: "recommended", cls: "is-rec" },
    desc: "<b>border-radius: 0 6px 6px 0</b>。色条笔直，右缘仍软，卡片「挂在左边」。",
    note:
      "只把色条所在的那两个角归零，另外两个角保留圆角。" +
      "一行改动、不动 JSX、不影响其它 InfoCard 场景（规则本来就只挂在 .agent-card 上）。",
    code: `.info-card.agent-card {
  <span class="add">  border-radius: 0 6px 6px 0;</span>
  <span class="cmt">/* border-left: 3px 与 padding-left: 12px 原样保留 */</span>
}`,
  },
  {
    key: "vC",
    name: "C · 顶部状态色带",
    tag: { text: "alt", cls: "" },
    desc: "去掉 <b>border-left</b>，改成 <b>border-top: 3px</b>。状态往上顶。",
    note:
      "扫读状态最快，但左缘的身份感没了，卡片不再「挂在」左边。" +
      "hover 卡通常窄，色带会和卡片边框产生 1px 的双线，需要注意。",
    code: `.info-card.agent-card {
  <span class="del">-  border-left: 3px solid var(--info-card-accent, …);</span>
  <span class="del">-  padding-left: 12px;</span>
  <span class="add">+  border-top: 3px solid var(--info-card-accent, …);</span>
  <span class="add">+  border-radius: 8px;</span>
}`,
  },
  {
    key: "vD",
    name: "D · 直条 + 右上角状态章",
    tag: { text: "richer", cls: "" },
    desc: "B 的色条，状态行升级成右上角 chip。信息密度最高。",
    note:
      "状态从「一行」变成「一个章」，head 那行能腾出空间给 provider / model。" +
      "代价是卡片会变宽一点，且改 JSX（agent-hover-card.tsx 的 status-row 要加 wrapper）。",
    code: `.info-card.agent-card {
  <span class="add">+  position: relative;</span>
  <span class="add">+  border-radius: 0 6px 6px 0;</span>
}

<span class="cmt">/* 状态行移到右上角做 chip */</span>
.info-card.agent-card .agent-card-status-row {
  <span class="add">+  position: absolute;</span>
  <span class="add">+  top: 10px; right: 12px;</span>
  <span class="add">+  border-radius: 999px;</span>
  <span class="add">+  background: color-mix(in srgb, var(--info-card-accent) 13%, transparent);</span>
  <span class="add">+  border: 1px solid color-mix(in srgb, var(--info-card-accent) 30%, transparent);</span>
  <span class="del">-  margin-bottom: 6px;</span>
}`,
  },
  {
    key: "vE",
    name: "E · 通长圆头条 + 左直角右圆角",
    tag: { text: "pick 1", cls: "is-rec" },
    desc: "条是 <b>::before</b> 伪元素，通长；<b>border-radius</b> 加在条自己身上。卡左直角右圆角。",
    note:
      "这就是你说的那个：色条从卡片上边框内侧一直到下边框内侧，头尾是条自己的对称圆头。" +
      "因为卡片左边是直角，条不会被任何卡片圆角切割，所以不存在向外翻的斜段。" +
      "padding-left 从 12 改 15（12 + 条宽 3），内容 x 位置与原样完全一致。",
    code: `.info-card.agent-card {
  <span class="add">+  position: relative;</span>
  <span class="del">-  border-left: 3px solid var(--info-card-accent, …);</span>
  <span class="del">-  padding-left: 12px;</span>
  <span class="add">+  padding-left: 15px;</span>
  <span class="add">+  border-radius: 0 6px 6px 0;</span>
}

<span class="cmt">/* 色条本体：通长 + 自身圆头 */</span>
.info-card.agent-card::before {
  <span class="add">+  content: "";</span>
  <span class="add">+  position: absolute;</span>
  <span class="add">+  left: 0; top: 0; bottom: 0;</span>
  <span class="add">+  width: 3px;</span>
  <span class="add">+  border-radius: 2px;</span>
  <span class="add">+  background: var(--info-card-accent, …);</span>
}`,
  },
  {
    key: "vF",
    name: "F · 通长圆头条 + 卡外并列",
    tag: { text: "pick 2", cls: "" },
    desc: "条是卡片的<b>兄弟节点</b>，卡一个角都不动（四角圆角原样保留）。",
    note:
      "唯一能让卡片保持全圆角的做法：条独立于卡片，自己撑满卡片高度并自己圆头。" +
      "代价是需要 JSX 包一层 shell，且条与卡之间留 4px 缝——视觉上条变成「挂在卡边的一枚状态棍」，" +
      "而不是卡片的边框。这也是它与 E 最大的区别。",
    code: `<span class="cmt">/* agent-hover-card.tsx 需要包一层 */</span>
&lt;div className="agent-shell"&gt;
  &lt;span className="agent-shell-bar" /&gt;
  &lt;InfoCard className="agent-card"&gt;…&lt;/InfoCard&gt;
&lt;/div&gt;

.agent-shell { <span class="add">+  display: flex; align-items: stretch; gap: 4px;</span> }
.agent-shell-bar {
  <span class="add">+  width: 3px; align-self: stretch;</span>
  <span class="add">+  border-radius: 2px;</span>
  <span class="add">+  background: var(--info-card-accent, …);</span>
}
<span class="cmt">/* 卡片本身不用改 */</span>`,
  },
  {
    key: "vG",
    name: "G · 通长圆头条 + 卡全圆角（反例）",
    tag: { text: "avoid", cls: "is-bad" },
    desc: "想保留卡片四角全圆角，又把条放在卡片内。看左上角——条会从圆角缺口里探出去。",
    note:
      "卡片圆角会让边框在角落向内收，而条是直的、贴内侧。两者在角落对不上，" +
      "条的上端会探出卡片轮廓一点点（1–2px 的尖角）。这就是为什么保留全圆角只能走 F。",
    code: `.info-card.agent-card {
  <span class="add">+  position: relative;</span>
  <span class="add">+  border-radius: 6px;</span>   <span class="cmt">/* 四角圆角保留 */</span>
  <span class="add">+  padding-left: 15px;</span>
}
<span class="cmt">/* ::before 与 E 相同 */</span>

<span class="cmt">/* 问题：卡片圆角在角落内收，而条是直边贴内侧 → 条端探出轮廓 */</span>`,
  },
];

/* ── 状态 ── */
let currentState = "working";
let currentWidth = 320;
let showGrid = false;
let currentCap = "2";

/* ── 卡片渲染 ── */
function cardMarkup(variantKey, statusKey) {
  const s = STATE[statusKey];
  const tags = TAGS.map((t) => `<span class="agent-card-tag">${t}</span>`).join("");
  const inner = `
  <div class="info-card-section">
    <div class="agent-card-head">
      <span class="agent-card-logo">${LOGO}</span>
      <span class="agent-card-provider">Anthropic</span>
      <span class="agent-card-model">claude-sonnet-4-5</span>
    </div>
    <div class="agent-card-status-row">
      <span class="agent-card-status-dot ${s.dot}"></span>
      <span class="agent-card-status-label">${s.label}</span>
    </div>
  </div>
  <div class="info-card-section">
    <div class="note-head">
      <span class="note-head-title"><i class="fa-tag">#</i> Note</span>
      <span class="note-actions"><span class="note-btn" title="Save">✓</span></span>
    </div>
    <button type="button" class="note-preview">${NOTE}</button>
    <div class="agent-card-tags">${tags}</div>
  </div>
  <div class="agent-card-session-id">
    <span class="agent-card-session-id-text" title="${SESSION_ID}">${SESSION_ID}</span>
    <button type="button" class="agent-card-copy-btn" title="Copy session id">${COPY_ICON}</button>
  </div>`;

  // F：条与卡是兄弟节点，由外层 shell 撑高度
  if (variantKey === "vF") {
    return `
<div class="agent-shell" style="--info-card-accent:${s.accent}">
  <span class="agent-shell-bar"></span>
  <div class="info-card agent-card vF">${inner}</div>
</div>`;
  }

  return `
<div class="info-card agent-card ${variantKey}" style="--info-card-accent:${s.accent}">
${inner}
</div>`;
}

/* ── 墙 ── */
function renderWall() {
  const wall = document.getElementById("wall");
  wall.innerHTML = VARIANTS.map(
    (v) => `
<div class="slot" data-key="${v.key}">
  <div class="slot-head">
    <div class="slot-name">${v.name}<span class="slot-tag ${v.tag.cls}">${v.tag.text}</span></div>
    <div class="slot-desc">${v.desc}</div>
  </div>
  <div class="slot-stage" data-key="${v.key}">${cardMarkup(v.key, currentState)}</div>
</div>`
  ).join("");

  wall.querySelectorAll(".slot-stage").forEach((stage) => {
    stage.addEventListener("click", () => openLoupe(stage.dataset.key));
  });
}

/* ── 放大镜 ── */
function openLoupe(key) {
  const v = VARIANTS.find((x) => x.key === key);
  if (!v) return;
  document.getElementById("loupe-name").textContent = v.name;
  document.getElementById("loupe-note").innerHTML = v.note;
  document.getElementById("loupe-code").innerHTML = v.code;
  document.getElementById("loupe-zoom").innerHTML = cardMarkup(v.key, currentState);
  document.getElementById("loupe").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLoupe() {
  document.getElementById("loupe").hidden = true;
  document.body.style.overflow = "";
}

/* ── 控件 ── */
function applyWidth() {
  document.documentElement.style.setProperty("--card-w", currentWidth + "px");
}

function bindSegment(id, handler) {
  const seg = document.getElementById(id);
  seg.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      seg.querySelectorAll("button").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      handler(btn);
    });
  });
}

bindSegment("seg-state", (btn) => {
  currentState = btn.dataset.state;
  renderWall();
  if (!document.getElementById("loupe").hidden) {
    const key = document.getElementById("loupe-name").textContent;
    const v = VARIANTS.find((x) => x.name === key);
    if (v) openLoupe(v.key);
  }
});

bindSegment("seg-width", (btn) => {
  currentWidth = Number(btn.dataset.width);
  applyWidth();
});

bindSegment("seg-cap", (btn) => {
  currentCap = btn.dataset.cap;
  document.documentElement.style.setProperty("--bar-cap", currentCap + "px");
});

document.getElementById("chk-grid").addEventListener("change", (e) => {
  showGrid = e.target.checked;
  document.body.classList.toggle("grid-on", showGrid);
  document.documentElement.style.setProperty("--state-accent", STATE[currentState].accent);
});

document.getElementById("loupe-close").addEventListener("click", closeLoupe);
document.getElementById("loupe").addEventListener("click", (e) => {
  if (e.target.id === "loupe") closeLoupe();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLoupe();
});

/* ── init ── */
renderWall();
applyWidth();
