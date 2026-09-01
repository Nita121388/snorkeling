# Obsidian Banner 插件适配指南

## 概述

Snorkeling 已成功适配 Obsidian Banner 插件功能，支持在 Markdown 文件预览中显示 banner 图片。

## 功能特性

### 支持的属性

在 Markdown 文件的 frontmatter 中添加以下属性：

```yaml
---
banner: "[[path/to/image.png]]"
banner_y: 0.5
banner_lock: true
---
```

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `banner` | string | - | 图片路径或 wikilink `[[path]]` |
| `banner_y` | number | 0.5 | 垂直位置 (0-1)，0=顶部，1=底部 |
| `banner_lock` | boolean | false | 是否锁定（滚动时固定在顶部） |

### 支持的图片路径格式

1. **Wikilink 格式**：`[[path/to/image.png]]`
2. **相对路径**：`path/to/image.png`
3. **绝对路径**：`/absolute/path/to/image.png`

### 视觉效果

- **图片显示**：使用 `object-fit: cover` 确保图片填满区域
- **渐变遮罩**：底部有渐变遮罩，增强文字可读性
- **锁定模式**：滚动时 banner 固定在顶部，内容在下方滚动
- **折叠效果**：锁定模式下，滚动超过 banner 区域时自动折叠
- **响应式设计**：适配不同屏幕尺寸

## 使用方法

### 1. 基本使用

在 Markdown 文件中添加 frontmatter：

```yaml
---
banner: "[[Home/assets/banner.png]]"
banner_y: 0.5
banner_lock: false
---

# 我的笔记

这是笔记内容...
```

### 2. 锁定模式

```yaml
---
banner: "[[assets/header.jpg]]"
banner_y: 0.3
banner_lock: true
---

# 固定头部的笔记

滚动时 banner 会固定在顶部。
```

### 3. 调整图片位置

```yaml
---
banner: "[[assets/landscape.jpg]]"
banner_y: 0.2  # 显示图片顶部 20% 的区域
banner_lock: false
---

# 风景笔记

图片将显示顶部 20% 的区域。
```

## 技术实现

### 文件结构

```
frontend/app/view/preview/plugins/banner/
├── index.ts              # 导出文件
├── banner-block.ts       # 属性解析
├── banner-renderer.tsx   # 渲染组件
├── banner-plugin.tsx     # 插件注册
└── banner.scss          # 样式文件
```

### 核心组件

1. **BannerBlock**：解析 frontmatter 中的 banner 属性
2. **BannerRenderer**：渲染 banner 图片和效果
3. **bannerPlugin**：注册为预览插件，接管 .md 文件

### 与现有系统集成

- **优先级**：优先级低于 md-properties 插件 (-1 < 0)
- **回退机制**：无 banner 属性时回退到普通 Markdown 预览
- **兼容性**：与现有属性卡片插件完全兼容

## 示例文件

参考 `test-banner.md` 文件，展示了完整的使用示例。

## 注意事项

1. **图片路径**：确保图片路径正确，且图片文件存在
2. **性能考虑**：大图片可能影响加载速度，建议优化图片尺寸
3. **浏览器兼容**：使用现代 CSS 特性，支持所有现代浏览器
4. **主题适配**：样式使用 CSS 变量，可适配不同主题

## 故障排除

### Banner 不显示

1. 检查 frontmatter 格式是否正确
2. 确认 `banner` 属性值不为空
3. 验证图片路径是否正确

### 图片加载失败

1. 检查图片文件是否存在
2. 验证路径是否正确（相对路径基于文件位置）
3. 查看浏览器控制台错误信息

### 锁定模式不工作

1. 确认 `banner_lock: true` 已设置
2. 检查页面是否正常滚动
3. 验证 CSS 样式是否正确加载

## 扩展功能

如需扩展功能，可以：

1. **添加 Emoji 徽章**：在 banner 上方添加 emoji 徽章
2. **标题区域**：在 banner 下方显示笔记标题
3. **交互功能**：点击 banner 打开图片查看器
4. **动画效果**：添加更多过渡动画

## 相关文件

- `banner-block.ts`：属性解析逻辑
- `banner-renderer.tsx`：渲染组件
- `banner-plugin.tsx`：插件注册
- `banner.scss`：样式定义
- `preview.tsx`：插件注册入口
