# PRD: CommonText 弹窗 — Editor 快捷收起 + 属性列表默认折叠

## Goal

CommonText 弹窗上半部 Editor 加显式收起通道（多行草稿也能一键收掉，下半部分列表/详情得以放大；手动收起态优先于聚焦自动展开）；详情区属性网格默认折叠成 icon+数字单行摘要，chevron 点击展开完整网格。折叠/展开状态不持久化。

## 背景

`CommonTextComposeModal`（`frontend/app/commontext/commontext-compose-modal.tsx`）上半部是 Composer（textarea），下半部是「左列表 + 右详情」Master-Detail。

两个交互痛点：

1. **上部 Editor 只能放大，缩不回去。** 聚焦即展开（`min-h-[120px]`），失焦时只有「文本不含换行」才收回单行（`onBlur` 的 `valueHasNewline`）。草稿一旦含换行或粘过图片，editor 永远保持展开，没有任何手动收起手段，下半部分（列表/详情）被持续挤压，无法快速把下半部分放大。
2. **详情区属性网格占高且重复。** `data-commontext-properties` 固定渲染 5 行（Created by / Computer / Created / Updated / Used），约 120px 高；而详情 footer 已有 Created / Updated / Last used / Used 的 icon+数字元信息，信息大量重复。

## 目标

### 需求 A：Editor 显式收起通道

- Editor 提供一个显式收起入口（按钮），点击立即折叠回单行，**内容不丢**。
- 手动收起态优先于「聚焦自动展开」：收起后再次聚焦不应自动弹开（否则一点又展开，收起形同虚设）；显式再展开后恢复原有的聚焦自动展开行为。
- 快捷键（可选项，若实现成本低则做）：Editor 内 `Alt+↑` 切换收起/展开。

### 需求 B：属性列表默认折叠

- 详情区属性区默认折叠为**一行紧凑摘要**：`👤 创建者 · 💻 计算机 · ✏️ 更新时间 · 🔁 次数`，用 icon + 数字/短文本表达，完整语义走 `title` / `aria-label` tooltip。
- 折叠态行尾提供 chevron，点击展开完整的 5 行属性网格（保留现有网格结构与 `data-commontext-property` 等验证锚点）。
- 折叠/展开状态不持久化，每次打开弹窗默认折叠（本期最简）。

## 非目标

- 不改动列表排序、筛选、tag、同步、自动保存等既有逻辑。
- 不改变弹窗自身的 resize 手柄、尺寸持久化。
- 不做属性折叠状态的 localStorage 持久化。

## 验收标准

1. 草稿含多行文本时，点击收起按钮 editor 折回单行高度，正文仍在；再次点击展开恢复多行高度。
2. 手动收起后点击 editor 内部不再自动展开；点击展开按钮后恢复聚焦自动展开。
3. 详情区默认状态只显示一行属性摘要（icon + 值），不显示 5 行网格。
4. 点击属性摘要行尾 chevron 展开完整 5 行网格；再点收起。
5. 摘要行与展开网格均保留可机器定位的 `data-commontext-*` 锚点，验证台可断言折叠/展开两态。
6. 现有 commontext 验证台/单测不回归。

## 工时

小任务：单文件改动（`commontext-compose-modal.tsx`），必要时补少量验证锚点。
