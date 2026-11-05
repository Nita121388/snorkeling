# 设计：CommonText 排序与元信息

## 边界

只动 `frontend/app/commontext/`：

| 文件 | 动作 |
|---|---|
| `commontext-model.ts` | 新增 `CommonTextSortKey`、`sortCommonTextItemsBy`、`sortKey` 搜索选项；`recordCommonTextUse` 增加 `countUsage` 选项 |
| `commontext-sort-preference.ts` | 新增：localStorage 读写排序偏好（纯 IO，异常静默） |
| `commontext-compose-modal.tsx` | 排序控件、列表元信息列、详情页脚元信息、两处计数写入点 |
| `commontext-model.test.ts` / `commontext-compose-modal.test.ts` | 补断言 |

## 数据层契约

```ts
export type CommonTextSortKey =
    | "lastused-desc"   // 默认
    | "updated-desc"
    | "created-desc"
    | "created-asc"
    | "usage-desc"
    | "title-asc";

export function sortCommonTextItemsBy(items: CommonTextItem[], key?: CommonTextSortKey): CommonTextItem[];
```

排序不变量：

1. `pinned` 恒在最前（两种状态都保留）。
2. 主键由 `key` 决定；并列时回落 `updatedat desc`，再 `title.localeCompare`。
3. `sortCommonTextItems(items)` 等价于 `sortCommonTextItemsBy(items, "lastused-desc")`，
   保持写盘顺序（`saveCommonTextItems`）、`getCommonTextItemsFromSettings` 返回顺序、
   弹窗 `selectedIndex` / ↑↓ 落点完全不变。

`searchCommonTextComposeItems` 新增 `sortKey`：只影响 `baseItems` 的构造，相关度重排仍
以 `baseOrder` 作末位 tie-break（搜索态「置顶只作并列次序」由既有实现自然满足）。

## 使用次数口径

| 路径 | 改造前 | 改造后 |
|---|---|---|
| 详情 Insert | 计数 | 计数 |
| 详情 Send | 计数 | 计数 |
| 编辑器插入（详情 Insert 的 editor 分支） | 计数 | 计数 |
| 列表行 hover 插入 / 无目标回退复制 | **不计数** | 计数 |
| 详情 Copy | **不计数** | 计数 |
| 新建条目 | 虚记 1 次 | **不计数**，只刷 `lastusedat` |

`recordCommonTextUse(id, { countUsage: false })`：新建时刷新 `lastusedat`（让新条目在默认
「最近使用」排序里靠前，符合用户建完就看到它的直觉），但 `usagecount` 保持 0，列表显示灰色 `0`。

## UI 结构

- 排序控件插在「搜索 InputGroup」与「untagged + tag chips 行」之间，独占一行：
  `role="group"` + 每个按钮 `title` / `aria-label`，选中态 `bg-actionsoft text-accent`。
- 相关度图标（`fa-wand-magic-sparkles`）只在 `manualQuery` 非空或编辑器过滤生效时点亮，
  此时 5 个排序按钮 `disabled`（否则点了没效果，属于假控件）。
- 行右侧右侧槽固定宽 `w-[58px]`：默认渲染元信息列，`group-hover` 时元信息淡出、插入按钮
  absolute 落同一位置 —— 不产生 hover 布局抖动，也不挤压标题列。
- 详情页脚在 Insert 之后插入元信息组，`flex-wrap` 下窄宽度自然换行，不新增行高约束。
- 时间格式直接复用 `frontend/app/view/aisessions/utils.ts` 的
  `formatSessionRelativeTime` / `formatSessionDateCompact`，不另写一套。

## 兼容与回滚

- 新增字段全部可选，`usagecount` / `lastusedat` 已有 normalize 兜底，旧设置文件照常读。
- localStorage 键 `commontext:sortKey` 读写失败静默回落默认值。
- 回滚 = revert 单个 commit；无数据迁移、无后端改动。
