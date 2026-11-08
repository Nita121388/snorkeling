# Block Info Cards — Block 信息卡（悬停/选中详情）

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/block/（Block 本体）、frontend/app/view/term/agent-hover-card.tsx（同类悬停卡参考）
> 最后同步：2026-09-05

---

## 背景

Block 目前缺乏统一的"信息卡"呈现：agent 块、文件预览块、终端块各自为政，悬停/选中时没有一致的概览信息（路径、会话、状态、操作入口）。

## 核心设计

- 悬停/选中 Block 时展示信息卡，聚合该块的路径、来源、状态、常用操作（打开/切换/关闭）
- 与已有 hover 卡（agent-hover-card）样式语言保持一致，同一主题体系
- 原型仅做静态演示，真实实现待组件层确认结构后接入

## 文件

- `index.html` — 原型主页面
- `script.js` — 原型交互（悬停/切换演示）
- `style.css` — 原型样式