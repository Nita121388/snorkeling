> **Confirmed: 2026-11-14 @nita**

# PRD: CommonText 内容与标签分离（tags 结构化权威 + 读路径惰性迁移）

## Goal

CommonText 条目里 **tags 是结构化权威字段（`item.tags`）**，正文 `text` 只存内容——正文里不再残留 `#tag` 字面。历史数据（正文里带 `#tag` 的存量）通过读路径惰性迁移自动兼容，无需迁移脚本。

## 背景（代码事实）

- 当前「正文是唯一权威」：tag 以 `#tag` 字面写在 `text`，`item.tags` 只是每次保存时 `extractSessionTagsFromNote(text)` 的派生快照；所有 UI（Tags 行/chips/折叠摘要）从正文抽取 → 正文里的 `#` 永远在。
- `item.tags: string[]` 字段本就存在于 schema（无 schema 变更）。
- 读面唯一入口 `normalizeCommonTextItem`（commontext-model.ts:141）；写面入口 `upsertCommonTextItem`（全量写 settings）。
- 已有工具函数（`view/aisessions/session-tags.ts` 导出）：`extractSessionTagsFromNote`、`stripSessionTagHashes`（`#tag`→删字面、合并空格、trim）、`removeSessionTagFromNote`。

## 方案

### 1. 读路径惰性迁移（commontext-model.ts `normalizeCommonTextItem`）

```
mergedTags = normalizeCommonTextTags(raw.tags) ∪ extractSessionTagsFromNote(text).tags
cleanText  = stripSessionTagHashes(text)
```

- `cleanText.trim() !== ""` 时用 cleanText（否则保留原 text，避免「只有标签的条目」被剥成空）；
- tags 用 mergedTags；
- 所有消费面（弹窗、插入、发送、搜索、同步）读到的即分离后数据；任何一次 upsert 全量写 settings 即持久化迁移。

### 2. 写路径收口（commontext-compose-modal.tsx）

| 面 | 改为 |
|---|---|
| `detailTags` memo | 读 `detailItem.tags`（不再从 `detailText` 抽） |
| `applyDetailTags`（Tags 浮层） | 先 cancel+flush 正文草稿 → 立即 `upsertCommonTextItem({title: 草稿 title, text: 草稿 text（空则回退 item.text）, tags: nextTags, pinned, emoji}, id)`——**不再改正文** |
| `flushDetailSave`（正文自动保存） | `tags: detailItem.tags`（正文改动不动 tags） |
| `handleDetailTogglePin` | `tags: detailItem.tags` |
| 「+」`handleSaveDialog` | 拆分：`tags = extract(draft)`、`text = strip(draft)`（strip 后为空则回退原文） |
| 详情正文 placeholder | 去掉 "type #tag inline to tag this item" |

### 3. 不动

- 顶部 Editor（草稿箱兼过滤器）保持自由文本；草稿 chips 仍从草稿抽取；落条目那一刻拆分。
- 顶部 Editor 的 `removeEditorTag` 语义不变（改草稿文本）。
- 列表行 chips / 折叠摘要 / Tags 浮层候选全部走 `item.tags`（迁移后含合并结果）。

## 风险与边界（如实记录）

1. `#3 bolts` 这类 `#数字` 符合 tag 词法（今天已被抽成 tag "3" 显示）；迁移会剥离，极罕见，接受。
2. `#!/bin/bash`、`# comment`（`#` 后有空格/非词字符）不匹配，安全；紧凑 `#comment` 视作 tag（与今天抽取行为一致）。
3. 单向迁移：落盘后旧版本代码从正文抽不到 tags（tags 字段仍在）——回滚会看到「无标签但正文干净」。
4. 在途云同步任务（11-07-commontext-sync-*）：字段形状不变；两侧读路径同一迁移逻辑；跨机若对端是老版本，text 语义差异可能引发一次冲突——在该任务目录留 note。

## 验收标准（数字可判）

1. model 单测：
   - `{text:"run deploy #urgent #ops", tags:[]}` → `text === "run deploy"`、`tags` 含 urgent/ops
   - `{text:"keep #legacy", tags:["#legacy"]}` → text 无 `#`、tags=`["legacy"]`
   - `#!/bin/bash` 与 `# comment` 原样保留；只有标签的条目（`"#a"`）保留原 text 不丢条目
   - 已迁移条目二次 normalize 幂等
2. dom 台：
   - Tags 浮层加 `x` → 正文 textarea **不含 `#x`**、`item.tags` 含 x
   - 改正文 → Tags 行不变
   - 「+」提交含 `#x` 草稿 → 条目 text 干净、tags 含 x
3. 红证：旧源跑新断言 ≥1 failed
4. `npx vitest run frontend/app/commontext/` 全绿；Prettier/tsc 干净
5. 真机台 `tags-create-appends-to-text` 断言反向：text **不含** #verifytag 而 tags 含（启动器故障则 skipped）

## 工时

中任务：model 迁移 + 5 处写路径 + 测试/验证台。
