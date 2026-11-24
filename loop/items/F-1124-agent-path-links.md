---
id: F-1124-agent-path-links
title: "终端/AI 面板 agent 路径链接：OSC8 激活 + 脏路径修复 + Search In Files 兜底"
type: feature
priority: P1
status: open
origin: self
source: "nita 2026-11-24：终端里 agent 输出的路径是蓝字下划线但点不动；写法五花八门（file///、D:/xxx、(E://xxx)、相对路径）"
task: 11-24-agent-path-links
order: 100
touch: [frontend/app/view/term/term-link-handler.ts, frontend/app/view/term/term-link-handler.test.ts, frontend/app/view/term/termwrap.ts, frontend/app/view/term/term-file-url.ts, frontend/app/element/agent-path-ref.ts, frontend/app/element/agent-path-ref.test.ts, frontend/app/element/agent-path-open.ts, frontend/app/element/agent-path-open.test.ts, frontend/app/element/markdown.tsx, frontend/app/element/streamdown.tsx, frontend/app/view/preview/file-link-navigation.ts, docs/project/**, .trellis/spec/**, loop/**]
rollback: "git checkout frontend/app/view/term frontend/app/element frontend/app/view/preview"
budget: {minutes: 300, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T06:09:08Z"
---

# 终端/AI 面板 agent 路径链接：OSC8 激活 + 脏路径修复 + Search In Files 兜底

## 背景

根因：终端只装了 WebLinksAddon（正则匹配明文 URL），Terminal.options.linkHandler 从未设置；xterm 内置 OscLinkProvider 在无 linkHandler 时把非 http(s) 的 OSC8 链接整个丢弃，而 urlId 又给单元格强加下划线 → 看着像链接、点击/hover/右键全无反应。上一期 docs/answers/terminal-file-url-ctrl-click-20261022-151126.html 已把 OSC-8 明确推迟。

## 来源

- self：nita 2026-11-24：终端里 agent 输出的路径是蓝字下划线但点不动；写法五花八门（file///、D:/xxx、(E://xxx)、相对路径）

## 验收判据

- [ ] `cmd /c "npx vitest run frontend/app/view/term/term-link-handler.test.ts >nul 2>&1 && echo TLH_OK"` → `TLH_OK`
- [ ] `cmd /c "npx vitest run frontend/app/element/agent-path-ref.test.ts frontend/app/element/agent-path-open.test.ts >nul 2>&1 && echo PATH_REF_OK"` → `PATH_REF_OK`
- [ ] `cmd /c "npx vitest run frontend/app/view/term >nul 2>&1 && echo TERM_SUITE_OK"` → `TERM_SUITE_OK`
- [ ] `cmd /c "npx eslint frontend/app/view/term frontend/app/element frontend/app/view/preview >nul 2>&1 && echo ESLINT_OK"` → `ESLINT_OK`

## 记录

_（待补）_
