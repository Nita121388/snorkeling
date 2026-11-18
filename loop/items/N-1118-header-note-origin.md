---
id: N-1118-header-note-origin
title: "标题缓存缺 origin 维度：外部 dump 会话的 Header 退化为 Session Details，写操作落错库"
type: bug
priority: P1
severity: S2
solution: fixed
status: open
origin: self
source: "nita 2026-11-18：Header 走 session-note-cache（只按 connection 建键）而正文走带 origin 的 Detail，两条链路不同源"
task: 11-18-aisessions-header-note-origin
order: 100
touch: [frontend/app/store/**, frontend/app/block/**, frontend/app/element/info-card/**, frontend/app/modals/**, frontend/app/view/aisessions/**, pkg/service/aisessionsservice/**, frontend/types/gotypes.d.ts, .trellis/tasks/11-18-aisessions-header-note-origin/**, .trellis/spec/**]
rollback: "git revert 单提交；origin 建键向后兼容（空 origin = 旧行为），无数据迁移"
budget: {minutes: 90, retries: 2}
releaseCandidate: false
createdAt: "2026-11-18T05:17:38Z"
---

# 标题缓存缺 origin 维度：外部 dump 会话的 Header 退化为 Session Details，写操作落错库

## 背景

session-note-cache 以 connection+id 为键，Summary 不带 origin；后端 Detail/Summary 响应也不回填 origin 标签，导致 dump 会话标题取不到、写 note/title 落到本机 meta 库。

## 来源

- self：nita 2026-11-18：Header 走 session-note-cache（只按 connection 建键）而正文走带 origin 的 Detail，两条链路不同源

## 验收判据

- [ ] `npx vitest run frontend/app/store/session-note-cache.test.ts` → `passed`
- [ ] `npx vitest run frontend/app/block` → `passed`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/service/aisessionsservice -count=1"` → `ok`

## 记录

_（待补）_
