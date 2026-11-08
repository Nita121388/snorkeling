# Design — 前端筛选 + Notion 详情 + emoji

> 视觉与交互全部以定稿原型为准：`design/prototypes/commontext-cloud-sync-notion/index.html`。
> 原型层的踩坑结论是硬约束，落地时防回归（详见原型 README「与真实组件的结构对齐」）。

## 组件边界

```
commontext-compose-modal.tsx    ← 保留双栏骨架，右栏重构 + 筛选接线
commontext-model.ts             ← 类型 + normalize（metadata 子任务产出）
commontext-emoji.ts             ← 新：条目 emoji 存取 + recents（复用 markdown picker 的 recents store）
```

## 列表行

grid `14px 18px minmax(0,1fr) 54px`（emoji / 徽标 / 标题区 / 时间）。原型验证：flex + 自动高度会把 `.body` 压成单行。徽标渲染复用 `<AgentIcon>` 式两态（agent 蓝 / human 橙），文案 = createdBy.name（agent 显示 agent 名，human 显示人名；空名显示 kind）。

## 筛选

- chips 状态进 `state.creator` / `state.device`，与现有 query/tag/sort 正交叠加
- 计数从当前 tag/query 过滤后的集合再统计（与原型 `cntAll/cntHuman/cntAgent` 一致）
- 空结果分流：query 命中 0 → "No matches for …"；筛选导致 0 → "No items from this filter. Clear filters?"（带清除按钮）

## 右栏 Notion 页面

```
.detail
├─ page-icon (48px emoji 槽, hover 显示 change)
├─ title (20px/600, contentEditable inline 编辑, Enter 提交)
├─ property grid (grid-template-columns:104px 1fr; 行间 border-soft)
│   Created by / Computer / Created / Updated / Used
└─ Preview | Edit 切换（沿用现有 text editor，不重写编辑器）
```

- `Computer` 值格式：`{deviceName} {platform} · {deviceId}`，deviceName 来自 origin 快照（历史条目不随后改名）
- 属性次要文本用独立类（原型 `.psub` 教训：嵌套 `.pval` 会继承 grid 项样式压乱行高）

## emoji picker

- 直接 import `block-editor/components/emoji-picker`，不复制组件
- recents 共享：同 markdown `:` 选择器的存储键
- 选择后写 `item.emoji` + 列表行第一列同步
- grid 口径 `repeat(8,minmax(0,1fr)) + grid-auto-rows:34px`（原型踩坑：aspect-ratio:1 会撑爆弹层）

## 兼容

- 旧条目无 createdBy/origin → normalize 兜底 human/local，徽标显示 `human`（无名）、Computer 显示 `This machine`
- 不迁移写盘：只在读出时兜底，用户编辑该条目时才落新字段

## 风险

- contentEditable 标题与现有快捷键（Cmd+S 保存等）冲突——Enter 提交、Esc 还原，不走 Cmd+S
- 筛选 chips 与 tag row 同行溢出——chips 换行 flex-wrap，不压缩 tag row
