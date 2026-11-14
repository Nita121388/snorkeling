---
id: N-1114-commontext-tags-no-hash
title: "CommonText 标签 chip 去 # 前缀（兼容历史数据）+ 折叠摘要展示标签名"
type: fix-small
priority: P2
status: open
origin: self
source: "2026-11-14T09:10:00Z"
task: 11-14-commontext-tags-no-hash
order: 100
touch: [frontend/app/commontext/commontext-model.ts, frontend/app/commontext/commontext-compose-modal.tsx, frontend/app/commontext/commontext-model.test.ts, frontend/app/commontext/commontext-compose-modal.dom.test.tsx, scripts/verify/commontext-source-notion/, docs/project/verify-ledger.md]
rollback: null
budget: {minutes: 30, retries: 2}
releaseCandidate: false
createdAt: "2026-11-14T09:10:00Z"
---

# CommonText 标签 chip 去 # 前缀（兼容历史数据）+ 折叠摘要展示标签名

## 背景

标签 chip 仍显示 `#tag`（历史 `item.tags` 数据带 `#` 存储，`normalizeCommonTextTags` 只 trim 不剥 `#`，列表行/筛选 chip/汇总直接渲染原文）；属性折叠摘要行 tags 项只显示数量，折叠态看不到标签名。改法：`normalizeCommonTextTags` 读/写路径统一剥 `#`（与 `normalizeSessionTag` 同口径，历史数据读时即净）；摘要 tags 项改渲染标签名（join " · "，空态 "0"），span 允许收缩防溢出。

## 来源

- self：nita 2026-11-14 会话 —— 「标签中是否可以不显示#+文本了 不过需要注意兼容历史数据，另外CommonText折叠时需要展示标签不能省略」。

## 验收判据

- [ ] `npx vitest run frontend/app/commontext/ --reporter=basic` → 全绿（15 文件，新增 ≥3 例）
- [ ] 红证：旧源（git show HEAD）跑新断言 → ≥1 failed

## 记录

- 2026-11-14 实施：`normalizeCommonTextTags` 读/写两侧统一剥 `#`（与 `normalizeSessionTag` 同口径，
  历史 `#tag` 存量读时即净；正文 #tag 字面语义不变）；折叠摘要 tags 项改渲染标签名
  （join " · "，空态 0，tags 项允许收缩 + 内层 truncate 防溢出）。
- 排查发现：`SessionTagChips` 渲染前自带 normalizeSessionTags（本来就剥 #），列表 chip 本就净；
  真正暴露历史 # 的面是 Tags 浮层候选（PropertyTagEditor 直接渲染原文）与 tag 匹配语义
  （存储 #legacy 永不匹配抽取的 legacy）。dom 台 legacy 测试已改为穿透浮层候选断言。
- 红证（G2）：旧 model → 2 failed（normalize + 浮层候选 '#legacy'）；旧 modal → 摘要数量 + 源码断言。
  新源 194 passed（15 files，+3 例）。
- 真机台：补 tags-summary-shows-names 断言；启动器故障依旧，台账 skipped。
