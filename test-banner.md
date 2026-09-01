---
banner: "[[Home/assets/Home/file-20260601151554795.png]]"
banner_y: 0.5
banner_lock: true
tags:
  - 测试
  - banner
---

# Banner 测试页面

这是一个用于测试 Obsidian Banner 插件的页面。

## 功能说明

1. **Banner 图片**：顶部显示横幅图片
2. **垂直位置**：`banner_y: 0.5` 表示图片垂直居中显示
3. **锁定模式**：`banner_lock: true` 表示滚动时 banner 固定在顶部

## 测试步骤

1. 在 Snorkeling 中打开此文件
2. 观察 banner 是否正常显示
3. 尝试滚动页面，观察锁定效果
4. 修改 `banner_y` 值，观察图片位置变化

## 属性说明

| 属性 | 类型 | 说明 |
|------|------|------|
| `banner` | string | 图片路径或 wikilink |
| `banner_y` | number | 垂直位置 (0-1) |
| `banner_lock` | boolean | 是否锁定 |

## 示例属性

```yaml
banner: "[[path/to/image.png]]"
banner_y: 0.3  # 图片显示在顶部 30% 位置
banner_lock: false  # 不锁定，滚动时随页面移动
```
