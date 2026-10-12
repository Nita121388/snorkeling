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

---

## 关键发现（切片 2 实测，改变了「移除镜像」的做法）

**镜像为什么存在**：overlay 通过 `createPortal(document.body)` 渲染（为了逃离 OverlayScrollbars 的滚动循环），
因此**不在 `.markdown .content` 作用域内**。而渲染器样式几乎全部写在 `.markdown .content { … }` 之下
（如 `.content pre.codeblock { padding: 1.6em 1em 0.85em; border-radius: 6px; background-color: … }`）。

→ 结论：**直接删掉 52 条镜像会让编辑态失去样式**（不是"让渲染器样式自然生效"，而是"什么都没生效"）。

**正确做法（切片 3）**：把渲染器规则改成**同时匹配两个作用域**的单条规则，消灭副本而非消灭样式：

```scss
// before（两份，必然漂移）
.markdown .content { pre.codeblock { … } }
.inline-edit-overlay &[data-block-kind="code"] pre.codeblock { …镜像… }

// after（一份，两个消费者）
.markdown .content, .inline-edit-overlay { pre.codeblock { … } }
```

- 对 hljs 配色同理：把 `.content pre.codeblock .hljs-*` 与 overlay 的镜像合并为一条组合选择器。
- 合并后 overlay 那份镜像声明即可删除，台账条目同步移除（门禁会强制两者一致）。
- 验证手段：`node scripts/parity-check.mjs --endpoint http://127.0.0.1:9333 --target "Wave Terminal - T1" --line N`
  （隔离沙箱，两态 computed style 逐项比对；不得在用户正在使用的 9222 实例上点击真实笔记）。
