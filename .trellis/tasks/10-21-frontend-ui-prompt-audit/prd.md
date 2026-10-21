# 前端开发 Prompt 编写与 Wave AI 设置界面待修项核对

## 背景

用户从论坛看到一套"前端提示词"（优先复用成熟库、统一设计语言、指定库）：shadcn/ui Nova + Lucide + Motion + react-resizable-panels + dnd-kit + Zustand。需要判断这套东西对本项目（Snorkeling，WaveTerm fork）是否适用，并产出一份项目专属的前端开发 Prompt，最终用于美化 Settings → Wave AI Modes 界面。

## 目标

1. 产出一份项目专属前端 Prompt（`aiprompts/frontend-ui-prompt.md`），每条技术断言都必须能在仓库里核对。
2. 校对记录与评审结论单独成文（`aiprompts/frontend-ui-prompt.review.md`）。
3. 在此基础上实施 Wave AI 设置界面美化。

## 关键结论

论坛推荐的 5 个库在本仓库**全部不适用**（未安装 / 技术选型不同），真正的原则是"先复用仓库已有实现"：

- 组件库：自建 `frontend/app/element/*`，不是 shadcn
- 图标：Font Awesome Sharp，不是 Lucide
- 动画：CSS transition + SCSS keyframes，无 Motion
- 拖拽：react-dnd，不是 dnd-kit
- 状态：jotai 2.9.3（root 锁版本），不是 Zustand

## 验收标准

- [x] Prompt 中每条技术断言可复现核对，核对命令写入 review 文档
- [x] 上一版 6 处事实错误已全部修正并记录
- [x] 补齐"仓库缺什么 / 该不该补"的分级建议
- [x] Wave AI 设置界面按 Prompt §9 实施完成
- [x] tsc 零新增诊断、eslint 通过、新增测试通过
- [x] 真机 CDP 截图验证（light 主题）

## 范围外

- 内置预设 Quick/Balanced/Deep 是否重新展示：按方案 A（保持隐藏）处理，需用户另行确认
- `bg-surface*` 存量 99 处的批量治理：单独任务
- 全仓库 `className` 含 `block` 的 137 处：单独评估
