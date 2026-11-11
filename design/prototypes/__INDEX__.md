# design/prototypes 索引（按功能域）

> 生成方式：2026-11-08 目录整理后人工/脚本辅助整理。状态以各原型 `README.md` 为准；此处为导航清单。

## agent
- `agent/agent-card-accent/` — 同步状态：▼ 过时（2026-11-03 被 `agent-card-hybrid` 取代：左侧 3px 色条已从 `info-card.scss` 移除，状态改由右上 chip + 标题引用线表达）
- `agent/agent-card-beautify/` — 同步状态：▲ 设计活跃（未实现）
- `agent/agent-card-hybrid/` — 同步状态：◐ 部分落地（2026-11-03：C 行骨架 + 头像/引用块 + 右上三件套已写入真实组件；折叠与 usage 指标仍是备选）
- `agent/agent-id-card/` — 同步状态：▲ 设计活跃（未实现）
- `agent/new-agent-panel/` — 同步状态：◐ 部分落地（阶段 1 已实现，继承开关为 future concept）
- `agent/new-agent-vendor.html` — （单文件原型）
- `agent/notion-property-agent-card/` — 同步状态：▲ 设计活跃（未实现）
- `agent/property-add-scope/` — 同步状态：◐ 部分落地（UI 浮层 + scope 数据模型 + 外部通道已实现，真机验证未跑）

## aisessions
- `aisessions/aisessions-annotation-card-ux/` — 同步状态：▲ 设计活跃（未实现）
- `aisessions/aisessions-chat-redesign/` — 同步状态：▲ 设计活跃（未实现）｜● 已落地｜▼ 过时待清理｜◐ 部分落地
- `aisessions/aisessions-fold-redesign/` — 同步状态：▲ 设计活跃（未实现）
- `aisessions/aisessions-freshness-encoding/` — 同步状态：（待确认）
- `aisessions/aisessions-list-redesign/` — 同步状态：▲ 设计活跃（原型已落地，未实现）｜镜像源：frontend/app/view/aisessions/aisessions.tsx, session-row.tsx
- `aisessions/aisessions-no-tag-filter.html` — （单文件原型）
- `aisessions/aisessions-path-filter/` — 同步状态：◐ 部分落地（前端+后端已实现，待真实 UI 验证）
- `aisessions/aisessions-running-indicator/` — 同步状态：▲ 设计活跃（未实现）
- `aisessions/list-grouping-modes/` — 同步状态：▲ 设计活跃（待确认是否仍作为现行参考）
- `aisessions/pi-skill-messages-guide/` — 同步状态：▲ 设计活跃（未实现）
- `aisessions/session-detail-block-header/` — 同步状态：▲ 设计活跃（未实现）

## collab
- `collab/ui-prototypes/` — 同步状态：（待确认）

## commontext
- `commontext/commontext-cloud-sync-notion/` — 同步状态：▲ 设计活跃（未实现）
- `commontext/commontext-compose-modal-improved.html` — （单文件原型）
- `commontext/commontext-list-meta-sort/` — 同步状态：✅ 已落地（2026-11-05，`frontend/app/commontext/`，分支 `feat/commontext-list-meta-sort`）
- `commontext/commontext-pinned-detail-insert.html` — （单文件原型）
- `commontext/commontext-send-agent-block/` — 同步状态：● 已落地（2026-11-10，`frontend/app/commontext/commontext-send-button.tsx` + `pending-input.ts` + `term.tsx`）
- `commontext/commontext-search-virtual.html` — （单文件原型）

## connections-settings
- `connections-settings/ssh-config-edit/` — 同步状态：▲ 设计活跃（未实现）

## design-foundations
- `design-foundations/brand/` — 
- `design-foundations/skeleton-loaders/` — 同步状态：▲ 设计活跃（未实现）｜20 种水下主题骨架加载动画画廊：焦散/声呐/气泡/潮位等，可切暗亮主题、点卡复制 CSS，含两轮评审记录
- `design-foundations/design-system.html` — （单文件原型）
- `design-foundations/light-theme-variations.html` — （单文件原型）
- `design-foundations/review-boundary/` — 

## editor-block-ux
- `editor-block-ux/block-info-cards/` — 同步状态：▲ 设计活跃（未实现）
- `editor-block-ux/message-queue-redesign/` — 同步状态：▲ 设计活跃（未实现）

## files-preview
- `files-preview/files-block-favorites/` — 同步状态：▲ 设计活跃（未实现）
- `files-preview/files-header-split-reveal/` — 同步状态：● 已落地（2026-11-07，task 11-07-files-header-hover-latch）
- `files-preview/files-vcs-header-enhance/` — 状态：**设计中（待确认）**，真实代码未改动
- `files-preview/markdown-banner/` — 同步状态：● 已落地（真实组件已实现）
- `files-preview/save-conflict-protection/` — 同步状态：▲ 设计活跃（未实现）

## misc

## overview-dashboard
- `overview-dashboard/agent-card-metrics/` — 同步状态：◐ 部分落地（2026-11-09，`session-metrics{,-view}.tsx`）｜看板卡/列表行补消息数・体积・活跃跨度・创建时间（A 度量轨 / B 2×2 / C 内联三变体，含实测卡高）
- `overview-dashboard/board-chip-polish/` — 同步状态：◐ 部分落地（2026-11-09，`session-overview.scss` 的 `.session-overview-board-chip` 已改为 A 形态）｜before/after 可切换 + 三主题 + 实时宽高测量
- `overview-dashboard/combine-dashboard-legacy.html` — （单文件原型）
- `overview-dashboard/overview-board-v2/` — 
- `overview-dashboard/overview-card-click/` — 同步状态：（待确认）
- `overview-dashboard/overview-group-views/` — 同步状态：（待确认）
- `overview-dashboard/overview-kanban/` — 

## tabs-shell-launch
- `tabs-shell-launch/block-sidebar/` — 同步状态：▲ 设计活跃（未实现）
- `tabs-shell-launch/env-launch-entry/` — 同步状态：◉ 已落地（阶段 2/3 进真实代码 + 阶段 4 的 OSC 10/11 应答根因修复）
- `tabs-shell-launch/inline-tab-add-menu/` — 同步状态：◉ 真实代码已落地（与本文原型存在两处行为差异，见末尾「与原型差异」）
- `tabs-shell-launch/move-block-modal-v3/` — 同步状态：▲ 设计活跃（未实现）
- `tabs-shell-launch/quick-launch.html` — （单文件原型）
- `tabs-shell-launch/shell-settings/` — 同步状态：▲ 设计活跃（未实现）
- `tabs-shell-launch/tab-card-v2/` — 同步状态：◐ 部分落地（2026-11-02 起，变体 #4 v-notion 已进 `tab-info-card.tsx` 与 `info-card.scss`；其余 7 个变体仅作参考）
- `tabs-shell-launch/widget-quick-launch/` — 同步状态：● 已落地（真实组件已实现）

## vcs
- `vcs/files-vcs-tree-status/` — 状态：**设计中（待确认）**，未改动任何真实代码
- `vcs/vcs-block-redesign/` — 同步状态：▲ 设计活跃（未实现）
- `vcs/vcs-block-tabs/` — 同步状态：● 已落地（真实组件已实现）
- `vcs/vcs-header-hover-panel/` — 同步状态：▲ 设计活跃（未实现）
- `vcs/vcs-repo-switcher/` — 同步状态：▲ 设计活跃（未实现）
- `vcs/vcs-repo-switcher-v2/` — 同步状态：◐ 部分落地
- `vcs/vcs-status-settings/` — 状态：**设计中（待确认）**，未改动真实代码
- `vcs/vcs-remote-sync-widget/` — 同步状态：◐ 部分落地（代码已实现，真机截图验证待做），Remote 区上游行 + Incoming/Outgoing 列表美化

## updater
- `updater/updater-flow/` — 同步状态：▲ 设计活跃（未实现）｜镜像源：frontend/app/tab/updatebanner.tsx, frontend/app/modals/about.tsx, emain/updater.ts

## _archive
- `_archive/meta/__REVIEW_GUIDE__.md`（历史审阅指南）
- `_archive/meta/vcs-block-redesign.root.html`（根目录重复快照）


## settings
- `settings-density/` — 同步状态：▲ 设计活跃（未实现）｜镜像源：frontend/app/view/waveconfig/*（waveconfig.tsx / agentnotifysettings.tsx / syncsettings.tsx 等）
