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

    it("shows usage count plus a freshness square at the right of each row", () => {
        expect(source).toContain('data-commontext-meta=""');
        expect(source).toContain("data-commontext-usage={item.usagecount ?? 0}");
        // 更新时间不再写文字：图形化后扫视不用逐个读「4h ago」，也不会因相对时间过期而说谎。
        expect(source).toContain('data-commontext-updated=""');
        expect(source).toContain("<CommonTextFreshnessSquare");
        expect(source).toContain("tier={commonTextFreshnessTier(item)}");
        // 元信息列不新增行高：与 hover 插入按钮共用同一固定宽槽
        expect(source).toContain("w-[58px]");
        expect(source).toContain("group-hover:opacity-0");
    });

    it("drops the clock glyph from the row slot", () => {
        // 列表右槽原本是「时钟图标 + 相对时间文字」；图形化后不应再出现那个图标。
        // 相对时间只保留在 aria-label / tooltip 里（对读屏仍然有用，但不是可见文字）。
        expect(source).not.toContain('<i className="fa fa-regular fa-clock text-[9px]" />');
        expect(source.match(/<CommonTextFreshnessSquare/g)?.length).toBe(1);
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

    it("marks items the cloud has not received yet, in the row and in the detail footer", () => {
        // 列表行：只在 pending 时出现一个点，已同步不占布局
        expect(source).toContain("data-commontext-sync-state={item.syncstate}");
        expect(source).toContain("function CommonTextSyncDot(");
        expect(source).toContain("<CommonTextSyncDot item={item} />");
        // 详情页脚：与列表同一份派生状态（后端 syncstate 投影），文案只有一处
        expect(source).toContain("data-commontext-detail-sync={detailItem.syncstate");
        expect(source).toContain("function describeCommonTextSyncState(");
        expect(source).toContain('"Pending upload — the next sync will send it"');
        // 墓碑不上列表：可见条目必须先过滤
        expect(source).toContain("getLiveCommonTextItems(getCommonTextItemsFromSettings(settings))");
    });
});
