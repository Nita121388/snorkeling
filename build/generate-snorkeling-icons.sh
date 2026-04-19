#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SVG="$ROOT_DIR/assets/snorkeling-icon.svg"
BUILD_DIR="$ROOT_DIR/build"
BUILD_ICONS_DIR="$BUILD_DIR/icons"
PUBLIC_LOGOS_DIR="$ROOT_DIR/public/logos"
BASE_RENDER_SIZE=4096
OUTPUT_ICON_SIZE=1024
SAFE_CONTENT_SIZE=896

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "missing required command: $cmd" >&2
        exit 1
    fi
}

require_cmd sips
require_cmd iconutil
require_cmd ffmpeg
require_cmd qlmanage

if [[ ! -f "$SRC_SVG" ]]; then
    echo "source icon not found: $SRC_SVG" >&2
    exit 1
fi

mkdir -p "$BUILD_ICONS_DIR" "$PUBLIC_LOGOS_DIR"

TMP_BASE_PNG="$(mktemp "${TMPDIR:-/tmp}/snorkeling-base.XXXXXX.png")"
TMP_PADDED_PNG="$(mktemp "${TMPDIR:-/tmp}/snorkeling-padded.XXXXXX.png")"
TMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/snorkeling-icons.XXXXXX")"
TMP_ICONSET_DIR="$TMP_WORK_DIR/snorkeling.iconset"
mkdir -p "$TMP_ICONSET_DIR"

cleanup() {
    rm -f "$TMP_BASE_PNG"
    rm -f "$TMP_PADDED_PNG"
    rm -rf "$TMP_WORK_DIR"
}
trap cleanup EXIT

# Render SVG to a true high-resolution transparent PNG base image.
# `sips` alone rasterizes this Twemoji SVG at 36x36 first, which becomes blurry when scaled up.
render_svg_highres() {
    local src_svg="$1"
    local out_png="$2"
    local size="$3"
    local ql_dir
    local ql_png

    ql_dir="$(mktemp -d "${TMPDIR:-/tmp}/snorkeling-ql.XXXXXX")"
    qlmanage -t -s "$size" -o "$ql_dir" "$src_svg" >/dev/null 2>&1
    ql_png="$(find "$ql_dir" -maxdepth 1 -name '*.png' | head -n1)"
    if [[ -z "$ql_png" || ! -f "$ql_png" ]]; then
        rm -rf "$ql_dir"
        echo "failed to render source svg with qlmanage: $src_svg" >&2
        exit 1
    fi
    cp "$ql_png" "$out_png"
    rm -rf "$ql_dir"
}

remove_edge_matte_background() {
    local png_path="$1"
    python3 - "$png_path" <<'PY'
import struct
import sys
import zlib
from collections import deque

path = sys.argv[1]

with open(path, "rb") as f:
    blob = f.read()

if blob[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit(f"not a png: {path}")

chunks = []
i = 8
width = height = bit_depth = color_type = None
idat_parts = []

while i < len(blob):
    ln = struct.unpack(">I", blob[i : i + 4])[0]
    ctype = blob[i + 4 : i + 8]
    cdata = blob[i + 8 : i + 8 + ln]
    i += 12 + ln
    chunks.append((ctype, cdata))
    if ctype == b"IHDR":
        width, height, bit_depth, color_type, _comp, _filt, _inter = struct.unpack(">IIBBBBB", cdata)
    elif ctype == b"IDAT":
        idat_parts.append(cdata)
    elif ctype == b"IEND":
        break

if color_type != 6 or bit_depth != 8:
    # Keep original if format isn't RGBA8.
    raise SystemExit(0)

raw = zlib.decompress(b"".join(idat_parts))
bpp = 4
stride = width * bpp
pixels = bytearray(height * stride)

def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c

# Unfilter rows.
pos = 0
prev = bytearray(stride)
for y in range(height):
    ftype = raw[pos]
    pos += 1
    row = bytearray(raw[pos : pos + stride])
    pos += stride
    if ftype == 1:  # Sub
        for x in range(stride):
            left = row[x - bpp] if x >= bpp else 0
            row[x] = (row[x] + left) & 0xFF
    elif ftype == 2:  # Up
        for x in range(stride):
            row[x] = (row[x] + prev[x]) & 0xFF
    elif ftype == 3:  # Average
        for x in range(stride):
            left = row[x - bpp] if x >= bpp else 0
            up = prev[x]
            row[x] = (row[x] + ((left + up) // 2)) & 0xFF
    elif ftype == 4:  # Paeth
        for x in range(stride):
            left = row[x - bpp] if x >= bpp else 0
            up = prev[x]
            up_left = prev[x - bpp] if x >= bpp else 0
            row[x] = (row[x] + paeth(left, up, up_left)) & 0xFF
    pixels[y * stride : (y + 1) * stride] = row
    prev = row

def px_index(x: int, y: int) -> int:
    return (y * width + x) * 4

bg_i = px_index(0, 0)
bg_r, bg_g, bg_b, bg_a = pixels[bg_i : bg_i + 4]
if bg_a == 0:
    # Already transparent in corners.
    raise SystemExit(0)

tol = 18
visited = bytearray(width * height)
q = deque()

def matches_bg(x: int, y: int) -> bool:
    i2 = px_index(x, y)
    r, g, b, a = pixels[i2 : i2 + 4]
    if a == 0:
        return False
    return abs(r - bg_r) <= tol and abs(g - bg_g) <= tol and abs(b - bg_b) <= tol

def enqueue(x: int, y: int):
    vi = y * width + x
    if visited[vi]:
        return
    if not matches_bg(x, y):
        return
    visited[vi] = 1
    q.append((x, y))

# Seed flood fill from image borders only.
for x in range(width):
    enqueue(x, 0)
    enqueue(x, height - 1)
for y in range(1, height - 1):
    enqueue(0, y)
    enqueue(width - 1, y)

while q:
    x, y = q.popleft()
    i2 = px_index(x, y)
    pixels[i2 : i2 + 4] = b"\x00\x00\x00\x00"
    if x > 0:
        enqueue(x - 1, y)
    if x + 1 < width:
        enqueue(x + 1, y)
    if y > 0:
        enqueue(x, y - 1)
    if y + 1 < height:
        enqueue(x, y + 1)

# Re-encode with filter type 0.
scanlines = bytearray()
for y in range(height):
    scanlines.append(0)
    scanlines.extend(pixels[y * stride : (y + 1) * stride])
compressed = zlib.compress(bytes(scanlines), 9)

def chunk(ctype: bytes, cdata: bytes) -> bytes:
    return (
        struct.pack(">I", len(cdata))
        + ctype
        + cdata
        + struct.pack(">I", zlib.crc32(ctype + cdata) & 0xFFFFFFFF)
    )

ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
out = bytearray()
out.extend(b"\x89PNG\r\n\x1a\n")
out.extend(chunk(b"IHDR", ihdr))
out.extend(chunk(b"IDAT", compressed))
out.extend(chunk(b"IEND", b""))

with open(path, "wb") as f:
    f.write(out)
PY
}

render_svg_highres "$SRC_SVG" "$TMP_BASE_PNG" "$BASE_RENDER_SIZE"
remove_edge_matte_background "$TMP_BASE_PNG"

BASE_WIDTH="$(sips -g pixelWidth "$TMP_BASE_PNG" | awk '/pixelWidth/{print $2}')"
BASE_HEIGHT="$(sips -g pixelHeight "$TMP_BASE_PNG" | awk '/pixelHeight/{print $2}')"
if [[ -z "$BASE_WIDTH" || -z "$BASE_HEIGHT" || "$BASE_WIDTH" -lt "$OUTPUT_ICON_SIZE" || "$BASE_HEIGHT" -lt "$OUTPUT_ICON_SIZE" ]]; then
    echo "rendered base icon is too small: ${BASE_WIDTH}x${BASE_HEIGHT}" >&2
    exit 1
fi

# Add a transparent safe margin around the emoji so it does not touch icon edges.
ffmpeg -y \
    -i "$TMP_BASE_PNG" \
    -vf "scale=${SAFE_CONTENT_SIZE}:${SAFE_CONTENT_SIZE}:flags=lanczos,pad=${OUTPUT_ICON_SIZE}:${OUTPUT_ICON_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000" \
    -frames:v 1 "$TMP_PADDED_PNG" >/dev/null 2>&1

for size in 16 32 48 64 128 256 512 1024; do
    sips -z "$size" "$size" "$TMP_PADDED_PNG" --out "$BUILD_ICONS_DIR/${size}x${size}.png" >/dev/null
done

cp "$BUILD_ICONS_DIR/256x256.png" "$PUBLIC_LOGOS_DIR/snorkeling-logo-256.png"
cp "$BUILD_ICONS_DIR/256x256.png" "$PUBLIC_LOGOS_DIR/snorkeling-logo-dark.png"
cp "$SRC_SVG" "$PUBLIC_LOGOS_DIR/snorkeling-logo.svg"

cp "$BUILD_ICONS_DIR/16x16.png" "$TMP_ICONSET_DIR/icon_16x16.png"
cp "$BUILD_ICONS_DIR/32x32.png" "$TMP_ICONSET_DIR/icon_16x16@2x.png"
cp "$BUILD_ICONS_DIR/32x32.png" "$TMP_ICONSET_DIR/icon_32x32.png"
cp "$BUILD_ICONS_DIR/64x64.png" "$TMP_ICONSET_DIR/icon_32x32@2x.png"
cp "$BUILD_ICONS_DIR/128x128.png" "$TMP_ICONSET_DIR/icon_128x128.png"
cp "$BUILD_ICONS_DIR/256x256.png" "$TMP_ICONSET_DIR/icon_128x128@2x.png"
cp "$BUILD_ICONS_DIR/256x256.png" "$TMP_ICONSET_DIR/icon_256x256.png"
cp "$BUILD_ICONS_DIR/512x512.png" "$TMP_ICONSET_DIR/icon_256x256@2x.png"
cp "$BUILD_ICONS_DIR/512x512.png" "$TMP_ICONSET_DIR/icon_512x512.png"
cp "$BUILD_ICONS_DIR/1024x1024.png" "$TMP_ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$TMP_ICONSET_DIR" -o "$BUILD_DIR/icon.icns"

ffmpeg -y \
    -i "$BUILD_ICONS_DIR/16x16.png" \
    -i "$BUILD_ICONS_DIR/32x32.png" \
    -i "$BUILD_ICONS_DIR/48x48.png" \
    -i "$BUILD_ICONS_DIR/64x64.png" \
    -i "$BUILD_ICONS_DIR/128x128.png" \
    -i "$BUILD_ICONS_DIR/256x256.png" \
    -map 0:v -map 1:v -map 2:v -map 3:v -map 4:v -map 5:v \
    "$BUILD_DIR/icon.ico" >/dev/null 2>&1

echo "generated Snorkeling icons from: $SRC_SVG"
