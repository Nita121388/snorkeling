> 同步状态：◐ 部分落地（方案 E 已实现于 2026-05-20，A/B/C/D/F/G 仍为备选）
> 镜像源：frontend/app/view/term/agent-hover-card.tsx, frontend/app/element/info-card/info-card.scss
> 最后同步：2026-05-20

# Agent Card 强调线改造（两头弯曲 → 通长圆头直条）

## 问题

`info-card.scss` 里 `.info-card.agent-card` 同时写了：

```scss
border-left: 3px solid var(--info-card-accent, var(--secondary-text-color));
border-radius: 8px;
```

`border-radius` 作用于整张卡片的边框盒，左侧那条 3px 强调线在上下圆角处被切成斜段，
视觉上两头向外翻，像两个钩子。用户明确不喜欢这种「两头弯曲的强调线」。

## 定稿方向（用户选 E · 已落地）

**通长直条 + 色条自身的圆头**：圆角从「卡片边框」还给「色条两端」。
条从卡片上边框内侧一直到下边框内侧，头尾是对称圆头，不存在被裁出来的斜段。

原型里的 **E** 就是这个方向：

```scss
.info-card.agent-card {
    position: relative;
    border-radius: 0 6px 6px 0;              /* 左直角右圆角：左边不再被切 */
    padding-left: 15px;                      /* 12 + 条宽 3，内容 x 与原样一致 */
}
.info-card.agent-card::before {              /* 色条本体 */
    content: "";
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    border-radius: 2px;                      /* 圆头来自条自己，不是卡片 */
    background: var(--info-card-accent, …);
}
```

注意 **G 是反例**：卡片保留四角全圆角 + 条放在卡内，条的上端会从圆角缺口里探出 1–2px 尖角。
要保留卡片全圆角，只能走 **F**（条作为卡片兄弟节点，需要 JSX 包一层）。

上述 CSS 已于 2026-05-20 写入 `frontend/app/element/info-card/info-card.scss` 的 `.info-card.agent-card`。

## 方案全景（原型中 8 个）

| 方案 | 做法 | 改动量 |
| --- | --- | --- |
| 0 现状 | `border-left: 3px` + `border-radius: 8px` | 对照 |
| A 全直角 | `border-radius: 0` | 1 行 |
| B 左直角右圆角 | `border-radius: 0 6px 6px 0` | 1 行 |
| C 顶部色带 | `border-left` → `border-top` | 1 行 |
| D 状态章 | B + 状态行做 chip | CSS + JSX |
| **E 通长圆头条**（✓ 已落地） | `::before` 伪元素 + `border-radius: 0 6px 6px 0` | CSS only |
| F 通长圆头条 + 卡外并列 | 条做兄弟节点 | CSS + JSX |
| G 通长圆头条 + 卡全圆角 | 反例，会探出尖角 | — |

## 打开方式

浏览器直接打开 `index.html`。控制条可切状态（working / done / blocked / error）、
宽度（280 / 320 / 380）、**圆头半径（1.5px / 2px / 3px）**，1.5x 放大镜，
点卡片看对应 CSS 片段。
