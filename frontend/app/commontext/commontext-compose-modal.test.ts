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

    it("shows usage count plus a freshness square and a compact relative label at the right of each row", () => {
        expect(source).toContain('data-commontext-meta=""');
        expect(source).toContain("data-commontext-usage={item.usagecount ?? 0}");
        // 图形 + 数字双出口：方块管扫视，紧跟的 `3d` 管精确读数（不再需要悬停）。
        expect(source).toContain('data-commontext-updated=""');
        expect(source).toContain("<CommonTextFreshnessSquare");
        expect(source).toContain("tier={commonTextFreshnessTier(item)}");
        expect(source).toContain('data-commontext-updated-rel=""');
        expect(source).toContain("formatCommonTextFreshnessCompact(item.updatedat)");
        // 元信息列不新增行高：与 hover 插入按钮共用同一固定宽槽
        expect(source).toContain("w-[58px]");
        expect(source).toContain("group-hover:opacity-0");
    });

    it("renders the usage count as a bare number in the row slot", () => {
        // `fa-repeat` 读起来是「重来/循环」，与「这条被用过多少次」不是一回事；
        // 右槽已经是纯数字列，计数也跟着留纯数字（tooltip 仍给完整句子）。
        const start = source.indexOf("data-commontext-usage={item.usagecount ?? 0}");
        const end = source.indexOf('data-commontext-updated=""');
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        expect(source.slice(start, end)).not.toContain("fa-repeat");
    });

    it("drops the clock glyph from the row slot", () => {
        // 列表右槽原本是「时钟图标 + 相对时间文字」；图形化后不应再出现那个图标。
        // 相对时间现在以紧凑数字（`3d`）常显在方块旁，完整句只走 aria-label / tooltip。
        expect(source).not.toContain('<i className="fa fa-regular fa-clock text-[9px]" />');
        expect(source.match(/<CommonTextFreshnessSquare/g)?.length).toBe(1);
    });

    it("shows created / updated / last-used / usage metadata in the detail footer", () => {
        expect(source).toContain('data-commontext-detail-meta=""');
        expect(source).toContain("data-commontext-detail-usage={detailItem.usagecount ?? 0}");
        expect(source).toContain("Created ${compactCommonTextTime(detailItem.createdat, true)}");
        expect(source).toContain("Last used ${compactCommonTextTime(detailItem.lastusedat, true)}");
    });

    it("keeps the detail textarea inside its flex slot instead of overlapping the tags panel", () => {
        // 根因：`h-full` 的 textarea 自带 `min-h-[200px]` 时，窗口变矮后 flex 槽不足 200px，
        // textarea 会硬撞出槽位盖住 All tags / 按钮行（textarea 内容不被自身裁掉，
        // 2026-11-09 真机：编辑区下半部分盖住上半部分）。修法：min-h 挂在**包裹层**（flex 项）
        // 上参与布局，详情列 `overflow-y-auto` 接管溢出。
        expect(source).toContain('flex-1 min-h-[200px]">');
        expect(source).not.toContain("h-full min-h-[200px]");
        expect(source).toContain("flex flex-col gap-2.5 overflow-y-auto");
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

    it("offers an explicit editor collapse toggle that overrides focus auto-expand", () => {
        // 多行草稿在失焦折叠判定里永远保持展开，这个按钮是唯一把上半部让给
        // 下半部分的通道；手动收起后聚焦不再自动弹开，再点恢复自动行为。
        expect(source).toContain('data-commontext-editor-toggle=""');
        expect(source).toContain("const [editorManuallyCollapsed, setEditorManuallyCollapsed] = useState(false);");
        expect(source).toContain("if (!editorManuallyCollapsed) setEditorExpanded(true);");
        // 手动收起态不受失焦折叠判定影响（多行内容否则会被 blur 计时重新撞开）
        expect(source).toContain("if (editorManuallyCollapsed) return;");
        expect(source).toContain("const toggleEditorCollapse = () => {");
        // 键盘通道：Alt+↑ 切换收起/展开
        expect(source).toContain('event.altKey && event.key === "ArrowUp"');
        // 每次打开弹窗重置手动收起态，不继承上次的临时选择
        expect(source).toContain("setEditorManuallyCollapsed(false);");
        // 粘贴图片不再越过手动收起态自动展开
        expect(source).toContain("if (!editorManuallyCollapsed) setEditorExpanded(true);");
        // 拖高（resize-y inline height）后收起：收起态显式给 height 盖掉浏览器写入的 inline 高度，
        // 否则 inline 优先级压过 h-9，收不回一行
        expect(source).toContain("const EDITOR_COLLAPSED_HEIGHT_PX = 36;");
        expect(source).toContain("{ height: `${EDITOR_COLLAPSED_HEIGHT_PX}px` }");
    });

    it("collapses the detail property grid to a one-line icon summary by default", () => {
        // 默认折叠成 icon+短值单行（完整语义走 tooltip），chevron 展开 5 行网格；
        // 锚点保留 data-commontext-property（展开态）供验证台断言。
        expect(source).toContain('data-commontext-properties={propertiesExpanded ? "expanded" : "collapsed"}');
        expect(source).toContain('data-commontext-properties-toggle=""');
        expect(source).toContain("aria-expanded={propertiesExpanded}");
        expect(source).toContain("data-commontext-properties-summary={s.key}");
        // 展开网格按需渲染（propertiesExpanded && ...），默认只有摘要行
        expect(source).toContain("{propertiesExpanded &&");
        // 每次打开弹窗重置折叠态：默认折叠
        expect(source).toContain("setPropertiesExpanded(false);");
    });

    it("auto-saves the editor draft to localStorage without clicking +", () => {
        // 文本自动保存：800ms 防抖落 localStorage 持久草稿，关弹窗/重启不丢；
        // 「+」不再是保住文本的必要动作，只保留「草稿升格为条目」的语义。
        expect(source).toContain(
            'import { clearEditorDraft, loadEditorDraft, saveEditorDraft } from "./commontext-editor-draft";'
        );
        expect(source).toContain("const EDITOR_DRAFT_DEBOUNCE_MS = 800;");
        // 还原：无 query 打开走 localStorage（同进程与跨重启统一路径，内存 composeDraft 已删）
        expect(source).toContain("const draft = loadEditorDraft();");
        expect(source).toContain("editor: draft.text,");
        // 关闭前强制 flush；基线相同（本次只是还原/查阅）跳过，避免误清持久草稿
        expect(source).toContain("flushEditorDraft();");
        expect(source).toContain("if (state.editor === lastDraftTextRef.current) return;");
        // 橡皮与「+」立即清持久键，不等防抖
        expect(source).toContain(
            "// 显式清空 = 用户主动丢弃草稿：立即清持久键，不等 800ms 防抖（否则关得快一点草稿又回来了）。"
        );
        expect(source).toContain("// 已升格为列表条目：editor 里的草稿使命结束，立即清持久键。");
        // 可感知：footer 指示「Draft saved」
        expect(source).toContain("data-commontext-draft-status={draftStatus}");
        expect(source).toContain("Draft saved");
    });

    it("moves tags into the properties grid and drops the bottom All tags panel", () => {
        // 标签成为属性网格第一行，值区点击唤起共享 Wolai 式编辑器（md 预览/AISessions 同源）。
        expect(source).toContain(
            'import { PropertyTagEditor, PropertyValuePopover } from "@/app/element/property-editor";'
        );
        expect(source).toContain('data-commontext-property="Tags"');
        expect(source).toContain('data-commontext-tags-value=""');
        expect(source).toContain("data-commontext-properties-summary={s.key}");
        // 折叠摘要首项是 tags 数量
        expect(source).toContain('key: "tags",');
        // 底部 All tags 面板整块移除（header 副标与面板标题都不再渲染）
        expect(source).not.toContain("click to toggle in Text");
        expect(source).not.toContain(">All tags<");
        expect(source).not.toContain("handleDetailToggleTag");
        // 折叠摘要展示标签（不能省略），且用与展开态同一个 chip 组件——两态样式统一
        expect(source).toContain('text: detailTags.length === 0 ? "0" : "",');
        expect(source).toContain('s.key === "tags" && detailTags.length > 0 ? (');
        expect(source).toContain('className="min-w-0 flex-wrap"');
        // 写回仍走正文 #tag 最小 diff（不引入第二套 tag 存储），走既有自动保存
        expect(source).toContain("const applyDetailTags = (nextTags: string[]) => {");
        expect(source).toContain("removeSessionTagFromNote(nextText, tag)");
    });
});
