// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { sortingFns } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";
import {
    buildLayer,
    buildPagerHintTexts,
    compareAlphanumeric,
    compareImageNames,
    compareStationPaths,
    displayStationDir,
    insertStationSorted,
    isImagePath,
    isSkipDir,
    orderedSubdirs,
    resolvePager,
    resolvePagerAnchor,
    type PagerEntry,
} from "./image-pager-model";

// 把 TanStack 的 sortingFn 适配成裸字符串比较器（其入参是 row.getValue(columnId)）
function tanstackAlphanumeric(a: string, b: string): number {
    const rowA = { getValue: (col: string) => (col === "name" ? a : null) };
    const rowB = { getValue: (col: string) => (col === "name" ? b : null) };
    // TanStack 内部会 String() 包一层
    return sortingFns.alphanumeric(rowA as never, rowB as never, "name");
}

// 目录预览对 name 列用 alphanumeric（先 toLowerCase）；我们复刻的也是同语义。
// 用一批刁钻名字对撞，保证"所见即所得"不是口头承诺。
const NAME_CORPUS = [
    "1.png",
    "2.png",
    "10.png",
    "a.png",
    "A.PNG",
    "a2.png",
    "a10.png",
    "a1b.png",
    "IMG_0001.jpg",
    "IMG_9999.jpg",
    "IMG_10000.jpg",
    "照片 2.jpeg",
    "照片 10.jpeg",
    "z-1.png",
    "z-2.png",
    "z-10.png",
    "b.jpeg",
    "b.tiff",
    "n.txt", // 非图片：只测比较器，不参与 buildLayer
    "9.png",
    "09.png",
];

describe("compareAlphanumeric — 与 TanStack alphanumeric 逐对一致", () => {
    it("全集对撞：符号一致（0/正/负），不依赖具体差值", () => {
        for (let i = 0; i < NAME_CORPUS.length; i++) {
            for (let j = 0; j < NAME_CORPUS.length; j++) {
                const a = NAME_CORPUS[i];
                const b = NAME_CORPUS[j];
                const mine = compareImageNames(a, b);
                const theirs = Math.sign(tanstackAlphanumeric(a.toLowerCase(), b.toLowerCase()));
                expect(Math.sign(mine)).toBe(theirs);
            }
        }
    });

    it("数字段按数值比：1 < 2 < 10（不是字典序 1,10,2）", () => {
        expect(compareAlphanumeric("img1.png", "img2.png")).toBeLessThan(0);
        expect(compareAlphanumeric("img2.png", "img10.png")).toBeLessThan(0);
        expect(compareAlphanumeric("img10.png", "img1.png")).toBeGreaterThan(0);
    });

    it("大小写不敏感（与目录预览 name 列同语义）", () => {
        expect(compareImageNames("A.PNG", "a.png")).toBe(0);
    });
});

describe("isImagePath / isSkipDir", () => {
    it("白名单命中与大小写", () => {
        expect(isImagePath("a/b/c.PNG")).toBe(true);
        expect(isImagePath("x.heic")).toBe(true);
        expect(isImagePath("x.txt")).toBe(false);
        expect(isImagePath("noext")).toBe(false);
        expect(isImagePath("archive.tar.gz")).toBe(false);
    });
    it("噪音目录跳过", () => {
        expect(isSkipDir(".git")).toBe(true);
        expect(isSkipDir("Node_Modules")).toBe(true);
        expect(isSkipDir("__pycache__")).toBe(true);
        expect(isSkipDir("Photos")).toBe(false);
    });
});

const ENTRIES: PagerEntry[] = [
    { path: "/a/2.png", name: "2.png", modtime: 30 },
    { path: "/a/10.png", name: "10.png", modtime: 20 },
    { path: "/a/1.png", name: "1.png", modtime: 10 },
    { path: "/a/b.png", name: "b.png", isdir: true }, // 目录但名字带图片后缀：不应入层
    { path: "/a/c.txt", name: "c.txt" },
    { path: "/a/sub1", name: "sub1", isdir: true },
    { path: "/a/.git", name: ".git", isdir: true },
    { path: "/a/node_modules", name: "node_modules", isdir: true },
];

describe("buildLayer", () => {
    it("只要图片文件，按 name 数值序", () => {
        expect(buildLayer(ENTRIES, "name")).toEqual(["/a/1.png", "/a/2.png", "/a/10.png"]);
    });
    it("modtime 降序（与目录预览 desc:true 一致）", () => {
        expect(buildLayer(ENTRIES, "modtime")).toEqual(["/a/2.png", "/a/10.png", "/a/1.png"]);
    });
});

describe("orderedSubdirs", () => {
    it("目录名升序，跳过噪音目录（名字像图片的目录仍要遍历）", () => {
        expect(orderedSubdirs(ENTRIES).map((e) => e.name)).toEqual(["b.png", "sub1"]);
    });
});

describe("resolvePager", () => {
    const layer = ["/a/1.png", "/a/2.png", "/a/3.png"];
    const stations = [
        { dir: "/a", images: ["/a/1.png", "/a/2.png", "/a/3.png"], first: "/a/1.png", last: "/a/3.png", count: 3 },
        { dir: "/a/sub1", images: ["/a/sub1/x.png", "/a/sub1/y.png"], first: "/a/sub1/x.png", last: "/a/sub1/y.png", count: 2 },
        { dir: "/b", images: ["/b/z.png"], first: "/b/z.png", last: "/b/z.png", count: 1 },
    ];

    it("中间位置：next/prev 正确，无站点提示", () => {
        const r = resolvePager(layer, stations, "/a/2.png");
        expect(r.next).toBe("/a/3.png");
        expect(r.prev).toBe("/a/1.png");
        expect(r.nextStation?.dir).toBe("/a/sub1");
        expect(r.position).toBe(1);
    });

    it("本层末尾：next 为空，nextStation 指向下一个文件夹", () => {
        const r = resolvePager(layer, stations, "/a/3.png");
        expect(r.next).toBeNull();
        expect(r.atLayerEnd).toBe(true);
        expect(r.nextStation?.first).toBe("/a/sub1/x.png");
    });

    it("最后站点末尾：nextStation 为 null（全树到底，不循环）", () => {
        const r = resolvePager(["/b/z.png"], stations, "/b/z.png");
        expect(r.next).toBeNull();
        expect(r.nextStation).toBeNull();
        expect(r.atLayerEnd).toBe(true);
    });

    it("站点中段：prev/next 站点正确", () => {
        const r = resolvePager(["/a/sub1/x.png", "/a/sub1/y.png"], stations, "/a/sub1/y.png");
        expect(r.nextStation?.dir).toBe("/b");
        expect(r.prevStation?.dir).toBe("/a");
    });

    it("路径分隔符归一（\\ 与 / 等价）", () => {
        const r = resolvePager(layer, stations, "/a/2.png", (p) => p.replace(/\\/g, "/"));
        expect(r.position).toBe(1);
    });

    it("跨站后本层=当前目录的图片序列（不是锚点层）", () => {
        // 打开 /a/1.png（锚点 /a）翻到下一站 sub1 的 x.png：本层应是 sub1 的 2 张
        const r = resolvePager(layer, stations, "/a/sub1/x.png");
        expect(r.position).toBe(0);
        expect(r.next).toBe("/a/sub1/y.png");
        expect(r.layerSize).toBe(2);
        expect(r.prevStation?.dir).toBe("/a");
        expect(r.nextStation?.dir).toBe("/b");
    });

    it("目录尚未进站：退回锚点层且 position=-1，仍不崩", () => {
        // 图片所在目录还没被索引（索引进行中）→ 用锚点层兜底
        const r = resolvePager(["/x/other.png"], stations, "/unknown/x.png");
        expect(r.position).toBe(-1);
        expect(r.layerSize).toBe(1);
        expect(r.atLayerEnd).toBe(true);
    });
});

describe("displayStationDir", () => {
    it("锚点自身显示为 .；子目录显示相对名", () => {
        expect(displayStationDir("/a", "/a")).toBe(".");
        expect(displayStationDir("/a/sub1", "/a")).toBe("sub1");
    });
});

describe("compareStationPaths / insertStationSorted — 确定性 DFS 先序", () => {
    it("父先于子，同级自然序，与完成顺序无关", () => {
        expect(compareStationPaths("/a", "/a/sub")).toBeLessThan(0);
        expect(compareStationPaths("/a/sub", "/a/sub/deep")).toBeLessThan(0);
        expect(compareStationPaths("/a/sub2", "/a/sub10")).toBeLessThan(0);
        expect(compareStationPaths("/a/zz", "/a/sub/deep")).toBeGreaterThan(0);
        expect(compareStationPaths("/a/b", "/a/b")).toBe(0);
    });
    it("乱序插入仍得到先序结果（并发完成顺序无关）", () => {
        const mk = (dir: string, n = 1) => ({ dir, images: Array.from({ length: n }, (_, i) => `${dir}/${i + 1}.png`), first: `${dir}/1.png`, last: `${dir}/${n}.png`, count: n });
        let stations: ReturnType<typeof mk>[] = [];
        // 故意按"最深的先完成"插入
        for (const dir of ["/a/zz", "/a/sub/deep", "/a/sub", "/a", "/a/b"]) {
            stations = insertStationSorted(stations, mk(dir));
        }
        expect(stations.map((s) => s.dir)).toEqual(["/a", "/a/b", "/a/sub", "/a/sub/deep", "/a/zz"]);
    });
});

describe("resolvePagerAnchor", () => {
    it("explorer-root 优先级最高", () => {
        expect(resolvePagerAnchor({ explorerRoot: "/x", filePath: "/a/b.png" })).toBe("/x");
    });
    it("无 explorer-root：无 sticky → 锚点取父目录（提升一级）", () => {
        expect(resolvePagerAnchor({ filePath: "/photos/2024/a.jpg" })).toBe("/photos");
    });
    it("文件系统根不再提升", () => {
        expect(resolvePagerAnchor({ filePath: "/a.jpg" })).toBe("/");
    });
    it("sticky 锚点有效且文件在其子树内时保留 sticky（不因提升覆盖）", () => {
        expect(resolvePagerAnchor({ stickyAnchor: "/photos/2024", filePath: "/photos/2024/sub/a.jpg" })).toBe("/photos/2024");
    });
});

describe("buildPagerHintTexts", () => {
    it("层尾且有下一站：文案含目标文件夹与快捷键", () => {
        const res = {
            position: 2,
            layerSize: 3,
            next: null,
            prev: "/a/2.png",
            nextStation: { dir: "/a/sub", images: ["/a/sub/x.png"], first: "/a/sub/x.png", last: "/a/sub/x.png", count: 2 },
            prevStation: null,
            atLayerStart: false,
            atLayerEnd: true,
            layer: ["/a/1.png", "/a/2.png", "/a/3.png"],
        } as any;
        const h = buildPagerHintTexts(res, "/a/3.png", "/a");
        expect(h.next).toMatch(/sub/);
        expect(h.next).toMatch(/Shift|→|按/);
    });
    it("全树到底置灰：文案解释锚点下无更多", () => {
        const res = {
            position: 0,
            layerSize: 1,
            next: null,
            prev: null,
            nextStation: null,
            prevStation: null,
            atLayerStart: true,
            atLayerEnd: true,
            layer: ["/a/only.png"],
        } as any;
        const h = buildPagerHintTexts(res, "/a/only.png", "/a");
        expect(h.next).toMatch(/没有更多|锚点/);
        expect(h.refresh).toMatch(/Shift/);
    });
});
