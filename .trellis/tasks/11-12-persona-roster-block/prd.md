# A4 人设名册 Block（persona://）

## Goal

点击 🎭 打开的总览：谁在当班、每人记得多少、发生过什么。

## Requirements

- 新 widget 类型 `persona://`（preview/webview 模式注册）
- 列表：emoji + 名字 + 状态点（agentstatus chip 跨面一致）+ 最近登场；「仅登场中」筛选；💤 休眠折叠
- 顶部「⚡ 待批准」区（A2.5 proposals）：批准/驳回 + 当日配额提示
- 详情：CHARTER、据点（[打开]）、记忆三项容量（档案/归档/产物）+ L1 注入 token 估算、登场史（近三日 + 全部）、createdBy 徽标
- 动作：[叫TA登场]（等同 A3）、[⋯ 同步/编辑档案]

## Acceptance Criteria

- [ ] `npx vitest run frontend/app/view/persona` → passed
- [ ] 真机 area `persona-roster`：列表数 = 磁盘人设目录数
- [ ] 容量三项之和 = `du` 实测（±5%）
- [ ] 待批准→批准端到端：目录落地 + 名册 L0 新增一行

## 依赖

A1；A2.5（待批准区）；A1.5（登场史）。
