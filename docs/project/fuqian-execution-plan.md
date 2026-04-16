# 浮潜（Snorkeling）执行任务单（7步）

更新时间：2026-04-17  
当前进度：`6/7`

## 任务清单（严格顺序）

1. `T1` 干净基线初始化（官方仓库分支、隔离旧环境）  
状态：`done`

2. `T2` Agent 按钮插入右侧 widgets（位于 Terminal 与 Files 之间）  
状态：`done`  
关键提交：`e6c3d500`

3. `T3` Agent 智能继承终端上下文（focused terminal -> latest terminal -> fallback）  
状态：`done`  
关键提交：`e6c3d500`

4. `T4` 第三场景兜底增强（无终端上下文时优先使用当前聚焦块 connection）  
状态：`done`  
关键提交：`ff7a7712`

5. `T5` 原始需求沉淀到项目文档（章程 + 任务单 + README 入口）  
状态：`done`  
关键提交：见当前分支最新提交

6. `T6` 多终端/混合场景选择弹窗（用户显式选择目标终端环境）  
状态：`done`  
关键提交：见当前分支最新提交

7. `T7` OpenCove 风格配置机制 + CI/CD + 官方同步发布策略完善  
状态：`pending`

## 当前已落地的行为说明

- Agent 按钮已可用，默认走终端上下文继承
- 文件预览右键菜单支持 `Run Agent Here`
- Agent 点击行为：
  - 当前 tab 仅 1 个终端上下文：直接打开
  - 当前 tab 多个终端上下文：弹出目标终端选择浮层
- 智能上下文优先级：
  - 优先当前聚焦终端的 `connection + cmd:cwd`
  - 次选当前 Tab 最近终端上下文
  - 再次选当前聚焦块 `connection`
  - 最后选 Tab 级 `connection`

## 剩余风险

- `T7` 未完成前，Agent 配置机制与 CI/CD 仍未达到最终验收标准
