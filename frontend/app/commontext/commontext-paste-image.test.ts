// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

import {
    buildPasteImageFileName,
    buildPasteImageMarkdown,
    formatByteSize,
    isPasteImageTooLarge,
    isSupportedPasteImageType,
    materializePastedImages,
    pickPastedImages,
    resolvePasteImageDir,
    spliceTextAtRange,
    PASTE_IMAGE_MAX_BYTES,
} from "./commontext-paste-image";

function makeFile(type: string, size: number, name = "clip.png"): File {
    const blob = new Blob([new Uint8Array(size)], { type });
    return new File([blob], name, { type });
}

function makeItem(type: string, blob: Blob | null, kind = "file") {
    return { kind, type, getAsFile: () => blob };
}

function makePng(size = 32): Blob {
    return makeFile("image/png", size);
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("paste-image dispatch (image vs text)", () => {
    it("returns no blobs for a plain-text paste so native paste runs untouched", () => {
        const item = makeItem("text/plain", new Blob(["hello"], { type: "text/plain" }), "string");
        expect(pickPastedImages([item])).toEqual([]);
    });

    it("returns no blobs when the clipboard carries only html text", () => {
        const item = makeItem("text/html", new Blob(["<p>hi</p>"], { type: "text/html" }), "string");
        expect(pickPastedImages([item])).toEqual([]);
    });

    it("picks image items in clipboard order and ignores text alongside them", () => {
        const png = makePng();
        const webp = makeFile("image/webp", 16, "clip.webp");
        const items = [
            makeItem("text/plain", new Blob(["text"], { type: "text/plain" }), "string"),
            makeItem("image/png", png),
            makeItem("image/webp", webp),
        ];
        expect(pickPastedImages(items)).toEqual([png, webp]);
    });

    it("skips unsupported image types and non-file kinds", () => {
        const svg = makeFile("image/svg+xml", 32, "clip.svg");
        const png = makePng();
        const items = [makeItem("image/svg+xml", svg), makeItem("image/png", png), makeItem("image/png", png, "string")];
        expect(pickPastedImages(items)).toEqual([png]);
    });

    it("treats an empty / missing item list as a text paste", () => {
        expect(pickPastedImages(null)).toEqual([]);
        expect(pickPastedImages(undefined)).toEqual([]);
        expect(pickPastedImages([])).toEqual([]);
    });

    it("accepts every documented mime and rejects anything else", () => {
        expect(isSupportedPasteImageType("image/png")).toBe(true);
        expect(isSupportedPasteImageType("image/jpeg")).toBe(true);
        expect(isSupportedPasteImageType("IMAGE/WEBP")).toBe(true);
        expect(isSupportedPasteImageType("image/gif")).toBe(true);
        expect(isSupportedPasteImageType("image/bmp")).toBe(false);
        expect(isSupportedPasteImageType("text/plain")).toBe(false);
        expect(isSupportedPasteImageType(null)).toBe(false);
    });

    it("enforces the 10MB ceiling", () => {
        expect(PASTE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
        expect(isPasteImageTooLarge(PASTE_IMAGE_MAX_BYTES)).toBe(false);
        expect(isPasteImageTooLarge(PASTE_IMAGE_MAX_BYTES + 1)).toBe(true);
        expect(formatByteSize(PASTE_IMAGE_MAX_BYTES)).toBe("10.0 MB");
    });
});

describe("paste-image markdown emission", () => {
    it("builds a stable waveterm_paste_* filename per mime", () => {
        const name = buildPasteImageFileName("image/jpeg", 1700000000000, () => 0.5);
        expect(name.startsWith("waveterm_paste_1700000000000_")).toBe(true);
        expect(name.endsWith(".jpg")).toBe(true);
    });

    it("wraps destinations with spaces in angle brackets", () => {
        expect(buildPasteImageMarkdown("/tmp/a.png")).toBe("![pasted image](/tmp/a.png)");
        expect(buildPasteImageMarkdown("/tmp/My Screenshots/a.png")).toBe(
            "![pasted image](</tmp/My Screenshots/a.png>)"
        );
    });

    it("inserts the reference at the caret range", () => {
        const out = spliceTextAtRange("hello world", 6, 11, "![img](x.png)");
        expect(out.text).toBe("hello ![img](x.png)");
        expect(out.caret).toBe(6 + "![img](x.png)".length);
    });

    it("clamps out-of-range carets instead of producing garbage", () => {
        const out = spliceTextAtRange("abc", 99, 200, "X");
        expect(out.text).toBe("abcX");
        expect(out.caret).toBe(4);
    });
});

describe("attachment subdir（11-24 R9）", () => {
    it("默认子目录仍是 commontext-images（CommonText 行为零变化）", () => {
        expect(resolvePasteImageDir("/data")).toBe("/data/commontext-images");
        // 显式子目录（overview 发送框通道）
        expect(resolvePasteImageDir("/data", "overview-send-images")).toBe("/data/overview-send-images");
        // 空串回落默认，不产生裸 data dir
        expect(resolvePasteImageDir("/data", "")).toBe("/data/commontext-images");
    });

    it("拿不到 data dir 时返回 null（调用方给明确错误）", () => {
        expect(resolvePasteImageDir(null)).toBeNull();
        expect(resolvePasteImageDir("   ")).toBeNull();
    });
});

describe("materializePastedImages", () => {
    it("uses the default writer when no writer is injected", async () => {
        vi.stubGlobal("window", { api: { getDataDir: () => "/data" } });
        vi.spyOn(Date, "now").mockReturnValue(1700000000000);
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        const mkdir = vi.spyOn(RpcApi, "FileMkdirCommand").mockResolvedValue(undefined);
        const write = vi.spyOn(RpcApi, "FileWriteCommand").mockResolvedValue(undefined);
        const fileName = buildPasteImageFileName("image/png", 1700000000000, () => 0.5);

        const out = await materializePastedImages([makePng()]);

        expect(out.failures).toEqual([]);
        expect(out.written).toBe(1);
        expect(out.markdown).toBe(`![pasted image](/data/commontext-images/${fileName})`);
        expect(mkdir).toHaveBeenCalledWith(TabRpcClient, {
            info: { path: "wsh://local//data/commontext-images", mimetype: "directory" },
        });
        expect(write).toHaveBeenCalledWith(TabRpcClient, {
            info: { path: `wsh://local//data/commontext-images/${fileName}`, mimetype: "image/png" },
            data64: expect.any(String),
        });
    });

    it("writes every image in order and emits one reference each", async () => {
        const written: string[] = [];
        const out = await materializePastedImages([makePng(), makeFile("image/webp", 16, "b.webp")], async (blob) => {
            written.push(blob.type);
            return `/data/${written.length}.${blob.type.split("/")[1]}`;
        });
        expect(written).toEqual(["image/png", "image/webp"]);
        expect(out.written).toBe(2);
        expect(out.failures).toEqual([]);
        expect(out.markdown).toBe("![pasted image](/data/1.png)\n![pasted image](/data/2.webp)");
    });

    it("reports the oversized image and never references it", async () => {
        // 只读 size：writer 被 mock，这里只需要 size/type 两个字段。
        const tooBig = { type: "image/png", size: PASTE_IMAGE_MAX_BYTES + 1024 * 1024 } as unknown as Blob;
        const ok = makePng();
        const out = await materializePastedImages([tooBig, ok], async () => "/data/ok.png");
        expect(out.written).toBe(1);
        expect(out.markdown).toBe("![pasted image](/data/ok.png)");
        expect(out.failures).toHaveLength(1);
        expect(out.failures[0]).toContain("11.0 MB");
        expect(out.failures[0]).toContain("limit is 10.0 MB");
        expect(out.failures[0]).not.toContain("/data/");
    });

    it("emits nothing when every write fails", async () => {
        const out = await materializePastedImages([makePng(), makePng()], async () => {
            throw new Error("disk full");
        });
        expect(out.markdown).toBe("");
        expect(out.written).toBe(0);
        expect(out.failures).toEqual(["Image paste failed (32 B): disk full", "Image paste failed (32 B): disk full"]);
    });
});