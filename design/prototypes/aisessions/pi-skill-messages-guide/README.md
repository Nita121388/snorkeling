# pi 启动提示解读 · Skill 去重 & YAML 解析 — 原型

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：pi 终端启动日志（skill 加载去重 + frontmatter 解析告警）
> 最后同步：2026-09-15

## 目的

把 pi 每次启动时在终端刷出的两类信息，做成一张**可读性更好的解读页**：

1. **Skill conflicts** —— 同名 skill（本项目里的 `gitnexus-*`）在「项目级 + 用户级」各装一份时，pi 的去重策略（auto 项目优先，项目那份生效、用户那份 skipped）。这是**正常去重，不是错误**。
2. **YAML 解析报错** —— `snorkeling-release\SKILL.md` 的 frontmatter `description:` 是超长未加引号的裸字符串，中间含 `流程: `（冒号+空格），被 YAML 当成嵌套映射，抛 `Nested mappings are not allowed in compact mappings`。这是**唯一真问题**，会导致该 skill 加载失败/元信息识别异常。

## 内容结构（卡片式）

- **模拟终端**：复现 pi 启动时的四行日志（✓ project / ✗ user skipped ×2 / ⚠ YAML error），一眼建立「哪些正常、哪个要修」的印象。
- **① Skill conflicts 卡**：两路径对比（项目级生效 / 用户级跳过）+ 长期隐患折叠注记（二选一清理）。
- **② YAML 解析卡**：报错原文 → 问题行高亮 `流程: ` → 根因 5 步 → **修复对比**（裸字符串 vs 单引号包裹）+ 复制修复后整行按钮。
- **速查表**：一句话结论汇总。

## 交互点

- 复制按钮（修复后整行 description、路径、报错行）。
- 折叠注记（`<details>`）。
- 仅纯前端，无外部依赖。

## 说明

本页是**信息解读页**，非应用内 UI 组件镜像，因此镜像源填的是「pi 终端启动日志」而非 `frontend/` 下某组件。属于为理解/排查提供的手册型原型。

## 待办 / 后续

- [ ] 若确实清理用户级 gitnexus skill，可在此页补充「清理后不再出现 conflicts」的对照。
- [ ] 修好 `snorkeling-release\SKILL.md` 后可标记本页 ② 为「已修复」状态。
