---
id: N-1119-prop-ui-add-option
title: "UI 属性新值自动追加候选（select/status/multi_select，scope 门禁）"
type: fix-small
priority: P1
severity: S3
status: open
origin: self
source: "nita 2026-11-19 实测：状态属性加「待继续」进不了候选（手动/外部两通道当时均缺）；CLI 侧已实现，本包补 UI 通道"
task: 11-19-property-ui-add-option
order: 130
touch: [frontend/app/view/aisessions/property/**, .trellis/tasks/11-19-property-ui-add-option/**, loop/items/N-1119-prop-ui-add-option.md]
rollback: "纯前端追加逻辑，判定不满足（session scope / 已存在）即零写入；revert 即回到现状"
budget: {minutes: 120, retries: 2}
releaseCandidate: false
createdAt: "2026-11-19T11:45:00Z"
---

# UI 属性新值自动追加候选

## 背景

UI 写值只写会话值、不追加候选；CLI 侧 `--prop-add-option` 已实现（main，未随 0.0.131 发布）。
nita 2026-11-19 拍板选法 B：仅 agent/global scope 的模板定义追加，session 私有不动全局模板。

## 验收判据

- [ ] `npx vitest run frontend/app/view/aisessions/property/` → 全绿（含新增追加单测）
- [ ] `npx vitest run frontend/app/element/info-card/` → 全绿（schema helpers 共用方回归）
- [ ] 幂等：重复提交同一新值不重写 settings；session scope 不写模板；模板写失败不阻断值写入

## 记录

- 门状态：G6 方案 = 任务 prd.md（含拍板）；G2 器具 = 上三条判据。引擎在 Windows 侧，凭据待引擎代录。
