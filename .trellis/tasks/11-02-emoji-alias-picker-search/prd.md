# Emoji Picker 右键标注含义 + 别名搜索

## Goal

在共享 `EmojiPicker` 上支持**鼠标右键**为某个 emoji 设置自定义含义 / 别名（类似给 emoji 打标签），
并让这些别名立即参与 **picker 内搜索**，优先级高于内置 shortcode / keywords / 拼音，
解决"知道意思但想不起是哪个 emoji、也搜不到"的问题。

本任务范围**只做 picker 内搜索**。AISessions 全局搜索 / 筛选按 emoji 含义命中会话，不在本任务内。

## Background（现状事实）

- 共享组件 `frontend/app/element/block-editor/components/emoji-picker.tsx`，被 **5 个渲染点**复用：
  4 处在 `element/markdown.tsx`（callout emoji `:5791`、文档 emoji 头 `:5813`、inline `:emoji` 补全 `:6012`、
  slash emoji `:6033`）+ 1 处 agent persona 选择器（`view/term/agent-emoji-picker.tsx:236`，AISessions 在用）。
  注：banner 的 `EmojiBadge` 与遗留 `element/emojipalette.tsx` 是**另一套组件**，不在本任务范围。
- 检索由 `frontend/app/element/markdown-transform/emoji.ts` 的 `searchEmoji(catalog, query, limit)` 承担，
  打分档位：shortcode 精确 `-1` > shortcode 前缀 `0` > keyword 前缀 `1` > 拼音前缀 `2` > 子串 `3`；
  `keywords` = emojibase en label 分词 + tags + zh label。catalog 由 emojibase-data 懒加载并全局缓存。
- 最近使用走 localStorage `snorkeling:recent-emoji`（MRU 24），已有 `safeStorage()` 容错范式。
- 目前 emoji 格子**没有任何右键行为**；它是 `<button>`，只有 hover / click。

## Requirements

- **R1 右键入口**：在 emoji 格子上右键（`contextmenu`）打开"含义 / 别名"编辑面板，且**不触发选中**、
  不关闭 picker。`preventDefault` + `stopPropagation`。
- **R2 编辑能力**：可为任意 emoji 设置 0..N 个别名（空格 / 逗号分隔，chip 化），
  外加一句可选说明（note）。支持保存、清除、取消。
- **R3 持久化**：别名跨重启保存，独立于 recents；跨窗口（多 Tab）同步。
- **R4 搜索整合**：别名命中排在所有内置匹配之前。精确别名 > 别名前缀 > 内置档位（顺序不变）。
- **R5 命中可解释**：搜索命中来自别名时，格子旁给出该别名提示，让用户看懂"为什么它被搜出来"。
- **R6 已标注可见**：有别名 / note 的 emoji 在网格里带小圆点标记，`title` 追加别名文本。
- **R7 键盘可达**：`ContextMenu` 键 / `Shift+F10` 可打开同一面板（无鼠标场景）。
- **R8 不改 catalog 对象**：别名不得写回 `EmojiCatalog`（全局共享缓存，写回会污染其它宿主）。
- **R9 不影响 inline 模式性能**：inline 模式的候选列表仍走 `buildEmojiPickerItems`，
  别名查询不得引入每次击键的 localStorage 读取或全表重算以外的额外开销。

## Constraints

- **C1** 只改前端；无后端 RPC、无新配置键。
- **C2** 别名表作用域为**全局一份个人 emoji 词典**（不按 session / provider 分 scope）。
- **C3** 别名键 = emoji char 原样字符串；带皮肤变体（如 `👍🏻`）在查找时回退到基座 char。
- **C4** 折叠态下空 query 的 picker 结构保持不变：**不加"我标注的"分组**（本期不做）。
- **C5** 编辑面板必须在 popover 内部就地渲染（单面板切换），不新开第二层 portal，
  以免与现有视口边界计算（`popoverLeft` / `availableHeight`）打架。
- **C6** 复用 `markdown.scss` 现有 picker 变量与类名前缀 `markdown-emoji-*`，不新建 scss 文件。

## Non-goals

- 不做 AISessions 搜索 / 筛选 / tag chips 的按含义命中。
- 不做别名随 filter preset / 属性模板导入导出。
- 不做 AI 建议别名。
- 不给 emoji 加"收藏 / 置顶"分组。
- 不改 `getAgentIcon` / persona 解析链，不碰 `session-row` 等使用方。

## Acceptance Criteria

- [x] **AC1** 右键任意 emoji 格子 → 出现编辑面板，显示该 emoji 与其内置 en/zh 名；
      期间 picker 未关闭、未选中任何 emoji。
- [x] **AC2** 输入别名 `已解决` 保存后，搜索框输入 `已解决` → 该 emoji 出现在结果首位，
      且格子旁显示 `已解决` 提示。
- [x] **AC3** 同一 emoji 输入 `done` 别名后，`done` 搜索结果中它排在任意内置匹配之前
      （用于验证"用户自定义 > 内置"）。
- [x] **AC4** 关闭并重开 picker / 重启应用后别名仍在；另一个窗口写入后本窗口搜索立即生效。
- [x] **AC5** 点"清除"后该 emoji 的别名与 note 全部消失，且不再被别名命中、圆点标记消失。
- [x] **AC6** 有别名 / note 的格子带 `.has-alias` 圆点，`title` 含别名。
- [x] **AC7** 聚焦到某格后按 `ContextMenu` / `Shift+F10` 可打开编辑面板。
- [x] **AC8** 编辑面板内按 `Esc` 关闭面板并回到列表，**不关闭整个 picker**；只有在列表态按 `Esc` 才走现有的关闭 picker 行为。
- [x] **AC9** 5 个渲染点（callout / doc / inline `:emoji` / slash emoji / agent persona）右键行为一致，无控制台报错。
- [x] **AC10** `emoji.test.ts` 原有断言全绿；新增别名相关单测覆盖 R4 分数顺序、R3 持久化、C3 皮肤回退、别名去重与长度上限。
- [x] **AC11** 别名含中英混排、大小写、含空格别名（如 `code review`）均可正确命中（大小写不敏感，空格分隔别名按短语整体匹配）。

## Open Questions（留待实现时确认，不阻塞规划）

- 别名上限取值：暂定每 emoji ≤ 12 个、单个别名 ≤ 24 字符、note ≤ 80 字符。
- 是否把"我标注过的"作为搜索未命中时的兜底提示，本期不做，记为后续候选。

## 验证记录（2026-11-03）

**自动化**

- `npx vitest run frontend/app/element frontend/app/agent-persona` → 48 files / 621 tests 全绿。
- `npx vitest run frontend/app/view` → 999 passed，另有 3 个文件 18 例失败，全部集中在
  `view/preview/preview-directory-utils.test.ts`（VCS 菜单 / 文件移动 mock），与本任务零关联（该文件无 emoji 引用）。

**真机（Electron + CDP，`npm run dev:cdp`）**

- 打开 agent persona picker（AISessions 行内 emoji 按钮）→ 右键 ✅ 格子 → 含义编辑面板就地展开，
  标题为「勾号按钮 / check mark button · :white_check_mark:」。
- 输入别名 `验收通过` + note `CI 绿灯` → Enter 生成 chip → 保存 →
  `localStorage["snorkeling:emoji-aliases"]` = `{"version":1,"byChar":{"✅️":{"aliases":["回归通过","ci-green","验收通过"],"note":"CI 绿灯","updatedAt":...}}}`。
- 搜索框输入 `验收通过` → 结果仅 1 条 ✅，带 `has-alias` 类，`title` = `check mark button · 回归通过 · ci-green · 验收通过 · CI 绿灯`，
  上方出现「别名命中 验收通过」条。
- `Esc` 在编辑面板内 → 只关面板，picker 仍打开。
- 截图留证：`.cache/tmp/emoji-alias-editor.png`、`.cache/tmp/emoji-alias-search.png`。

**未覆盖 / 后续**

- AC9 的 5 个渲染点中，真机实测了 agent persona picker；markdown 的 4 个入口（callout / 文档头 /
  inline `:emoji` / slash emoji）由 DOM 契约测试 + 同一组件路径覆盖，未逐一手点。
- banner `EmojiBadge` 与 `element/emojipalette.tsx` 是另一套组件，本任务未改动。
