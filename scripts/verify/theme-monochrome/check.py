#!/usr/bin/env python3
"""Monochrome 主题验收判据（八条门）。

读 frontend/app/theme.scss 与 pkg/wconfig/defaultconfig/termthemes.json，
输出可判定的数字。退出码 0 = 全绿，1 = 有断言失败，2 = 环境/解析错误。

用法：
    python scripts/verify/theme-monochrome/check.py
    python scripts/verify/theme-monochrome/check.py --json
"""

import json
import math
import re
import sys

THEME = "frontend/app/theme.scss"
TERM = "pkg/wconfig/defaultconfig/termthemes.json"
DESIGN_DOC = "docs/design-system.md"

# 目标值（来自 prd.md「目标值」表）
TARGET_SEMANTIC = {
    "--error-color": "#9c4a42",
    "--warning-color": "#8a641c",
    "--success-color": "#3f6b46",
    "--agent-working-color": "#3a6b96",
    "--agent-done-color": "#3f6b46",
    "--agent-stale-color": "#6b5b8a",
}
TARGET_CANVAS = "#f7f6f3"
LIGHT_CANVAS = "#f2eee5"
AA = 4.5
MIN_DELTA_E = 4.0


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def _lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(h):
    r, g, b = (_lin(x) for x in hex2rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def lab(h):
    r, g, b = (_lin(x) for x in hex2rgb(h))
    X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(X / Xn), f(Y / Yn), f(Z / Zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def delta_e(a, b):
    return math.dist(lab(a), lab(b))


def lightness(h):
    r, g, b = (x / 255 for x in hex2rgb(h))
    return (max(r, g, b) + min(r, g, b)) / 2 * 100


def mix(a, b, t):
    A, B = hex2rgb(a), hex2rgb(b)
    return "#%02x%02x%02x" % tuple(round(A[i] * t + B[i] * (1 - t)) for i in range(3))


def parse_block(theme_name):
    """返回某个 [data-theme="X"] 块内的 {token: raw_value} 与行号范围。"""
    lines = open(THEME, encoding="utf-8").read().splitlines()
    tokens, start, end, depth, inside = {}, None, None, 0, False
    pattern = re.compile(r'\[data-theme="%s"\]\s*\{' % re.escape(theme_name))
    for i, line in enumerate(lines):
        s = line.strip()
        if not inside and pattern.search(s):
            inside, start, depth = True, i, 1
            continue
        if inside:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                end, inside = i, False
                continue
            m = re.match(r"(--[a-z0-9-]+)\s*:\s*(.+?);", s)
            if m:
                tokens[m.group(1)] = m.group(2).strip()
    if start is None:
        raise SystemExit(f"✗ 找不到 [data-theme=\"{theme_name}\"] 块")
    return tokens, start, end


def count_token(token):
    return len(re.findall(rf"{token}\s*:", open(THEME, encoding="utf-8").read()))


def main():
    results, failures = [], []

    def check(name, ok, detail):
        results.append({"name": name, "ok": bool(ok), "detail": detail})
        if not ok:
            failures.append(name)

    try:
        mono, mono_start, mono_end = parse_block("monochrome")
        light, light_start, light_end = parse_block("light")
        term = json.load(open(TERM, encoding="utf-8"))["default-monochrome"]
    except (OSError, KeyError, SystemExit) as exc:
        print(f"✗ 环境错误: {exc}")
        return 2

    canvas = mono.get("--main-bg-color", "#ffffff")

    # ── 门 1/2：语义色对比度（画布 + chip）──
    for token, want in TARGET_SEMANTIC.items():
        got = mono.get(token)
        if got is None:
            check(f"1/2 {token}", False, "MISSING in monochrome block")
            continue
        on_canvas = contrast(got, canvas)
        chip = mix(got, "#ffffff", 0.12)
        on_chip = contrast(got, chip)
        check(
            f"1/2 {token}",
            got.lower() == want.lower() and on_canvas >= AA and on_chip >= AA,
            f"value={got} want={want} onCanvas={on_canvas:.2f} onChip={on_chip:.2f}",
        )

    # ── 门 3：diff token 三主题齐备 ──
    for token in ("--codeblock-diff-add-bg", "--codeblock-diff-del-bg",
                  "--codeblock-diff-add-text", "--codeblock-diff-del-text"):
        n = count_token(token)
        check(f"3 {token}", n == 3, f"occurrences={n} (want 3: dark/light/monochrome)")

    # ── 门 4：canvas 不与 light 撞色 ──
    de = delta_e(canvas, LIGHT_CANVAS)
    check("4 canvas vs light ΔE", de >= MIN_DELTA_E,
          f"canvas={canvas} light={LIGHT_CANVAS} ΔE={de:.2f} (want >={MIN_DELTA_E})")

    # ── 门 5：终端 white 可见 + 梯度单调 + bright 不比标准色浅 ──
    bg = term["background"]
    white_c = contrast(term["white"], bg)
    check("5 term-white contrast", white_c >= AA,
          f"{term['white']} on {bg} = {white_c:.2f} (want >={AA})")

    std = ["black", "red", "green", "blue", "yellow", "magenta", "cyan", "white"]
    brights = ["brightBlack", "brightRed", "brightGreen", "brightBlue",
               "brightYellow", "brightMagenta", "brightCyan", "brightWhite"]
    all16 = std + brights

    # 16 色全部可在背景上读
    unreadable = [(k, round(contrast(term[k], bg), 2)) for k in all16
                  if contrast(term[k], bg) < AA]
    check("5 all 16 ansi readable", not unreadable, f"unreadable={unreadable}")

    # 16 色两两可辨（相邻混淆会让 ls/git 输出看不出差异）
    worst = (999.0, "")
    for i, a in enumerate(all16):
        for b in all16[i + 1:]:
            d = delta_e(term[a], term[b])
            if d < worst[0]:
                worst = (d, f"{a}/{b}")
    check("5 all 16 ansi distinct", worst[0] >= 7.0,
          f"min ΔE={worst[0]:.1f} ({worst[1]}), want >=7.0")

    # bright 组必须与对应标准色可辨（浅底上 bright = 更深，不是更浅）
    pairs = [("brightBlack", "black"), ("brightRed", "red"), ("brightGreen", "green"),
             ("brightBlue", "blue"), ("brightYellow", "yellow"), ("brightMagenta", "magenta"),
             ("brightCyan", "cyan"), ("brightWhite", "white")]
    close = [(b, base, round(delta_e(term[b], term[base]), 1))
             for b, base in pairs if delta_e(term[b], term[base]) < 10.0]
    check("5 bright distinct from std", not close, f"too close={close}")

    # black 是最深的，brightWhite 是 bright 组里最深的（浅底上"更白"= 更醒目 = 更深）
    monotonic_ok = (lightness(term["black"]) == min(lightness(term[k]) for k in all16)
                    and lightness(term["brightWhite"]) == min(lightness(term[k]) for k in brights))
    check("5 black darkest / brightWhite boldest", monotonic_ok,
          f"black L*={lightness(term['black']):.1f} "
          f"brightWhite L*={lightness(term['brightWhite']):.1f}")

    # ── 门 6：dark / light 零影响 ──
    # (a) 目标值不得出现在 light 块
    light_leaks = [t for t, v in TARGET_SEMANTIC.items()
                   if light.get(t, "").lower() == v.lower()]
    check("6 light untouched (values)", not light_leaks, f"leaked into light: {light_leaks}")

    # (b) git diff 的新增行必须全部落在 monochrome 块内
    import subprocess
    diff = subprocess.run(["git", "diff", "-U0", "--", THEME],
                          capture_output=True, text=True, encoding="utf-8").stdout
    stray = []
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", diff, re.M):
        n, remaining = int(m.group(1)), int(m.group(2) or 1)
        body = diff[m.end():].splitlines()[1:]
        for line in body:
            if remaining <= 0:
                break
            if line.startswith("+"):
                if not (mono_start + 1 <= n <= mono_end + 1):
                    stray.append(f"L{n}:{line[1:60]}")
                n += 1
                remaining -= 1
            elif line.startswith(" "):
                n += 1
                remaining -= 1
            elif line.startswith("-"):
                continue
            else:
                break
    check("6 diff confined to mono block", not stray,
          f"stray={stray if stray else 'none'} (mono lines {mono_start + 1}..{mono_end + 1})")

    # ── 门 8：文档与代码一致 ──
    doc = open(DESIGN_DOC, encoding="utf-8").read()
    row = re.search(r"\|\s*Error\s*\|[^|]*\|[^|]*\|\s*`(#[0-9a-fA-F]+)`\s*\|", doc)
    doc_error = row.group(1).lower() if row else None
    check("8 doc Error == code", doc_error == mono.get("--error-color", "").lower(),
          f"doc={doc_error} code={mono.get('--error-color')}")

    row_canvas = re.search(r"\|\s*Canvas\s*\|[^|]*\|[^|]*\|\s*`(#[0-9a-fA-F]+)`\s*\|", doc)
    doc_canvas = row_canvas.group(1).lower() if row_canvas else None
    check("8 doc Canvas == code", doc_canvas == canvas.lower(),
          f"doc={doc_canvas} code={canvas}")

    if "--json" in sys.argv:
        print(json.dumps({"ok": not failures, "failures": failures,
                          "checks": results, "monochromeBlock": [mono_start + 1, mono_end + 1]},
                         indent=2, ensure_ascii=False))
    else:
        for r in results:
            print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['name']:38s} {r['detail']}")
        print()
        print(f"monochrome block: lines {mono_start + 1}..{mono_end + 1}")
        print(f"light block:      lines {light_start + 1}..{light_end + 1}")
        print(f"{len(results) - len(failures)}/{len(results)} passed")
        if failures:
            print("\nfailures:")
            for f in failures:
                print(f"  - {f}")

    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
