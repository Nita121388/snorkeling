# Markdown Banner 原型

## 概述

基于 Wolai 风格的 Markdown Banner 组件原型，支持：
- Banner 图片显示
- 垂直位置调节 (banner_y)
- 锁定位置 (banner_lock / sticky)
- Emoji badge 集成（位于左侧）
- 笔记标题渲染（emoji 下方，属性上方）
- 响应式设计

## 布局结构

```
┌─────────────────────────────────────────────────────────────┐
│  Banner Image (full-width)                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  <img> with object-position                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [Emoji Badge] ← 左侧，从 banner 底部突出                   │
└─────────────────────────────────────────────────────────────┘
                                                             │
┌─────────────────────────────────────────────────────────────┐
│  🐠  设计模式 ← 标题区域（emoji 下方）                       │
├─────────────────────────────────────────────────────────────┤
│  Properties Card ← 属性卡片                                 │
│  路线: 空                                                   │
│  状态: ⏳ 进行中                                            │
│  分类: ⛵ 设计模式                                          │
├─────────────────────────────────────────────────────────────┤
│  Note Content ← 笔记正文                                   │
└─────────────────────────────────────────────────────────────┘
```

## 功能演示

### 1. Banner 图片
- 全宽显示，`object-fit: cover`
- 支持垂直位置调节 (`object-position`)
- 加载动画（淡入效果）

### 2. Emoji Badge
- **位置**: 左侧，从 banner 底部向下突出 24px
- **尺寸**: 56x56px（移动端 48x48px）
- **样式**: 毛玻璃背景，圆角 14px，阴影效果
- **交互**: 点击打开 emoji picker

### 3. 标题区域
- **位置**: banner 下方，emoji badge 右侧
- **样式**: 32px 粗体（移动端 26px）
- **内容**: 笔记标题文本

### 4. 控制面板
- **垂直位置**: 0-100% 调节图片显示位置
- **高度**: 100-400px 调节 banner 高度
- **锁定位置**: 启用 sticky 定位，滚动时固定
- **图片源**: 切换不同图片
- **Emoji**: 切换文档 emoji

## 文件结构

```
markdown-banner/
├── index.html      # 主原型文件
└── README.md       # 本文档
```

## 使用方式

1. 在浏览器中打开 `index.html`
2. 使用右下角控制面板调整 Banner 设置
3. 滚动页面查看 locked 模式的收缩效果

## 设计规范

### CSS 变量

```css
--banner-height: 200px;    /* Banner 高度 */
--banner-y: 50%;           /* 垂直位置 */
--banner-radius: 8px;      /* 底部圆角 */
```

### 类名

| 类名 | 说明 |
|------|------|
| `.markdown-banner-container` | Banner 容器 |
| `.markdown-banner-image` | Banner 图片 |
| `.markdown-banner-overlay` | 渐变遮罩 |
| `.markdown-banner-emoji` | Emoji badge 容器 |
| `.markdown-doc-emoji-badge` | Emoji badge 按钮 |
| `.markdown-title-area` | 标题区域容器 |
| `.markdown-title-text` | 标题文本 |
| `.locked` | 锁定模式 |
| `.collapsed` | 收缩状态（滚动后） |

### 响应式断点

- 移动端 (< 768px): Banner 高度 150px，badge 尺寸缩小，标题字号缩小
