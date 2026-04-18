#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_SVG="$ROOT_DIR/assets/snorkeling-icon.svg"
BUILD_DIR="$ROOT_DIR/build"
BUILD_ICONS_DIR="$BUILD_DIR/icons"
PUBLIC_LOGOS_DIR="$ROOT_DIR/public/logos"

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

# Convert SVG to a high-resolution transparent PNG base image.
sips -s format png "$SRC_SVG" --out "$TMP_BASE_PNG" >/dev/null
sips -z 1024 1024 "$TMP_BASE_PNG" --out "$TMP_BASE_PNG" >/dev/null

# Add a transparent safe margin around the emoji so it does not touch icon edges.
ffmpeg -y \
    -i "$TMP_BASE_PNG" \
    -vf "scale=896:896:flags=lanczos,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=0x00000000" \
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
