import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./commontext-compose-modal.tsx", import.meta.url), "utf8");

describe("CommonTextComposeModal hook order", () => {
    it("keeps the closed-state return after the detail auto-save effect", () => {
        const closedReturnIndex = source.lastIndexOf("if (!state.open) return null;");
        const detailSaveEffectIndex = source.indexOf(
            "}, [state.detailDirty, state.detailTitle, state.detailText, state.detailId]);"
        );

        expect(closedReturnIndex).toBeGreaterThan(detailSaveEffectIndex);
    });

    it("renders a direction-neutral focused-target insert action in each suggestion row", () => {
        expect(source).toContain('className="item-insert-btn');
        expect(source).toContain("fa fa-regular fa-paste");
        expect(source).toContain("event.stopPropagation()");
        expect(source).toContain("insertOrCopyCommonText(item.text)");
        expect(source).toContain('"Copied (no target)"');
    });

    it("offers an action-row button to dismiss editor-based filtering", () => {
        expect(source).toContain("editorFilterDismissed");
        expect(source).toContain("fa fa-solid fa-filter");
        expect(source).toContain("Stop filtering by editor content");
        expect(source).toContain("editorFilterDismissed: !state.editorFilterDismissed");
    });

    it("offers an untagged-only filter chip in the tag row", () => {
        expect(source).toContain("toggleUntagged");
        expect(source).toContain("untaggedOnly");
        expect(source).toContain(">untagged</span>");
        expect(source).toContain('title="Show items with no tags"');
        // 与具体 tag 选择互斥：选 tag 时退出无标签筛选
        expect(source).toContain("untaggedOnly: false, selectedIndex: 0");
    });

    it("renders the icon-only sort control under the search box", () => {
        // 5 个排序键都是纯图标按钮：含义只走 title / aria-label，不占左栏宽度。
        expect(source).toContain('aria-label="Sort common text list"');
        expect(source).toContain("data-commontext-sort={option.key}");
        expect(source).toContain("aria-label={option.label}");
        // 图标名集中在 CommonTextSortOptions 表里，渲染时统一拼 `fa fa-solid ${icon}`
        expect(source).toContain('icon: "fa-clock-rotate-left"');
        expect(source).toContain('icon: "fa-fire"');
        expect(source).toContain('icon: "fa-arrow-down-a-z"');
        expect(source).toContain("fa fa-solid ${option.icon}");
        // 置顶说明常驻，相关度图标只在搜索态点亮
        expect(source).toContain('title="Pinned items stay on top"');
        expect(source).toContain("data-commontext-sort-relevance");
        // 用 aria-disabled 而非 disabled：disabled 按钮的 tooltip 在 Chromium 里不显示
        expect(source).toContain("aria-disabled={relevanceActive}");
        expect(source).toContain("if (relevanceActive) return;");
    });

    it("feeds the chosen sort key into the search pipeline", () => {
        expect(source).toContain("sortKey: state.sortKey");
        expect(source).toContain("loadCommonTextSortKey()");
        expect(source).toContain("saveCommonTextSortKey(sortKey)");
    });

    it("shows usage count plus relative update time at the right of each row", () => {
        expect(source).toContain('data-commontext-meta=""');
        expect(source).toContain("data-commontext-usage={item.usagecount ?? 0}");
        expect(source).toContain("formatSessionRelativeTime(item.updatedat)");
        // 元信息列不新增行高：与 hover 插入按钮共用同一固定宽槽
        expect(source).toContain("w-[58px]");
        expect(source).toContain("group-hover:opacity-0");
    });

    it("shows created / updated / last-used / usage metadata in the detail footer", () => {
        expect(source).toContain('data-commontext-detail-meta=""');
        expect(source).toContain("data-commontext-detail-usage={detailItem.usagecount ?? 0}");
        expect(source).toContain("Created ${compactCommonTextTime(detailItem.createdat, true)}");
        expect(source).toContain("Last used ${compactCommonTextTime(detailItem.lastusedat, true)}");
    });

    it("counts a use for row-hover insert and detail copy, but not for brand-new items", () => {
        // 行内 hover 插入/无目标回退复制
        expect(source).toContain("await recordCommonTextUse(item.id);");
        // 详情 Copy
        expect(source).toContain("fireAndForget(() => recordCommonTextUse(item.id));");
        // 新建条目：只刷新 lastusedat，不虚记一次使用
        expect(source).toContain("recordCommonTextUse(item.id, { countUsage: false })");
    });
});
