// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 观察层：一次 case 采样 = 编辑前 → 真实双击 → 编辑中 → Esc → 退出后，三态截图 + 结构化几何。
// 产出是 oracle 的唯一输入，也是 report 的证据。

import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { waitFor } from "./cdp.mjs";
import { FIXTURE_SENTINEL, bringFixtureIntoView } from "./open.mjs";
import { cropPng, inkPixelCount, readPng, scalePng, writePng } from "./pixel.mjs";

/**
 * 判定"这张截图是空片"的墨迹像素下限。一行业务文案的裁切至少几十个墨迹像素，
 * 取 12 既能容忍极淡的抗锯齿，又不会放过"纯背景 + 一条边框"这种伪内容。
 */
const BlankInkPixelThreshold = 12;

const SENTINEL = JSON.stringify(FIXTURE_SENTINEL);

/**
 * 找到"真正可见、可编辑、且在最顶层"的哨兵 markdown 根。
 * 只匹配哨兵是不够的：dev 实例的旧布局里可能还有面板盖在 markdown 上，
 * 那时双击坐标会落到遮挡物上 → 编辑器打不开（实测踩到）。
 */
function rootExpr() {
  return `(() => {
        const roots = [...document.querySelectorAll(".markdown-render-root")]
            .filter((r) => (r.textContent || "").includes(${SENTINEL}));
        // 只要求"可编辑 + 尺寸合理"。不再要求"在最顶层 / 在视口内"：
        // 文档很长时目标常在折叠线以下，顶层判定会把所有候选都排除掉（踩过）。
        // 遮挡问题由"滚到视口中央 + 双击重试 + 失败诊断"兜。
        for (const r of roots) {
            const md = r.closest(".markdown");
            if (md == null || !md.classList.contains("markdown-editable")) continue;
            const rect = r.getBoundingClientRect();
            if (rect.width <= 50 || rect.height <= 20) continue;
            return r;
        }
        return null;
    })()`;
}

/**
 * 内联标记 token 签名（词级内联样式回归的检测数据）。
 * 为什么需要：像素/结构化度量对**词级**变化是被稀释的（一个词丢粗体只占整块墨迹 2~5%），
 * 但 `code` 丢等宽字体、`strong` 丢字重正是这条链路历史上真实踩到的回归。
 * DOM 级签名零像素噪声，直接比对 font-family / weight / style / color。
 */
function inlineTokensJs(scopeExpr) {
  return `(() => {
        const scope = ${scopeExpr};
        if (scope == null) return null;
        // 过滤无文字内容的元素：图标（折叠钮 chevron 的 <i class="fa…">）没有文本，
        // 不是文字内联标记；把图标当 token 会把"编辑态没有折叠钮"误报成样式回归。
        const els = [...scope.querySelectorAll("code, strong, b, em, i, kbd, samp, del, s, mark, a")].filter(
            (el) => (el.textContent || "").trim() !== ""
        );
        return els.map((el) => {
            const cs = getComputedStyle(el);
            return {
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || "").trim().slice(0, 40),
                font: String(cs.fontFamily || "").replace(/\s+/g, ""),
                weight: String(cs.fontWeight || ""),
                style: String(cs.fontStyle || ""),
                color: String(cs.color || ""),
            };
        });
    })()`;
}

function probeTargetJs(caseDef) {
  const target = caseDef.target ?? {};
  return `(() => {
        const root = ${rootExpr()};
        if (root == null) return { error: "no-markdown-root-with-sentinel" };
        // within 是「限定搜索范围」：可以就是 root 本身（.markdown-render-root），也可以是 root 的后代。
        // 旧实现直接在 root 里 querySelector(".markdown-render-root") → 永远是 null。
        const withinSel = ${JSON.stringify(target.within ?? null)};
        let scope = root;
        if (withinSel != null && withinSel !== "") {
            scope = root.matches(withinSel) ? root : (root.querySelector(withinSel) ?? root);
        }
        let el = scope.querySelector(${JSON.stringify(target.selector)});
        if (el == null) return { error: "no-target", selector: ${JSON.stringify(target.selector)} , scopeText: (scope.textContent||"").slice(0,80) };
        // 复刻 markdown.tsx 的锚点提升规则：li 内部还有子列表时，点击实际锚定到父级 ol/ul。
        // 探针必须同规则，否则"第一个文本节点"会取到被点条目的文字，
        // 而编辑器锚在整个列表的第一项上 → 量出 24px 的假偏移（实测假红）。
        if (el.tagName === "LI" && el.querySelector("ol, ul") != null) {
            const parentList = el.parentElement?.closest("ol, ul");
            if (parentList != null) el = parentList;
        }
        const rect = el.getBoundingClientRect();
        // 阅读态的内联标记签名：与编辑态（describeDuringJs）的同源比对，抓词级样式回归
        const inline = (() => {
            try {
                const els = [...el.querySelectorAll("code, strong, b, em, i, kbd, samp, del, s, mark, a")].filter(
                    (x) => (x.textContent || "").trim() !== ""
                );
                return els.map((x) => {
                    const cs = getComputedStyle(x);
                    return {
                        tag: x.tagName.toLowerCase(),
                        text: (x.textContent || "").trim().slice(0, 40),
                        font: String(cs.fontFamily || "").replace(/\s+/g, ""),
                        weight: String(cs.fontWeight || ""),
                        style: String(cs.fontStyle || ""),
                        color: String(cs.color || ""),
                    };
                });
            } catch (e) {
                return null;
            }
        })();
        // 第一个非空文本节点的"第一行"墨迹矩形：双击点与零位移基准都取它。
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = null;
        while ((node = walker.nextNode()) != null) { if ((node.nodeValue || "").trim() !== "") break; }
        let ink = null;
        if (node != null) {
            const range = document.createRange();
            range.selectNodeContents(node);
            const rects = range.getClientRects();
            const first = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
            ink = { x: first.left, y: first.top, w: first.width, h: first.height };
        }
        return {
            tag: el.tagName,
            cls: el.className,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height, right: rect.right },
            ink,
            inline,
            scrollHeight: el.scrollHeight,
            overlayPresent: document.querySelector(".inline-edit-overlay") != null,
        };
    })()`;
}

function describeDuringJs() {
  return `(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov == null) return { error: "no-overlay" };
        const ovRect = ov.getBoundingClientRect();
        const root = ov.querySelector(".wysiwyg-editor");
        const firstList = ov.querySelector(".wysiwyg-list > ul, .wysiwyg-list > ol, .wysiwyg-editor > ul, .wysiwyg-editor > ol");
        const firstLi = ov.querySelector(".wysiwyg-list > ul > li, .wysiwyg-list > ol > li, .wysiwyg-editor > ul > li, .wysiwyg-editor > ol > li");
        const cs = (el, prop, pseudo) => (el == null ? null : getComputedStyle(el, pseudo ?? null).getPropertyValue(prop));
        // 编辑器中第一个文本节点的第一行墨迹
        let ink = null;
        const host = root ?? ov.querySelector("textarea");
        if (host != null) {
            const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
            let node = null;
            while ((node = walker.nextNode()) != null) { if ((node.nodeValue || "").trim() !== "") break; }
            if (node != null) {
                const range = document.createRange();
                range.selectNodeContents(node);
                const rects = range.getClientRects();
                const first = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
                ink = { x: first.left, y: first.top, w: first.width, h: first.height };
            }
        }
        // marker（::before）没有直接 rect：用 computed 的定位属性 + 宽度反推。
        // 两种模式下定位方式不同，必须分开算（以前硬编码成"在 li 左侧一列"，
        // 导致 first-line 缩进模式（折叠式有序项）永远被误报 marker 不在 overlay 内）：
        //   常规模式   → right: 100%，marker 带在 li 左侧的 padding 区
        //   first-line → left: <px>，marker 带在 li 盒内部
        let marker = null;
        if (firstLi != null) {
            const liRect = firstLi.getBoundingClientRect();
            const width = parseFloat(cs(firstLi, "width", "::before")) || 0;
            const rawLeft = cs(firstLi, "left", "::before");
            const rawRight = cs(firstLi, "right", "::before");
            const leftPx = rawLeft != null && rawLeft !== "auto" ? parseFloat(rawLeft) : NaN;
            // 绝对定位的 left 相对 containing block 的 padding box（= border box + border-left），
            // 必须补 border，否则 li 带 border 时 marker 带整体偏移（与 resolveListContinuation 同思路）
            const borderLeft = parseFloat(cs(firstLi, "border-left-width")) || 0;
            let bandX = liRect.left - width;
            let anchor = "left-of-li";
            if (Number.isFinite(leftPx)) {
                bandX = liRect.left + borderLeft + leftPx;
                anchor = "left-var";
            }
            marker = {
                content: cs(firstLi, "content", "::before"),
                width,
                position: cs(firstLi, "position", "::before"),
                cssLeft: rawLeft,
                cssRight: rawRight,
                anchor,
                rect: { x: bandX, y: liRect.top, w: width, h: liRect.height },
            };
        }
        const padBox = {
            left: ovRect.left,
            top: ovRect.top,
            right: ovRect.left + ov.clientWidth,
            bottom: ovRect.top + ov.clientHeight,
        };
        // 所有子元素是否都在 overlay 的可视区内（裁剪判定）
        let maxChildBottom = -Infinity;
        let maxChildRight = -Infinity;
        for (const child of ov.querySelectorAll("*")) {
            const r = child.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.bottom > maxChildBottom) maxChildBottom = r.bottom;
            if (r.right > maxChildRight) maxChildRight = r.right;
        }
        return {
            editorKind: ov.getAttribute("data-block-kind"),
            hasTextarea: ov.querySelector("textarea") != null,
            // 编辑态的内联标记签名（与阅读态 probe.inline 比对，抓词级样式回归）
            inline: ${inlineTokensJs("ov")},
            overlay: {
                x: ovRect.x, y: ovRect.y, w: ovRect.width, h: ovRect.height,
                right: ovRect.right, bottom: ovRect.bottom,
                scrollHeight: ov.scrollHeight,
                clientHeight: ov.clientHeight,
                clientWidth: ov.clientWidth,
                overflowY: cs(ov, "overflow-y"),
                contain: cs(ov, "contain"),
                padBox,
            },
            editorRoot: root == null ? null : {
                tag: root.tagName,
                cls: root.className,
                paddingLeft: cs(root, "padding-left"),
                whiteSpace: cs(root, "white-space"),
                overflow: cs(root, "overflow"),
            },
            firstList: firstList == null ? null : {
                tag: firstList.tagName,
                marginLeft: cs(firstList, "margin-left"),
                paddingLeft: cs(firstList, "padding-left"),
                listStyleType: cs(firstList, "list-style-type"),
            },
            firstLi: firstLi == null ? null : {
                paddingLeft: cs(firstLi, "padding-left"),
                marginTop: cs(firstLi, "margin-top"),
                position: cs(firstLi, "position"),
            },
            marker,
            ink,
            childExtent: { maxChildBottom, maxChildRight },
            inlineEditLog: (window.__inlineEditLog || []).slice(-40).map((e) => ({ msg: e.msg, t: e.t })),
        };
    })()`;
}

function escapeAndDescribeJs() {
  return `(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov != null) {
            const editable = ov.querySelector("textarea, .wysiwyg-editor, [contenteditable]") || ov;
            editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        }
        return document.querySelector(".inline-edit-overlay") != null;
    })()`;
}

function afterEscJs(caseDef) {
  return `(() => {
        const root = ${rootExpr()};
        let el = root == null ? null : root.querySelector(${JSON.stringify((caseDef.target ?? {}).selector)});
        // 与 probe 一致地复刻"带子列表的 li 提升为父级列表"，否则退出后量的是另一个元素，
        // clean-exit 会误报 Δy≈24px（实测假红）。
        if (el != null && el.tagName === "LI" && el.querySelector("ol, ul") != null) {
            const parentList = el.parentElement?.closest("ol, ul");
            if (parentList != null) el = parentList;
        }
        const rect = el == null ? null : el.getBoundingClientRect();
        return {
            overlayGone: document.querySelector(".inline-edit-overlay") == null,
            hiddenLeft: document.querySelectorAll(".inline-edit-hidden").length,
            activeLeft: document.querySelectorAll(".inline-edit-active").length,
            rect: rect == null ? null : { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        };
    })()`;
}

function saveTemp(buf, outDir, name) {
  const file = path.join(outDir, name);
  writeFileSync(file, buf);
  return file;
}

/** 观察一次 case。返回 observation；截图写进 outDir。 */
export async function observeCase(client, caseDef, outDir) {
  await bringFixtureIntoView(client);

  // 上一次没退干净会让本次采样从一开始就错
  await client.evaluate(`(() => {
        const ov = document.querySelector(".inline-edit-overlay");
        if (ov != null) {
            const editable = ov.querySelector("textarea, .wysiwyg-editor, [contenteditable]") || ov;
            editable.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        }
        return true;
    })()`);
  await new Promise((r) => setTimeout(r, 150));

  // 先把目标滚进视口中央再量：文档很长时目标常在折叠线以下，
  // 此时 crop 会被 pngjs 夹成 1px（实测：before=0 during=0 行带、diff 全 0）。
  const scrollExpr = `(() => {
        const root = ${rootExpr()};
        if (root == null) return "no-root";
        const withinSel = ${JSON.stringify((caseDef.target ?? {}).within ?? null)};
        let scope = root;
        if (withinSel != null && withinSel !== "") scope = root.matches(withinSel) ? root : (root.querySelector(withinSel) ?? root);
        const el = scope.querySelector(${JSON.stringify((caseDef.target ?? {}).selector)});
        if (el == null) return "no-target";
        el.scrollIntoView({ block: "center", behavior: "auto" });
        return "ok";
    })()`;
  const scrollRes = await client.evaluate(scrollExpr);
  if (scrollRes !== "ok") {
    throw new Error(`目标定位/滚动失败（${caseDef.id}）: ${scrollRes}`);
  }
  await new Promise((r) => setTimeout(r, 250));

  const probe = await client.evaluate(probeTargetJs(caseDef));
  if (probe?.error != null) {
    throw new Error(`目标解析失败（${caseDef.id}）: ${JSON.stringify(probe)}`);
  }
  if (probe.overlayPresent) {
    throw new Error(`采样前页面上已有 inline-edit 覆盖层（${caseDef.id}），上一轮没退干净`);
  }
  if (probe.ink == null) {
    throw new Error(`目标没有可定位文本（${caseDef.id}）`);
  }

  // 截图裁切：包含 marker 列的宽裁切（给人看 / 给 diff 用）；
  // 规则层会再在内存里裁出"纯文本区"用于墨迹剖面。
  const pad = 40;
  // 裁切要"紧贴块"：太高会把上下相邻的段落/标题也框进来，墨迹剖面就会多出无关行带
  // （实测：段落的 1 行被判成 4 行，误报"编辑态少了 1 行"）。
  const crop = {
    x: Math.max(0, probe.rect.x - pad),
    y: Math.max(0, probe.rect.y - 2),
    width: probe.rect.w + pad + 24,
    height: probe.rect.h + 4,
  };
  const textAreaCrop = {
    x: Math.max(0, probe.ink.x - 2),
    y: Math.max(0, probe.rect.y - 2),
    width: Math.max(4, probe.rect.right - probe.ink.x + 8),
    height: probe.rect.h + 4,
  };

  const img = (name) => path.join(outDir, `${caseDef.id}-${name}.png`);
  // 截图层的环境退化告警（逐张收集，进 observation.degradedTrace）
  const shotWarnings = [];
  /**
   * 截图一条路，两条分支必须分开：
   *
   *   clip 生效  → 产物**已经是 crop 区域**（可能带 DPR 缩放，实测 2x），
   *                只需缩放到 CSS 像素后直接落盘。
   *                这里如果又拿绝对 CSS 坐标 crop 一次，就会越界被 clamp 成 1x1
   *                （实测：图像 327x89 再按 x=1015 裁 → 1x1，下游全部假红）。
   *   clip 失效  → 拿到整窗图，先归一到 CSS 宽再按 CSS 坐标裁。
   */
  const shoot = async (name) => {
    const rawPath = path.join(outDir, `${caseDef.id}-${name}-raw.png`);
    const cleanRaw = () => {
      // 原始整窗/2x 截图只在调试时保留（VERIFY_DEBUG_SHOT=1），
      // 否则是纯堆料（report 不引用它）；处理后的图才是产物。
      if (process.env.VERIFY_DEBUG_SHOT !== "1") {
        try {
          rmSync(rawPath, { force: true });
        } catch {}
      }
    };
    try {
      const shot = await client.screenshot(crop);
      const buffer = Buffer.isBuffer(shot) ? shot : shot.buffer;
      if (Array.isArray(shot.degradedTrace) && shot.degradedTrace.length > 0) {
        shotWarnings.push(`截图(${name})降级: ${shot.degradedTrace.join(" | ")}`);
      }
      let png = readPng(saveTemp(buffer, outDir, `${caseDef.id}-${name}-raw.png`));
      const wantW = Math.max(1, Math.round(crop.width));
      const wantH = Math.max(1, Math.round(crop.height));
      const dbg = (msg) => {
        if (process.env.VERIFY_DEBUG_SHOT === "1") {
          console.error(`[shot:${caseDef.id}:${name}] ${msg}`);
        }
      };
      dbg(
        `crop=${JSON.stringify(crop)} want=${wantW}x${wantH} raw=${png.width}x${png.height} clip=${JSON.stringify(shot.clip ?? null)} full=${shot.fullViewport}`
      );
      // 退化守门：crop 本身异常（rect 为 NaN / 目标超出视口）时不许静默落盘。
      if (!Number.isFinite(crop.width) || !Number.isFinite(crop.height) || wantW <= 2 || wantH <= 2) {
        const vp = await client.evaluate(`({ w: innerWidth, h: innerHeight })`).catch(() => null);
        throw new Error(
          `crop 退化到 ${wantW}x${wantH}：crop=${JSON.stringify(crop)} viewport=${JSON.stringify(vp)}（目标可能超出视口或 rect 异常）`
        );
      }

      const fullWindowCrop = async (reason) => {
        dbg(`整窗重拍：${reason}`);
        const fullShot = await client.screenshot();
        const fullBuf = Buffer.isBuffer(fullShot) ? fullShot : fullShot.buffer;
        let fullPng = readPng(saveTemp(fullBuf, outDir, `${caseDef.id}-${name}-full-raw.png`));
        const vp = await client.evaluate(`({ w: innerWidth, h: innerHeight })`).catch(() => null);
        const factor = vp?.w > 0 && fullPng.width >= vp.w * 0.9 ? vp.w / fullPng.width : 1;
        fullPng = scalePng(fullPng, factor);
        return cropPng(fullPng, crop);
      };

      if (shot.clip != null) {
        // clip 路径。但"我们发过 clip"不等于"浏览器真的尊重了 clip"：
        // Chromium 在窗口不可见等情况下会静默忽略 clip 返回整窗图。
        // 保真校验：产物宽必须在 clip 宽的 [0.9, 3] 倍内，否则视为 clip 失效走整窗分支。
        const targetW = Math.max(1, Math.round(shot.clip.width));
        const clipHonored = png.width >= targetW * 0.9 && png.width <= targetW * 3;
        if (clipHonored) {
          const factor = targetW / png.width;
          dbg(`clip-path factor=${factor}`);
          png = scalePng(png, factor);
        } else {
          dbg(`clip 未被尊重（raw=${png.width} 期望≈${targetW}），降级整窗路径`);
          const vp = await client.evaluate(`({ w: innerWidth, h: innerHeight })`).catch(() => null);
          const factor = vp?.w > 0 && png.width >= vp.w * 0.9 ? vp.w / png.width : 1;
          png = scalePng(png, factor);
          png = cropPng(png, crop);
        }
      } else {
        // 整窗兜底：按视口宽归一，再按 CSS 坐标裁。
        const vp = await client.evaluate(`({ w: innerWidth, h: innerHeight })`).catch(() => null);
        const factor = vp?.w > 0 && png.width >= vp.w * 0.9 ? vp.w / png.width : 1;
        dbg(`full-path vp=${JSON.stringify(vp)} factor=${factor}`);
        png = scalePng(png, factor);
        png = cropPng(png, crop);
      }
      // 空白片守门：尺寸正确但整片只有背景（实测过 clip 截图静默返回空片）。
      // 空片会让墨迹剖面得到 0 行带 —— 一路假红或假绿，且完全看不出是截图问题。
      // 这里先整窗重拍一次（真机上整窗截图是可靠的），仍然空白才记降级告警。
      // 只看"文本区"里的墨迹：整片 ink 会把块边框/绿色 accent 线也算进去
      // （实测：空片里一条边框 = 60+ 墨迹像素，整片阈值判不出来）。
      const textRel = {
        x: Math.round(textAreaCrop.x - crop.x),
        y: Math.round(textAreaCrop.y - crop.y),
        width: Math.round(textAreaCrop.width),
        height: Math.round(textAreaCrop.height),
      };
      const textInk = () => {
        try {
          return inkPixelCount(cropPng(png, textRel));
        } catch {
          return 0;
        }
      };
      const inkCount = textInk();
      if (inkCount < BlankInkPixelThreshold) {
        png = await fullWindowCrop(`文本区几乎空白（ink=${inkCount}px, textRel=${JSON.stringify(textRel)}）`);
        const retryInk = textInk();
        if (retryInk < BlankInkPixelThreshold) {
          shotWarnings.push(
            `截图(${name})疑似空白：ink=${retryInk}px（crop=${JSON.stringify(crop)}）；像素类断言请人工复核`
          );
        } else {
          dbg(`整窗重拍救回：ink=${inkCount} → ${retryInk}`);
        }
      }
      dbg(`final=${png.width}x${png.height}`);
      if (png.width <= 2 || png.height <= 2) {
        throw new Error(
          `截图产物退化到 ${png.width}x${png.height}：crop=${JSON.stringify(crop)} clip=${JSON.stringify(shot.clip ?? null)}`
        );
      }
      writePng(img(name), png);
      cleanRaw();
      return img(name);
    } catch (err) {
      cleanRaw();
      throw new Error(`截图(${name})失败：${String(err?.message ?? err)}`);
    }
  };
  await shoot("before");

  // 真实指针双击（不是合成事件）：坐标取第一行文本的墨迹中部
  const clickX = probe.ink.x + Math.min(3, Math.max(0, probe.ink.w - 1));
  const clickY = probe.ink.y + probe.ink.h / 2;
  // 真实双击；偶尔第一次点只"激活块"没进编辑 → 重试（最多 3 次）
  let opened = false;
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await client.dblclick(clickX, clickY);
    opened = await waitFor(client, `document.querySelector(".inline-edit-overlay") != null`, {
      timeoutMs: 3000,
      label: "inline-edit 覆盖层出现",
    })
      .then(() => true)
      .catch(() => false);
  }
  if (!opened) {
    throw new Error(`双击 3 次仍未打开 inline 编辑器（${caseDef.id}）；目标可能被遮挡或该块不可编辑`);
  }
  await new Promise((r) => setTimeout(r, 250));

  // 截图前临时把光标/选区抹掉（只作用于覆盖层，截完立刻移除）。
  // 绝不全局隐藏：那样会污染宿主窗口，用户点标题就看不到光标了（真实事故）。
  // 截图前临时抹掉所有"非内容 UI"（只作用于覆盖层上下文，截完立刻移除）。
  // 绝不全局隐藏：那样会污染宿主窗口，用户点标题就看不到光标了（真实事故，c8b4b77d）。
  // 1. 光标/选区高亮 —— 内容在视觉上不该被测量影响。
  // 2. 选区快捷按钮（data-selection-quick-action，橙色圆角灯泡钮）—— 它是 fixed
  //    定位的 UI 附件，落在文字行间的空白处，会把 pixel parity 打成假红（实测
  //    2026-11-04：行间空白被 24x24 圆角块填满，parity 6~12%）。
  //    它是宿主 UI 不是内容，隐藏仅限截图瞬间，截完即恢复。
  await client
    .evaluate(
      `(() => {
            document.getElementById("verify-shot-caret")?.remove();
            const style = document.createElement("style");
            style.id = "verify-shot-caret";
            style.textContent =
                ".inline-edit-overlay textarea,.inline-edit-overlay [contenteditable]{caret-color:transparent!important}" +
                ".inline-edit-overlay ::selection{background:transparent!important;color:inherit!important}" +
                "[data-selection-quick-action]{display:none!important}";
            document.head.appendChild(style);
            return true;
        })()`
    )
    .catch(() => false);
  await new Promise((r) => setTimeout(r, 100));

  const during = await client.evaluate(describeDuringJs());
  if (during?.error != null) {
    throw new Error(`编辑态观察失败（${caseDef.id}）: ${during.error}`);
  }
  await shoot("during");
  await client.evaluate(`document.getElementById("verify-shot-caret")?.remove()`).catch(() => {});

  // Esc 退出：优先真实键盘事件，兜底页内合成（真实键盘有时不落在编辑器上）。
  // 空按守卫：只在覆盖层确实存在时才按键 —— Escape 落不到编辑器时会命中 app 全局
  // 处理（关掉整个 preview block），上一轮就是这么把 fixture 关掉、后续 case 全部
  // 假红并连环新建重复块的。during 刚校验过覆盖层，但取景/延时期间它可能已被关掉。
  const overlayPresent = await client
    .evaluate(`document.querySelector(".inline-edit-overlay") != null`)
    .catch(() => false);
  if (overlayPresent) {
    await client.pressKey("Escape");
    const stillOpen = await client.evaluate(`document.querySelector(".inline-edit-overlay") != null`).catch(() => true);
    if (stillOpen) {
      await client.evaluate(escapeAndDescribeJs());
    }
  }
  await waitFor(client, `document.querySelector(".inline-edit-overlay") == null`, {
    timeoutMs: 6000,
    label: "覆盖层消失",
  });
  await new Promise((r) => setTimeout(r, 200));

  const afterEsc = await client.evaluate(afterEscJs(caseDef));
  await shoot("afterEsc");

  return {
    caseId: caseDef.id,
    target: probe,
    crop,
    textAreaCrop,
    during,
    afterEsc,
    // 截图层的环境退化告警（clip 失败降级到整窗等）——不能静默，
    // 必须进 report，否则"降级但仍能出图"会掩盖环境异常（审核意见 S3）
    degradedTrace: shotWarnings,
    images: {
      crop,
      before: img("before"),
      during: img("during"),
      afterEsc: img("afterEsc"),
    },
  };
}
