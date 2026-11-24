// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（N-1124-folder-index-badges-2）— 红证先行：
// block meta 开关 + Agent 定向刷新 revision 的单测。
// 契约见 .trellis/tasks/11-24-folder-index-badges/prd.md：
//   - 开关：preview:idxbadges（缺省 = 关）
//   - 刷新：agent `wsh setmeta -b <blockid> preview:idxrefresh=<ms>` → revision 变化

import { describe, expect, it } from "vitest";
import {
    IDX_BADGES_META_KEY,
    IDX_REFRESH_META_KEY,
    isIdxBadgesEnabled,
    refreshRevisionFromMeta,
} from "@/app/view/preview/folder-index/folder-index-meta";

describe("block meta 开关（preview:idxbadges）", () => {
    it("缺省 = 关：无 meta / 空字符串 / off / false → false", () => {
        expect(isIdxBadgesEnabled({})).toBe(false);
        expect(isIdxBadgesEnabled({ [IDX_BADGES_META_KEY]: "" })).toBe(false);
        expect(isIdxBadgesEnabled({ [IDX_BADGES_META_KEY]: "off" })).toBe(false);
        expect(isIdxBadgesEnabled({ [IDX_BADGES_META_KEY]: false })).toBe(false);
    });

    it("on / true → 启用", () => {
        expect(isIdxBadgesEnabled({ [IDX_BADGES_META_KEY]: "on" })).toBe(true);
        expect(isIdxBadgesEnabled({ [IDX_BADGES_META_KEY]: true })).toBe(true);
    });

    it("meta 键名固定", () => {
        expect(IDX_BADGES_META_KEY).toBe("preview:idxbadges");
        expect(IDX_REFRESH_META_KEY).toBe("preview:idxrefresh");
    });
});

describe("Agent 定向刷新（preview:idxrefresh → revision）", () => {
    it("无刷新 meta → revision 0", () => {
        expect(refreshRevisionFromMeta({})).toBe(0);
        expect(refreshRevisionFromMeta({ [IDX_REFRESH_META_KEY]: "abc" })).toBe(0);
    });

    it("setmeta 写入 ms 时间戳 → revision 跟随", () => {
        expect(refreshRevisionFromMeta({ [IDX_REFRESH_META_KEY]: "1732500000000" })).toBe(1732500000000);
    });

    it("revision 变化即可判定需要重算（两次 setmeta 值不同 → 值不同）", () => {
        const a = refreshRevisionFromMeta({ [IDX_REFRESH_META_KEY]: "1732500000000" });
        const b = refreshRevisionFromMeta({ [IDX_REFRESH_META_KEY]: "1732500009999" });
        expect(a).not.toBe(b);
    });
});
