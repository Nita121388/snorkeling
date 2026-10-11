#!/usr/bin/env python3
"""Crawl the whole Wolai help-center tree via public APIs."""
import json, os, sys, time, gzip, urllib.request
from concurrent.futures import ThreadPoolExecutor

OUT = "/tmp/wolai/raw"
os.makedirs(OUT, exist_ok=True)
API = "https://api.wolai.com/v1/pages/getPageChunks"
HDR = {
    "Content-Type": "application/json",
    "Referer": "https://www.wolai.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept-Encoding": "gzip",
}

def post(path, body, tries=4):
    last = None
    for t in range(tries):
        try:
            req = urllib.request.Request(
                "https://api.wolai.com/v1/pages/" + path,
                data=json.dumps(body).encode(), headers=HDR, method="POST")
            with urllib.request.urlopen(req, timeout=40) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except Exception as e:
            last = e
            time.sleep(1.0 + t)
    raise last

def chunks(page_id):
    f = os.path.join(OUT, page_id + ".json")
    if os.path.exists(f) and os.path.getsize(f) > 50:
        return "cached"
    merged = None
    pos = {"stack": []}
    chunk = 0
    while chunk < 30:
        d = post("getPageChunks", {"pageId": page_id, "limit": 100,
                                   "position": pos, "chunkNumber": chunk})
        if d.get("code") != 1000:
            return "code%s" % d.get("code")
        if merged is None:
            merged = d
        else:
            merged["data"]["block"].update(d["data"]["block"])
        pos = d["data"].get("position") or {"stack": []}
        chunk += 1
        if not pos.get("stack"):
            break
        time.sleep(0.15)
    if merged is None:
        return "empty"
    json.dump(merged, open(f, "w"), ensure_ascii=False)
    return "ok%d" % len(merged["data"]["block"])

def title_of(v):
    a = (v.get("attributes") or {}).get("title")
    if not a:
        return ""
    out = []
    for part in a:
        if isinstance(part, str):
            out.append(part)
        elif isinstance(part, list):
            if part and isinstance(part[0], str) and part[0] not in ("B", "BiLink", "I", "C", "M", "H", "S"):
                out.append(part[0])
            if part and part[0] == "BiLink" and len(part) > 1:
                out.append(part[1])
    return "".join(out).strip()

if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "xhqeop8UHpVTMUSVmgz8nq"
    # 1. full subpage tree
    tree = post("getSharedSubPages", {"pageId": root})
    entries = tree["data"]
    ids = []
    seen = set()
    meta = {}
    def walk(nodes):
        for n in nodes:
            if n["id"] in seen:
                continue
            seen.add(n["id"])
            ids.append(n["id"])
            meta[n["id"]] = {"title": title_of(n), "icon": (n.get("setting") or {}).get("page_icon"),
                             "parent": n.get("parent_id"), "sub": n.get("sub_nodes", [])}
    walk(entries)
    ids.insert(0, root)
    json.dump(meta, open("/tmp/wolai/meta.json", "w"), ensure_ascii=False, indent=1)
    open("/tmp/wolai/ids.txt", "w").write("\n".join(ids) + "\n")
    print("total ids", len(ids))
    # 2. crawl chunks for all of them
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, res in zip(ids, ex.map(chunks, ids)):
            print(i, res, flush=True)
