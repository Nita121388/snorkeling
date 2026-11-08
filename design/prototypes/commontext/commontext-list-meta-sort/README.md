> 同步状态：✅ 已落地（2026-11-05，`frontend/app/commontext/`，分支 `feat/commontext-list-meta-sort`）
> 镜像源：frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-model.ts
> 最后同步：2026-11-05

# CommonText 列表：创建时间 / 更新时间 / 排序 / 使用次数

浏览器直接打开 `index.html`，无构建、无依赖（字体与图标走 CDN，离线也能用，只是字体回退）。

## 这版原型改了什么

初版把组件画成了窄单栏弹窗，与真实组件不符。本版按 PROCESS.md「原型 = 真实代码的结构镜像」重做：

| 项 | 真实组件（2026-11-05） | 本原型 |
|---|---|---|
| 整体结构 | 双栏 Master-Detail（列表 + 详情） | 一致，宽 900×620（真实兜底尺寸） |
| 头部 | `Common Text` + 一行说明 | 一致，文案照抄 |
| Editor | 单行 36px，聚焦展开，`Compose here…` 占位 | 一致（聚焦展开到 76px） |
| 动作行 | filter / eraser / ＋ / copy / Send | 一致 |
| 左栏顶部 | Search + `untagged` chip + tag chips | 一致 |
| 列表行 | pin 列(16px) + 标题(12px) + 摘要(11px) + tag chips + hover 插入按钮 | 一致 |
| 右栏 | 标题 input + Pin 按钮 / textarea / All tags / Send·Copy·Insert + 删除 | 一致 |
| 文案语言 | 全英文 | 一致（初版误用中文） |

## 新增点只有两处

1. **列表右侧的「时间 / 次数」列**（`app.js` → `.mm-item-meta`）
   - 第一行 `fa-repeat` + 次数，第二行 `fa-clock` + 相对时间；从未使用显示 `0`（置灰）。
   - 不新增整行，行高仍按真实 `py-1.5`，避免左栏可视条数腰斩。
   - 创建时间 / 最近使用 / 完整时间戳放行 `title` 悬浮提示；详情页脚再加一组图标元信息。
   - 时间格式复刻仓库已有 `formatSessionRelativeTime` / `formatSessionDateCompact` 的输出口径，落地时直接复用，不另写一套。

2. **排序控件**（`app.js` → `.mm-sort-row`）
   - 放在左栏「搜索框」与「tag chips」之间独占一行。没有塞进 tag chips 那一行，是因为那行本身要横向溢出（`min-w-0` + scroll），加控件会互相抢宽度。
   - 遵守项目 UI 原则「能用图标表示的不用文字」：一组纯图标按钮，含义全走 `title` + `aria-label`，不占左栏宽度。

   | 图标 | 排序键 | 含义 |
   |---|---|---|
   | `fa-clock-rotate-left` | `lastused-desc` | Recently used（默认） |
   | `fa-pen` | `updated-desc` | Recently updated |
   | `fa-calendar-plus` | `created-desc` | Recently created |
   | `fa-fire` | `usage-desc` | Most used |
   | `fa-arrow-down-a-z` | `title-asc` | Title A → Z |
   | `fa-wand-magic-sparkles` | —（搜索态点亮） | 相关度排序 |
   | `fa-thumbtack` | —（常驻提示） | 置顶始终最前 |

   - 选择写入 `localStorage["mockup.commontext.sort"]`，刷新后保留。
   - 「Oldest first」（created 升序）已从控件里去掉：没有既准确又不歧义的图标。数据层 `sortByKey` 仍保留该分支，需要时可加一个方向切换按钮。

## UI 原则：图标优先

本原型的每个新增点都按「能图标不用文字」做：

| 位置 | 旧写法 | 现写法 |
|---|---|---|
| 列表行次数 | `used 24×` | `fa-repeat` + `24` |
| 列表行更新 | `updated 5h ago` | `fa-clock` + `5h ago` |
| 排序控件 | `Sort` 文字标签 + 下拉 | 5 个图标按钮 + tooltip |
| 搜索态 | `Relevance (search)` 文字 | `fa-wand-magic-sparkles` 点亮 |
| 置顶说明 | `Pinned items stay on top` | `fa-thumbtack` + tooltip |
| 详情页脚元信息 | `Created … · Updated …` | 4 组图标 + 时间/次数 |

完整时间戳、"used N time(s)" 这类不可图标化的语义全部下沉到 `title`，悬停可读。

## 落地前必须先定的三件事

原型已按推荐值实现，落地时照抄这套语义即可。

### B1 排序作用域：搜索态相关度优先

| 状态 | 列表顺序 | 控件 |
|---|---|---|
| 浏览态（搜索框空） | 置顶在前 → 用户选的排序 | 用户选的排序项 |
| 搜索态（搜索框有字） | 相关度降序；置顶只作并列次序 | 显示 `Relevance (search)` 并禁用 |

依据：`commontext-model.ts:280-350` 里 `searchCommonTextComposeItems` 先用 `sortCommonTextItems` 建 `baseOrder`，再按相关度重排，`baseOrder` 只做 tie-break。即搜索时置顶并不强制最前，用户排序也不生效。原型已复刻该行为——在搜索框输入 `report` 可见置顶项被挤掉、控件切 Relevance。

### B2 使用次数口径要一起修，否则数据不可信

当前只有 3 处会计数：详情 Insert（`commontext-compose-modal.tsx:559`）、editor 插入（`:539`）、新建条目（`:766`）。未计数：

- 行内 hover 插入按钮（`:1180` 附近，直接 `insertOrCopyCommonText`）；
- 详情 `Copy`（`:596`）。

另外新建条目会被记 1 次使用（`:760-766`），会虚高。建议：补两个写入点，并把「新建」从计数里去掉，否则列表里 `used N×` 长期偏低或失真。

### B3 排序函数注入方式：不要改公共函数

`sortCommonTextItems`（`commontext-model.ts:141`）同时负责：

- `saveCommonTextItems` 的写盘顺序（`:382`）；
- `getCommonTextItemsFromSettings` 的返回顺序；
- 弹窗 `filteredItems` 的 baseOrder，进而决定 `selectedIndex` 与键盘 ↑↓ 的落点（`commontext-compose-modal.tsx:232, 787, 826`）。

因此落地需新增 `sortCommonTextItemsBy(items, key)`，把 `sortKey` 作为 `CommonTextComposeSearchOptions` 的新字段传进 `searchCommonTextComposeItems`，原函数保持不动。

## 字段对齐

| `CommonTextItem` 字段 | 原型用途 |
|---|---|
| `createdat` | 悬浮提示 + 详情页脚；`Recently created` / `Oldest first` 排序 |
| `updatedat` | 行内 `updated 5h ago`、并列时的回落次序 |
| `lastusedat` | 默认排序键；为空时在 `Recently used` 落到最后 |
| `usagecount` | 行内 `used N×`；`Most used` 排序 |
| `pinned` | 始终最前（两种状态都保留该规则） |
| `shortcut` / `tags` / `title` / `text` | 与原组件一致，未改动 |

## 已知偏离与未覆盖

- **偏离**：排序控件独占一行，且为纯图标按钮；真实组件当前该位置没有这一行。
- **偏离**：详情页脚加了一组图标元信息（创建 / 更新 / 最近使用 / 次数）。真实组件该位置只有 Save 状态 + 删除按钮。
- **取舍**：`Oldest first` 无合适图标，未进控件；`Title A → Z` 用 `fa-arrow-down-a-z` 表达。
- **未覆盖**：编辑器联想（`editor` 自动匹配）、键盘 ↑↓ / Enter / Esc 导航、自动保存与 600ms blur 折叠、拖拽 resize 弹窗、i18n。
- **假数据**：6 条，覆盖「置顶 / 从未使用 / 无标签 / 多标签 / 刚更新」五种形态，不是真实用户数据。

## 关联

- 真实组件：`frontend/app/commontext/commontext-compose-modal.tsx`、`frontend/app/commontext/commontext-model.ts`
- 时间格式统一配置在规划中：`.trellis/tasks/11-02-datetime-format-config/`
- 前一版（窄单栏，已废弃）在本目录 git 历史中，勿再引用。
