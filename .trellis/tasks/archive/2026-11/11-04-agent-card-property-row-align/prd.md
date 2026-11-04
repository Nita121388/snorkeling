# Agent card property row align（属性行横纵对齐）

## 背景 / 现象

Agent hover 卡（`AgentHoverCard` → `SessionNoteSection` → `PropertyList layout="agent"`）下半部属性行：

1. **横向**：`Note` 行的空占位 `—` 比 `Tags` 的 `—` 左移 **18px**（正好一个「放大」图标宽）。
2. **纵向**：`Note` 行整体上浮约 **6px**，`—` 不垂直居中，且与 `Tags` 之间行距从 26px 掉到 20px。

像素实测（截图 348×237）：

| 行 | 值墨迹右缘 | label 中心 y |
|---|---|---|
| Updated `38s ago` | 329 | 96.0 |
| Created `1h ago` | 329 | 121.5 |
| Tags `—` | 329 | 148.5 |
| Note `—` | **311 (=329-18)** | **168.5（应为≈174.5）** |

## 根因

**横向**
- `property-list.tsx` 的 `<span class="property-row__value">` 内，note 行额外渲染了 `<button class="property-row__dialog-btn">`（18×18）。
- agent 布局把它设 `opacity: 0`，但 `.property-row__value` 是 flex 容器，该按钮**仍占 18px 布局宽**，把同级 `width:100%` 的 `.property-row__button` 压缩 18px → note 值右缘左移一个图标宽。

**纵向**
- 基础规则 `.property-row.is-note { align-items: flex-start; }`（为多行 note 预览设计），agent 段又加 `margin-top:2px; line-height:1.45`。
- 空 note 的占位 `—` 是**单行**，却仍套用 `flex-start` → 26px 行高内约 9.3px 余量全落底部，内容贴顶 → 视觉上浮 ≈6px。

## 方案（已确认）

**横向 A｜统一 18px 右侧操作栏**
- `.property-list--agent .property-row__value` 预留 18px 操作位。
- `.property-row__dialog-btn` / `.property-row__menu-btn` 改为绝对定位，落在该预留位内。
- 目标：所有行（含自定义属性带 ⋯ 菜单）值右缘永远一致，hover 图标不覆盖值内容。

**纵向 V1｜`:has` 条件居中**
- `.property-list--agent .property-row.is-note:has(.property-empty--dash)` 恢复 `align-items: center`，icon/name 取消 `margin-top`、`line-height` 回到 26px，value 列 `align-items: center`。
- 保留"真实多行 note 首行对齐"的既有设计，只修空占位。

## 影响面

- 仅 `frontend/app/view/aisessions/property/property-list.scss` 的 `.property-list--agent` 段。
- notion 布局（详情卡 / 弹窗）完全不受影响。
- 不改 TSX 逻辑。

## 验收标准

- [ ] 四行（Updated/Created/Tags/Note）值右缘同一 x；Note 的 `—` 与 Tags 的 `—` 像素级对齐。
- [ ] Note 行 label / `—` 垂直中心与 26px 行节奏一致（与 Tags 差 <1px）。
- [ ] 行 hover 时 note 放大按钮 / 自定义属性 ⋯ 按钮落在右侧 18px 操作栏内，不遮挡值文本。
- [ ] 真实多行 note 仍首行对齐（不变）。
- [ ] notion 布局（详情卡）视觉零变化。
- [ ] `npx vitest run frontend/app/view/aisessions/property/property-list.dom.test.tsx` 通过。
- [ ] 启动 app + CDP 截图，重复像素列扫描确认对齐。
