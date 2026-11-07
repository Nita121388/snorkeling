# R3 前端：创建者/设备筛选 + Notion 式详情 + emoji picker

> 父任务：11-07-commontext-cloud-sync；依赖：11-07-commontext-sync-metadata（类型先落地）
> 原型依据：`design/prototypes/commontext-cloud-sync-notion/index.html`（列表行 / 筛选 chips / 右栏页面 / emoji picker 全部可点验）

## Goal

`commontext-compose-modal.tsx` 按原型改造：来源徽标、creator/device 筛选、Notion 式右栏、emoji picker。

## Requirements

### R3.1 类型升级（frontend/app/commontext/commontext-model.ts）

`CommonTextItem` 增加 `createdBy` / `origin` / `rev` / `deletedat`（与 Go 对应），normalize 兜底与 R1.4 相同：缺省 → human/local/rev 0。

### R3.2 列表行来源徽标

- 行内显示创建者徽标：agent → `<i class="fa-robot"></i>agent名`（蓝底）；human → `<i class="fa-user"></i>人名`（橙底），样式对齐原型 `.agentbadge`
- grid 列模板 `14px 18px minmax(0,1fr) 54px`（emoji + 徽标 + 标题区 + 时间）——原型验证过 flex 会压行高

### R3.3 筛选 chips

- creator 三档：All(n) / Humans(n) / Agents(n)
- 电脑下拉：Any computer / 各设备（名称 + 计数）；数据源 = 现有条目的 `origin` 去重
- 两个筛选叠加生效；空结果文案按起因分流（查询无结果 vs 筛选无结果）

### R3.4 Notion 式右栏

- page icon：48px emoji 槽，点击开 emoji picker
- 大标题（20px/600，inline 编辑）
- 属性网格（label 左 104px + 值）：Created by（徽标）/ Computer（名 + platform + deviceId）/ Created / Updated / Used（相对时间 + 次数）
- Preview / Edit 切换沿用现有 text editor

### R3.5 emoji picker

- 复用 `frontend/app/element/block-editor/components/emoji-picker.tsx`（搜索 / 分类 / recents / alias）
- 新增 `commontext-emoji.ts`：条目 emoji 存取 + recents 共享 markdown `:` 选择器同一份
- grid `repeat(8, minmax(0,1fr))` + `grid-auto-rows:34px`（原型踩坑结论）

## Acceptance（可机器判定）

- [ ] 现有 commontext 相关测试全绿 + 新增：筛选叠加、空结果分流、normalize 兜底
- [ ] 验证台断言：8 行行高全等；creator/device 筛选后行数与数据一致；属性网格 `Computer` 显示 `名 platform · deviceId`；emoji 选择后 icon 槽与列表行同步
- [ ] 无横向滚动；右栏无溢出（原型踩坑：`.pval` 嵌套 / `aspect-ratio:1` 已在原型层修掉，落地时防回归）
- [ ] 真机验证（`scripts/verify/`，area 登记）+ `docs/project/verify-ledger.md` 一行结论
