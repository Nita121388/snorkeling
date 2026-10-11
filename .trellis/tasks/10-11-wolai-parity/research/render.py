#!/usr/bin/env python3
"""Render Wolai block-tree JSON (getPageChunks) into readable text."""
import json, os, sys

RAW = "/tmp/wolai/raw"
SKIP = {"image", "video", "audio", "file", "thirdPartyApp", "bookmark"}
KNOWN = {"B", "I", "C", "S", "BiLink", "M", "H", "Link", "<>"}

def marks(v, ms):
    for m in ms or []:
        if not isinstance(m, list) or not m:
            continue
        if m[0] == "B":
            v = "**" + str(v) + "**"
        elif m[0] == "I":
            v = "*" + str(v) + "*"
        elif m[0] == "S":
            v = "~~" + str(v) + "~~"
        elif m[0] == "C":
            v = "`" + str(v) + "`"
        elif m[0] == "<>":
            v = "<" + str(v) + ">"
        elif m[0] == "h" and len(m) > 1:
            v = "{hl:%s}" % m[1]
        elif m[0] == "BiLink":
            v = "[[%s|%s]]" % (v, m[2] if len(m) > 2 else (m[1] if len(m) > 1 else ""))
        elif m[0] in ("c", "color") and len(m) > 1:
            v = "{fg:%s}" % m[1]
    return v

def rich(parts):
    out = []
    for p in parts or []:
        if isinstance(p, str):
            out.append(p); continue
        if not isinstance(p, list) or not p:
            continue
        if isinstance(p[0], str) and p[0] not in KNOWN:
            out.append(marks(p[0], p[1] if len(p) > 1 else None)); continue
        k = p[0]
        if k == "BiLink":
            out.append("[[%s|%s]]" % (p[1] if len(p) > 1 else "", p[2] if len(p) > 2 else ""))
        elif k == "M":
            out.append("@" + str(p[1]) if len(p) > 1 else "@")
        elif k == "H":
            out.append("{hl}")
        elif k == "Link":
            out.append("<%s>" % (p[1] if len(p) > 1 else ""))
        elif k == "<>":
            out.append("")
        else:
            out.append(json.dumps(p, ensure_ascii=False))
    return "".join(out)

def simple_table(cells_json, indent):
    if isinstance(cells_json, list):
        rows = cells_json
    else:
        try:
            rows = json.loads(cells_json)
        except Exception:
            return [indent + "<simpleTable raw: %s>" % str(cells_json)[:200]]
    lines = []
    for r in rows:
        cols = r.get("column") or []
        vals = [rich((c.get("attributes") or {}).get("title")) for c in cols]
        lines.append(indent + " | ".join(v.replace("\n", " / ") for v in vals))
    return lines

def render(page_id, raw_dir=RAW):
    p = os.path.join(raw_dir, page_id + ".json")
    j = json.load(open(p))
    blocks = j["data"]["block"]
    root = blocks.get(page_id, {}).get("value", {})
    order = root.get("sub_nodes") or list(blocks.keys())
    lines = []
    def emit(bid, depth):
        v = blocks.get(bid, {}).get("value")
        if v is None:
            lines.append("%s<missing %s>" % ("  " * depth, bid)); return
        t = v.get("type", "?")
        a = v.get("attributes") or {}
        st = v.get("setting") or {}
        ind = "  " * depth
        if t == "simpleTable":
            lines.extend(simple_table(a.get("cells", ""), ind)); return
        txt = rich(a.get("title"))
        extra = []
        if t == "code":
            extra.append("lang=%s" % a.get("language"))
        if st.get("color") and st["color"] not in ("Default", "default"):
            extra.append("color=%s" % st["color"])
        if st.get("background") and st["background"] not in ("inherit", "Default", "default"):
            extra.append("bg=%s" % st["background"])
        if a.get("checked") is not None:
            extra.append("checked=%s" % a["checked"])
        for kk in ("url", "src", "link", "language", "align", "type"):
            if isinstance(a.get(kk), str) and a[kk]:
                extra.append("%s=%s" % (kk, a[kk][:80]))
        ex = (" {" + ", ".join(extra) + "}") if extra else ""
        if t in SKIP:
            lines.append("%s<%s>%s" % (ind, t, ex))
        elif t == "divider":
            lines.append(ind + "---")
        else:
            lines.append("%s[%s]%s %s" % (ind, t, ex, txt))
        for c in v.get("sub_nodes") or []:
            emit(c, depth + 1)
    for b in order:
        emit(b, 0)
    return "\n".join(lines)

if __name__ == "__main__":
    for pid in sys.argv[1:]:
        print("=" * 20, pid)
        print(render(pid))
