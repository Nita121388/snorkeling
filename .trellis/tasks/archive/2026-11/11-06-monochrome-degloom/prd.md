# Monochrome 主题去阴沉

## 背景

monochrome 主题当前读起来"阴沉"。实测定位到四个叠加成因（数据见基线）：

1. **语义色停在低彩度中明度区**：success `#7a8a6a` 是 hsl(90, 13%, 48%)，读起来是橄榄绿/卡其 = 泥色；对比度仅 3.55，连 WCAG AA（4.5）都不达。stale 3.53、warning 4.05 同样不达。
2. **中性色零色相**：画布 `#fafafa`、正文 `#0a0a0a` 全是纯灰，呈现复印纸/扫描件质感。
3. **parity 缺口**：monochrome 块没定义 `--codeblock-diff-*`，从 `:root` 继承了 **dark 主题的深色 diff 底**（add `#173d2a` / del `#4a2428`），在浅色页面上就是两块深绿深红补丁。同样缺 `--text-*` 字号档与 `font-weight: 500`（light 有）。
4. **终端配色错误**：`default-monochrome` 的 white `#f0f0f0` 落在背景 `#fafafa` 上，对比度 **1.09** —— 等于不可见；bright 组明度倒置（brightRed `#2a2a2a` 比 red `#3a3a3a` 更深）。

## 目标

在**不改动 dark / light 主题**的前提下，让 monochrome 从"冷灰 + 泥色"变成"暖纸 + 墨色"，并把 parity 缺口与终端 bug 一并修掉。

## 范围（严格白名单）

| 文件 | 改动 |
| --- | --- |
| `frontend/app/theme.scss` | 仅 `[data-theme="monochrome"]` 块；补 parity token |
| `pkg/wconfig/defaultconfig/termthemes.json` | 仅 `default-monochrome` 条目 |
| `frontend/app/theme-action-colors.test.ts` | 同步 monochrome 字面量 |
| `docs/design-system.md` | 同步主题契约表（含已漂移的 Error 值） |
| `scripts/verify/theme-monochrome/check.py` | 新增可判定的验收脚本 |

**不在范围内**：dark / light 块、`light2` 块、其它终端主题、`property-list.scss` 的 tag 硬编码色。

## 基线（改造前实测）

| Token | 现值 | HSL | 对比度 |
| --- | --- | --- | --- |
| `--error-color` | `#8a6a6a` | 0,13,48 | 4.62 |
| `--warning-color` | `#8a7a4a` | 45,30,42 | 4.05 FAIL |
| `--success-color` | `#7a8a6a` | 90,13,48 | 3.55 FAIL |
| `--agent-working-color` | `#5a6a8a` | 220,21,45 | 5.21 |
| `--agent-done-color` | `#7a8a6a` | 90,13,48 | 3.55 FAIL |
| `--agent-stale-color` | `#8b7fa8` | 258,19,58 | 3.53 FAIL |

## 目标值

### 语义色：压深 + 提彩

原则：保持低彩度（仍是黑白主题的配角），明度压到 33–45，彩度提到 20–66。

| Token | 现值 | 目标值 | HSL | 对比度(画布) | chip 文字对比度 |
| --- | --- | --- | --- | --- | --- |
| `--error-color` | `#8a6a6a` | `#9c4a42` | 5,41,44 | 5.45 | 5.08 |
| `--warning-color` | `#8a7a4a` | `#8a641c` | 39,66,33 | 4.83 | 4.56 |
| `--success-color` | `#7a8a6a` | `#3f6b46` | 130,26,33 | 5.57 | 5.21 |
| `--agent-working-color` | `#5a6a8a` | `#3a6b96` | 208,44,41 | 5.09 | 4.78 |
| `--agent-done-color` | `#7a8a6a` | `#3f6b46` | 130,26,33 | 5.57 | 5.21 |
| `--agent-stale-color` | `#8b7fa8` | `#6b5b8a` | 260,21,45 | 5.43 | 5.09 |

### 中性色：加暖，但必须与 light 拉开

| 角色 | 现值 | 目标值 | 约束 |
| --- | --- | --- | --- |
| 画布 `--main-bg-color` | `#fafafa` | `#f7f6f3` | 与 light `#f2eee5` ΔE ≥ 4.0（初版 `#f5f3ee` 仅 2.76，撞色，否决） |
| `--block-bg-solid-color` | `#ffffff` | `#ffffff` | 保持纯白 |
| `--surface-soft-color` | `#fafafa` | `#fdfcf9` | 抬起层，必须比画布浅 |
| `--surface-color` | `#f5f5f5` | `#f1efe8` | |
| `--surface-strong-color` | `#f0f0f0` | `#e9e6de` | |
| `--main-text-color` | `#0a0a0a` | `#1c1a16` | 墨色，非纯黑 |
| `--secondary-text-color` | `#4a4a4a` | `#565148` | |
| `--grey-text-color` | `#808080` | `#726d63` | 对比度 3.78 → 4.64 |
| `--deep-text-color` | `#0a0a0a` | `#121110` | |
| `--accent-color` | `#1a1a1a` | `#2b2723` | 白字仍 ≥4.5 |
| `--accent-hover-color` | `#000000` | `#1c1a16` | |
| `--link-color` | `#0a0a0a` | `#3a4a63` | 唯一允许的冷色，与正文区分 |

accent 灰阶 ramp（`--accent-color-50..900`）随主色一并向暖偏移，保持单调阶梯。

### parity 补全

```css
--codeblock-diff-add-bg: #e8ede9;
--codeblock-diff-add-text: #3f6b46;
--codeblock-diff-del-bg: #f3e9e8;
--codeblock-diff-del-text: #9c4a42;
--surface-shadow-color: #d9d5cc;
/* --text-xxs .. --text-title 与 light 同档 */
/* font-weight: 500 */
```

### 终端 `default-monochrome`

灰色梯度改为单向前进，white 不再不可见。

```
现状  black 4 → red 23 → green 29 → blue 35 → yellow 42 → magenta 48 → cyan 54 → white 94
目标  black 4 → red 27 → green 33 → blue 39 → yellow 45 → magenta 51 → cyan 57 → white 63
```

## 验收判据

每条都必须能跑出数字。

| # | 判据 | 命令 → 期望 |
| --- | --- | --- |
| 1 | monochrome 语义色全部达 AA | `python scripts/verify/theme-monochrome/check.py` → 门 1/2 全绿 |
| 2 | chip 上文字也可读 | 同上（语义色 12% 叠白底，6 个 token ≥4.5） |
| 3 | parity 补齐 | 同上 → `grep -c codeblock-diff-add-bg` = 3 |
| 4 | canvas 不与 light 撞色 | 同上 → ΔE76(`#f7f6f3`,`#f2eee5`) ≥ 4.0 |
| 5 | 终端 white 可见 + 梯度单调 | 同上 → 门 5 全绿 |
| 6 | dark / light 零影响 | `git diff` 中新增行全部落在 monochrome 块内 |
| 7 | action 断言通过 | `npx vitest run frontend/app/theme-action-colors.test.ts` → 10 passed |
| 8 | 文档与代码一致 | `check.py` 门 8 绿 |

## 已知遗留（本次不修）

| 项 | 说明 |
| --- | --- |
| `bg-accent` + `text-black` 对比度 1.14 | `aisessions.tsx:2669`、`sort-menu.tsx:125`。改 accent 治不好（1.34），须把那两处 `text-black` 换成 `text-white`。独立 bug |
| AI 消息代码块不读 `--code-token-*` | 走 shiki `LightShikiTheme`，既有架构现状 |
| `property-list.scss` tag 硬编码色 | tag 系统自带调色板，不随主题切换 |

## 风险

| 风险 | 缓解 |
| --- | --- |
| 加暖后与 light 观感趋同 | canvas 定 `#f7f6f3`（ΔE 4.24）；暖意由正文/表面层承担 |
| `termthemes.json` 是全局表 | 用户手动选 `Default Monochrome` 在 dark 下也会看到新配色；该主题本义就是黑白终端，风险低，接受 |
| 改 accent 触发测试红 | 同步测试字面量；断言逻辑是算对比度，不改逻辑 |
