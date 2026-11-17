# Implement — 执行清单

## 顺序

1. [x] 建任务 + PRD/design/implement 三件套
2. [x] `task.py start` 激活
3. [x] `assets/proto.css`：token（暗/亮）+ shell + 通用组件样式
4. [x] `assets/proto.js`：主题切换 + 导航 + 通用交互
5. [x] hub `index.html`
6. [x] 10 个原型页（01–10，每页：问题清单 → 方案清单 → 交互演示 → 规格条）
7. [x] 批次 `README.md`（▲ 设计活跃）+ 登记 `design/prototypes/README.md` 功能域表与 `__INDEX__.md`
8. [x] 校验：`node docs/sync-audit/audit-sync.mjs --json` 不回归（若脚本可用）；HTML 引用路径检查
9. [ ] 提交（仅本批新增文件）+ 推送 origin main

## 验证记录（2026-11-17）

- 无头 Chrome DOM 断言：11 页全部动态内容渲染成功（tab/board/diff/graph/chips 等）。
- 截图目检 11 页（暗）+ 2 页（亮）：修复 demo-tag 压控件（统一 26px 标题带）、01 画布居中、03 列宽 196、04 底部渐隐、06 只看改动开关相位、07 提交图连续泳道、09 标签 chip 化。
- `node docs/sync-audit/audit-sync.mjs --json`：本批次 0 issue；顺带清了顶层 README 的陈旧同步告警。
- `git diff --stat HEAD -- frontend/`：无本批改动（纯设计层交付）。

## 验证命令

- 打开 `design/prototypes/ui-ux-audit-batch/index.html`（浏览器）逐一过 10 项。
- `ls design/prototypes/ui-ux-audit-batch/*.html | wc -l` → 11。
- `git status --short design/` → 只含本批新增；`git diff --stat HEAD -- frontend/` 无本批改动。

## 回滚点

- 任一页不合格：只重写该单文件。
