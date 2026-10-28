# aisessions 时长条左置（阅读动线优化）

## 问题

折叠工具组 / 子代理卡的时长条当前在头部行**最右侧**（tool-group 在 summary/diff 之后，subagent 在 agentName 之后）。LTR 阅读视线从左起，时长被压到右边缘，扫读时接不住，需移到最右并 hover 才看得到精确值。

## 目标

把时长信息移到**头部行首**（chevron 右侧、计数/名称之前），成为阅读起点第一个信息块；常驻"条 + 文字"，不依赖 hover。

## Requirements

- `tool-group.tsx`：DurationBar 移到 chevron 之后、计数徽标之前，顺序变为 `▸ [条] 3.4s  5 🔧 summary  +2 -1`。
- `subagent-card.tsx`：DurationBar 移到 chevron 之后、机器人图标/agent 名之前。
- `DurationBar` 增加 `showText`：条右侧常驻 `formatDuration` 文字；`title` 保留完整标签（Total … · N tools）。
- 不改时长计算口径、不新增监听、不增加行高（仍是单行头部）。
- 更新/补充 DurationBar 相关测试（如有）。

## Acceptance Criteria

- [ ] 工具组头部第一个信息块是时长（chevron 之后）。
- [ ] 子代理卡头部第一个信息块是时长（chevron 之后）。
- [ ] 时长文字常驻可见，hover 仍显示完整标签。
- [ ] `vitest` / `tsc` 无新增错误。
