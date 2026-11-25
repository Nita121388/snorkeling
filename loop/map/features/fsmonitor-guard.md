---
id: fsmonitor-guard
title: fsmonitor 常驻 daemon 收口
module: platform
parent: platform-stability
status: shipped
introduced: 2026-11-20
releases: []
---

内部 git 调用禁用 fsmonitor daemon。

证据：
- commit: fix(vcs): 内部 git 调用禁用 fsmonitor 常驻 daemon — 三处收口（2026-11-20）
