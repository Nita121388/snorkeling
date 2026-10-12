# 设计：parity-harness

## 三条机制
1. **同源渲染**：编辑种子直接复用 `markdown-render/` 的渲染器输出（现状已大体如此，需把它变成**断言**而非约定）
2. **overlay 只做可供性**：`.inline-edit-overlay[data-block-kind]` 白名单 = `caret-color` / `selection` / `outline`(focus-visible) / `cursor`；其余一律失败
3. **parity 观测**：`scripts/parity-check.mjs`（新增，复用 inspect-electron-ui 的 CDP 连接）→ 对指定块抓两态 computed style → 输出 JSON 差异表 → 非豁免项即 fail

## 交付物
- `frontend/app/element/__tests__/overlay-style-contract.test.ts`（scss 扫描白名单）
- `frontend/app/element/__tests__/seed-structural-parity.test.tsx`（预览 DOM ≡ 种子 DOM）
- `scripts/parity-check.mjs`（CDP 两态比对；沙箱用）
- token 校验测试 + `--wolai-*` 定义补齐

## 豁免清单（必须显式声明，不许悄悄放过）
`caret-color`、`::selection`、`:hover`/`:focus-visible` 的 outline/background、编辑期 `<wbr>` 锚点节点

## 风险
- 白名单若被放宽 → 门禁失效；要求每条豁免带 reason
- CDP parity 依赖沙箱可见性（已知坑：`document.hidden === true` 时输入不投递）→ 脚本先断言 `visibilityState === "visible"`
