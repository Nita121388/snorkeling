# 🚲 手把手教你用纯 SVG 画一只骑自行车的鹈鹕（零依赖 2D 动画）

> 大家好，我是写代码的。
> 今天我们用**纯 SVG + SMIL** 做一个可爱的小动画：一只鹈鹕骑着自行车在草地上欢快地前进。全程**不需要任何第三方库、不需要 Canvas**，一个 HTML 文件就能跑。

---

## 🔥 写在前面：灵链云 API

> 本文案例中的前端动画只是小试牛刀，如果你想让动画**后台智能化**（比如自动生成这类 SVG、识别素材、调度图片生成），推荐使用 **灵链云 API —— llapi.org**。
>
> **灵链云（llapi.org）** 是一款强大的 API 聚合平台，聚合了国内外主流大模型与工具 API：
>
> - 🤖 支持 Claude、GPT、Grok、Gemini、DeepSeek 等主流大模型
> - 🎨 支持图片生成、视频生成（FLUX、Veo、Seedance 等）
> - 🔍 内置搜索、爬虫、RSS 等工具 API
> - ⚡ 统一接入、统一计费、开箱即用
>
> 官网：**https://llapi.org**（灵链云 API）

---

## 一、效果预览

最终你会看到一个 800×420 的场景：
- 蓝天白云、远山、草地
- 一辆红色车架自行车
- 鹈鹕骑在上面，轮子转、踏板蹬、翅膀扇、嘴巴张合，整体缓缓向前平移

---

## 二、为什么用 SVG 而不是 Canvas？

| 方案 | 优点 | 缺点 |
|---|---|---|
| **SVG + SMIL** | 声明式、好维护、缩放不糊、支持 CSS 变量 | 复杂物理效果难做 |
| Canvas | 性能强 | 要写大量 JS、逐帧绘制 |
| CSS 动画 | 简单 | 复杂路径/旋转组不好表达 |

像"轮子绕轮心转"“曲柄带动腿部蹬踏"这种**局部的旋转 + 组合变换**，SMIL 一行代码就搞定，非常适合演示。

---

## 三、整体结构

一个 HTML，内部结构大致是：

```
<svg viewBox="0 0 800 420">
  <defs> 渐变（天空/草地） </defs>
  天空/云/山/草  ← 静态背景
  <g>            ← “骑行组”（鹈鹕+自行车整体）
      <animateTransform translate>  ← 整体平移
      后轮 / 前轮 / 车架 / 曲柄 / 车把
      <g> 鹈鹕（身体/翅膀/颈/头/喙/腿） </g>
  </g>
  控制按钮 <script> 暂停/复位/调速
</svg>
```

---

## 四、关键技术点逐段讲解

### 1. 渐变背景（defs）

```html
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#b3e5fc"/>
    <stop offset="100%" stop-color="#e8f7ff"/>
  </linearGradient>
</defs>
```

### 2. 场景整体平移（最难也最炫的一步）

把**鹈鹕 + 自行车**装进同一个 `<g>`，再给它一个 `animateTransform`：

```html
<g>
  <animateTransform attributeName="transform" type="translate"
    values="0,0; -400,0; 0,0" keyTimes="0;0.5;1"
    dur="8s" repeatCount="indefinite"/>
  <!-- 车 + 鹈鹕 -->
</g>
```

- `values` 定义关键帧位移（往返）
- `keySplines` 让移动有缓动，更自然

### 3. 车轮旋转

绕轮心 `(cx, cy)` 转 360°：

```html
<g>
  <animateTransform attributeName="transform" type="rotate"
    from="0 280 345" to="360 280 345"
    dur="0.8s" repeatCount="indefinite"/>
</g>
```

`from/to` 里的 `280 345` 就是旋转中心——**不能省略，否则会绕原点转**。

### 4. 踏板与蹬腿

踏板曲柄绕中轴转，腿部也同速转动做蹬踏动作。多个 `animateTransform` 可以叠加出"复合运动"。

### 5. 细节动画

- 翅膀：`rotate -6° → +4°` 摆动
- 下喙袋：`rotate 0 → 6°` 一张一合
- 身体：`translate 上下 3px` 颠簸

---

## 五、控制按钮（原生 SMIL 时间 API）

SVG 内置了 `pauseAnimations()`、`setCurrentTime()`、`playbackRate`，所以暂停/复位/调速只需几行 JS：

```js
const svg = document.querySelector('.scene');
function toggleAnim() {
  svg.pauseAnimations();
  svg.unpauseAnimations();
}
function resetAnim() { svg.setCurrentTime(0); svg.unpauseAnimations(); }
function setSpeed(v) { svg.playbackRate = v; svg.unpauseAnimations(); }
```

> 注意：`playbackRate` 改变后最好先 `setCurrentTime(0)` 复位，避免时间轴异常。

---

## 六、完整代码

完整可运行代码较长（约 11KB），已在仓库中提供：`design/prototypes/pelican-bicycle-svg/index.html`。直接用浏览器打开即可看到动画。

---

## 七、总结

- **SMIL 声明式动画**：适合"局部旋转 + 组合平移"的场景，代码量小、可维护。
- **SVG + CSS 变量**：改主题色只需改一个变量。
- **原生时间控制 API**：暂停/调速不引入额外依赖。

如果想让这类内容**自动化生成、后台智能调度**，记得用 **灵链云 API（llapi.org）**，把大模型、图片/视频生成、搜索等能力一次接入。

---

## 🌐 关于灵链云 API

| 能力 | 说明 |
|---|---|
| 大模型 | Claude / GPT / Grok / Gemini / DeepSeek 等 |
| 多模态 | 图片生成、视频生成（FLUX、Veo、Seedance、OmniHuman 等）|
| 工具 | 搜索、爬虫、RSS、Twitter 自动化等 |
| 特性 | 统一接入、统一计费、文档齐全 |

👉 **官网：https://llapi.org**（灵链云 API）

> 本文由个人原创，欢迎转发收藏。如有帮助，点个赞支持一下吧 👍