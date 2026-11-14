# PRD: CommonText 详情标签移入属性区（Notion/Obsidian 式选择）

## Goal

CommonText 弹窗详情区底部「All tags」面板移除；标签成为属性网格第一行「Tags」，值区点击唤起共享 `PropertyTagEditor` 浮层（与 md 预览属性卡 / AISessions 属性面板同一交互：已选 chip 与输入框同行、输入即过滤、无匹配「创建 xxx」、Backspace 删尾 chip、Esc/点外关闭）。

## 背景（代码事实）

- 详情底部现为「All tags」面板（恒渲染）：header + 全库 chips（带计数），点 chip 在正文加/抹 `#tag` 字面（`handleDetailToggleTag`，commontext-compose-modal.tsx:1006）。
- tag 与 text 完全同源：`detailTags = extractSessionTagsFromNote(state.detailText).tags`，无结构化字段。
- 属性区已默认折叠成一行 icon 摘要 + chevron 展开网格（Created by / Computer / Created / Updated / Used 5 行）。
- 共享组件已存在：`frontend/app/element/property-editor/`（`PropertyTagEditor` + `PropertyValuePopover`，portal 到 body + 视口钳位 + 浮层定位），md 预览与 AISessions 已共用。

## 方案（已确认「ok go」）

1. **Tags 成为属性网格第一行**
   - 展开态第一行：`Tags | [chips] 或 Empty`；label 列与其他行同款 104px；值区整体可点（`data-commontext-tags-value`）。
   - 点击值区 → `PropertyValuePopover`（锚定值单元格）→ `PropertyTagEditor`：
     - `items` = `detailTags`（本条目 tags）
     - `options`/`optionCounts` = 全库 `tagSummaries`（原 All tags 面板的全量+计数入口收进这里）
     - `multiple = true`；onChange 走最小 diff 写回正文（新增末尾追加 ` #tag` / 移除 `removeSessionTagFromNote`），置 `detailDirty` 走既有 800ms 自动保存
   - 折叠态摘要行最前面加 `#` icon + 数量项（tooltip 列出 tag 名）：`data-commontext-properties-summary="tags"`。
2. **删除底部 All tags 面板**：整块移除；正文 `min-h-[200px]` 改 `flex-1` 吃掉腾出的空间（详情列本体仍 `overflow-y-auto`）。
3. **不动**：顶部 Editor 行内 chips（草稿 tags）、列表行 chips、tag 筛选、tag 存储模型（仍是正文 `#tag` 字面）。

## 已知限制（保持现状语义）

- tag 全部删光 → 正文纯空白 → 详情自动保存跳过空文本，删除不落盘（需显式 Delete）；与今天 All tags 面板同一行为，不在本期扩大。

## 验收标准（数字可判）

1. `npx vitest run frontend/app/commontext/` → 全绿（15 文件，新增 ≥3 例）：
   - 折叠摘要 keys 含 `tags` 且首项；展开行 = `["Tags", "Created by", "Computer", "Created", "Updated", "Used"]`
   - 点 Tags 值区 → `data-testid="property-tag-editor"` 浮层出现；输入新 tag + Enter → 正文含 `#tag`、chip 出现；Esc 关闭
   - 删 chip → 正文字面被抹掉
   - 详情底部不再渲染 All tags 面板
2. 红证：旧源（git show HEAD）跑新断言 → ≥1 failed
3. `All tags` 字符串不再出现于详情底部渲染（源码断言）
4. 真机台 `commontext-source-notion`：`property-grid-five-rows` → 六行 + tags 浮层断言（启动器故障则 skipped，dom 台兜底）

## 工时

小任务：单文件（commontext-compose-modal.tsx）+ 测试/验证台更新。
