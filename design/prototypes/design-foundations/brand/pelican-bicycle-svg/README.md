# 🐦 鹈鹕骑自行车 · SVG 2D 动画

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：无（独立演示原型）
> 最后同步：2026-08-25

用纯 SVG + CSS 变量 + SMIL 动画实现的一只鹈鹕骑自行车在草地上前进的 2D 动画。**零 JavaScript 依赖**即可播放（内置的暂停/播放/调速按钮只是调用浏览器原生的 `pauseAnimations` / `setCurrentTime` / `playbackRate` API）。

## 打开方式

直接用浏览器打开 `index.html`，或运行本地静态服务：

```bash
python3 -m http.server 8000
# 然后访问 http://localhost:8000
```

## 动画构成

| 元素 | 动画方式 | 说明 |
|---|---|---|
| 整体平移 | `<animateTransform type="translate">` | 鹈鹕+自行车沿地平线来回缓动移动 |
| 车轮 | `rotate` 绕轮心转 360° | 前后轮同速同向，辐条转动 |
| 踏板/曲柄 | `rotate` | 中轴带动曲柄蹬踏，1.6s 一圈 |
| 腿部 | `rotate` | 腿围绕座垫附近旋转，模拟蹬踏 |
| 翅膀 | `rotate -6°~4°` | 左右摆动 |
| 下喙/袋囊 | `rotate 0~6°` | 嘴巴一张一合 |
| 身体 | `translate` | 轻微上下颠簸 |

## 技术要点

- 全部动画使用 **SMIL**（`<animate>` / `<animateTransform>`），不依赖第三方库。
- 颜色用 CSS 变量（`var(--xxx)`），方便改主题。
- 缓动用 `keySplines` 实现平滑往返。
- 控制按钮通过 SVG 的 SMIL 时间控制 API 实现暂停/复位/变速。

## 说明

本文档为独立演示原型（不映射真实产品组件）。发布为 CSDN 技术文章，宣传「灵链云 API (llapi.org)」。