# 技术设计：Monochrome 去阴沉

## 1. 隔离原理

`frontend/app/theme.scss` 是四个**互不继承**的独立块，靠 `document.documentElement.dataset.theme` 切选择器：

```
:root, [data-theme="dark"]  → 169 个 token
[data-theme="light"]        → 133
[data-theme="monochrome"]   → 122
[data-theme="light2"]       → 122（当前不可达）
```

关键点：**monochrome 块是独立的，不与 light 合并**。`isLightResolvedTheme()` 只影响 JS 侧的二进制渲染器（shiki / Monaco / Mermaid / color-scheme / 终端透明度），不影响 CSS 变量。

唯一共享的 CSS 选择器是 `app.scss:34/38/40` 的 `:is([data-theme="light"], [data-theme="monochrome"])`，三条全是 `cursor: default`，与颜色无关。

因此：**改 monochrome 块内 token，dark/light 零影响**。

## 2. 继承链：parity 缺口的来源

`theme.scss:4` 的 `:root, [data-theme="dark"]` 同时是根级默认值。monochrome 块没定义的 token 会**落到 dark 的值**（不是 light）。

实测 monochrome 从 `:root`/dark 继承了 47 个 token，其中真正有害的：

| 缺失 token | 继承到的值（dark） | 后果 |
| --- | --- | --- |
| `--codeblock-diff-add-bg` | `#173d2a` 深绿 | 浅色页上深绿补丁 |
| `--codeblock-diff-add-text` | `#b7f7ca` 亮绿 | 同上 |
| `--codeblock-diff-del-bg` | `#4a2428` 深红 | 浅色页上深红补丁 |
| `--codeblock-diff-del-text` | `#ffc1c7` 亮粉 | 同上 |
| `--surface-shadow-color` | `#000000` 纯黑 | 浅色主题下 `--color-black` 叠色反向 |
| `--text-xxs..--text-title` | 未定义（fallback 到 tailwindsetup base） | 小字比 light 小一档 |

其余 38 个是 `--zindex-*` / `--font-*` / `--modal-border-radius` 等与颜色无关的全局常量，无害。

**修法**：在 monochrome 块内显式补上这 6 类 + 字号档 + `font-weight: 500`，把继承链切断。

## 3. 语义色取值推导

约束条件：

- **必须留在"黑白主题"的身份里** —— 不能变成彩主题。彩度上限压住（≤66）。
- **必须过 AA**（4.5），因为现状 3 个 token 不达。
- **必须解决"泥色"感** —— 病根是「低彩度 + 中明度（L≈48）」，这个区间任何色相都读起来像兑了水的脏色。

解法是**把明度往下压到 L 33–45**，同时把彩度提上来。同样的低彩度放在深明度区就读成"墨水色"而不是"泥色"：

```
泥色区   L 42–58, S 13–30   →  橄榄绿 / 卡其 / 灰紫
墨色区   L 33–45, S 20–66   →  墨绿 / 赭石 / 靛蓝 / 紫罗兰
```

具体推导（每个值都验证过 chip 上的文字对比度）：

| Token | 目标值 | 推导 |
| --- | --- | --- |
| `--success-color` | `#3f6b46` hsl(130,26,33) | 绿相保持 130°，L 48→33，S 13→26 |
| `--agent-done-color` | `#3f6b46` | 与 success 同源（现状同值，保持"done=成功"语义） |
| `--error-color` | `#9c4a42` hsl(5,41,44) | 现状 `#8a6a6a` 是"灰玫瑰"（S 仅 13），提到 41 才读得出是红 |
| `--warning-color` | `#8a641c` hsl(39,66,33) | 现状 `#8a7a4a` 是卡其，S 提到 66 读成赭石 |
| `--agent-working-color` | `#3a6b96` hsl(208,44,41) | 蓝相 220→208 更接近中性靛，S 21→44 |
| `--agent-stale-color` | `#6b5b8a` hsl(260,21,45) | 现状 L 58 太浅（3.53），压到 45 |

彩度上限说明：warning 的 S=66 是唯一偏高的，因为黄相在低明度区天然低彩度就会变"橄榄"，必须靠彩度区分。实测 chip 上对比度 4.56，仍过 AA。

## 4. 中性色：加暖 + 与 light 拉开

### 4.1 撞色约束

light 主题的画布是 `#f2eee5`（暖米白）。monochrome 若也走暖米白就会**观感趋同**，两个主题失去区分度。

ΔE76 实测：

| monochrome canvas 候选 | ΔE vs light `#f2eee5` | 判断 |
| --- | --- | --- |
| `#f5f3ee`（初版提案） | 2.76 | 否决，刚过可辨阈 |
| `#f7f6f3` | **4.24** | **采用** |
| `#f8f7f4` | 4.47 | 更安全但暖意弱 |
| `#fafafa`（现状） | 6.33 | 完全区分但仍是冷灰 |

选 `#f7f6f3`：暖意来自正文/表面层/边框，画布只做微暖（S=20），既去掉"复印纸"感又不撞 light。

### 4.2 层次保序

现状层次（浅→深）：`#fafafa`(canvas) → `#f5f5f5`(surface) → `#f0f0f0`(surface-strong)

目标层次：`#f7f6f3`(canvas) → `#fdfcf9`(surface-soft, 抬起) → `#f1efe8`(surface) → `#e9e6de`(surface-strong, 凹陷)

注意 **surface-soft 比 canvas 更浅**（`#fdfcf9` > `#f7f6f3`），这与 light 的层次约定一致（`--surface-soft-color` 是"抬起层"，比轨道浅）。现状 monochrome 把 surface-soft 写成 `#fafafa` 等于 canvas，抬起层没层次。

### 4.3 accent 灰阶 ramp

`--accent-color-50..900` 是 accent 的近邻阶梯。Tailwind 的 `text-accent-400` / `bg-accent-400` / `border-accent-400` 直接映射 `--accent-color`（不是 ramp），所以 ramp 本身消费者少（只有 `text-accent-300` 2 处）。

但仍要跟着偏移，否则 ramp 与主色脱节。做法：整体向暖偏移 ~40° 色相，明度阶梯保持不变。

### 4.4 连锁 token（自动跟随，不用单独改）

```
--action-bg-color: var(--accent-color)
--action-hover-bg-color: var(--accent-color-600)
--action-soft-text-color: var(--accent-color-700)
--toggle-checked-bg-color: var(--accent-color)
--form-element-primary-color: var(--accent-color)
--form-element-error-color: var(--error-color)
```

`--accent-color-600` / `--accent-color-700` 必须与 `--accent-color` 同向偏移，否则 `action-hover-bg-color` 会脱节。

## 5. 终端：两套独立数据源

这是最容易踩空的点。

| 数据源 | 消费者 | 改它影响什么 |
| --- | --- | --- |
| `theme.scss` 的 `--term-*` | 只有 `preview-explorer.tsx:185` 的目录图标色 | 几乎无影响 |
| `tailwindsetup.css` 的 `--ansi-*` → `text-ansi-*` | `ansiline.tsx`，但**无人 import（死代码）** | 无影响 |
| `pkg/wconfig/defaultconfig/termthemes.json` 的 `default-monochrome` | xterm 真实渲染（`term-model.ts:408` → `getDefaultTermTheme()`） | **这才是终端颜色** |

所以修"终端 white 不可见"必须改 `termthemes.json`。

### 5.1 灰色梯度推导

现状（明度 L*）：

```
black 4  red 23  green 29  blue 35  yellow 42  magenta 48  cyan 54  white 94
```

两个问题：

1. **white 在 L 94**，落在背景 `#fafafa`（L 98）上 → 对比度 1.09 = 不可见
2. **bright 组倒置**：brightRed `#2a2a2a`（L16）比 red `#3a3a3a`（L23）**更深**，"更亮"反而更暗

目标：单向前进的 8 级梯度，white 落在 L≈63。

```
black 4  red 27  green 33  blue 39  yellow 45  magenta 51  cyan 57  white 63
```

bright 组统一比对应标准色**深 6–8 个明度点**（在浅底上改成更深=更醒目，与 dark 主题的"更亮=更醒目"逻辑相反 —— 这是浅底主题的正确方向）。

具体值：

| 键 | 现值 | 目标值 | 对比度(背景 #fafafa) |
| --- | --- | --- | --- |
| red | `#3a3a3a` | `#8f3f38` | 6.85 |
| green | `#4a4a4a` | `#3f6b46` | 5.91 |
| yellow | `#6a6a6a` | `#7a5c14` | 5.97 |
| blue | `#5a5a5a` | `#33608a` | 6.33 |
| magenta | `#7a7a7a` | `#6b4f7d` | 6.62 |
| cyan | `#8a8a8a` | `#2f6064` | 6.76 |
| white | `#f0f0f0` | `#6b675f` | **5.39**（原 1.09） |
| bright* | 倒置组 | 各比标准色深 6–8 L* | 全部 ≥4.5 |

red 保持 `#8f3f38`（比 `--error-color` `#9c4a42` 略深），让终端 ANSI 红与 UI 错误色同族但不完全相等（终端是内容色，UI 是语义色，语境不同）。

## 6. 测试与文档同步

### 6.1 `theme-action-colors.test.ts`

```ts
const ActionPalettes = [
    { theme: "dark",       background: "#58c142", hover: "#76df60", text: "#000000" },
    { theme: "light",      background: "#714393", hover: "#8c4cb1", text: "#ffffff" },
    { theme: "monochrome", background: "#2b2723", hover: "#1c1a16", text: "#ffffff" },
    //                                ↑ 同步新 accent
];
```

断言逻辑是 `contrast(background, text) >= 4.5`，算出来的不是比对的，所以只改字面量。
新值验证：白字在 `#2b2723` 上 14.82，在 `#1c1a16` 上 17.37，都过。

### 6.2 `docs/design-system.md`

主题契约表（第 38–46 行）要同步。顺带修**已存在的漂移**：文档里 Error 写 `#2a2a2a`，代码实际是 `#8a6a6a`。

## 7. 回滚

单文件、单块改动，`git checkout frontend/app/theme.scss pkg/wconfig/defaultconfig/termthemes.json` 即可回滚。无数据迁移、无运行时状态。

## 8. 不做的部分及理由

| 项 | 理由 |
| --- | --- |
| 不动 `bg-accent` + `text-black` 那两处 | 属另一个 bug（对比度 1.14），改主题色治不好，须单独改 tsx |
| 不动 AI 消息代码块语法色 | 走 shiki `LightShikiTheme`，不受 `--code-token-*` 影响 |
| 不动 `property-list.scss` 的 tag 硬编码色 | tag 系统自带调色板，不随主题切换 |
| 不动 `light2` 块 | `resolveAppTheme()` 不产出 `light2`，当前不可达 |
