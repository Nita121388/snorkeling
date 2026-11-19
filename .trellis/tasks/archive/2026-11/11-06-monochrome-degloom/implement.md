# 执行计划：Monochrome 去阴沉

## 前置

```bash
cd /e/code/snorkeling
git status --short frontend/app/theme.scss pkg/wconfig/defaultconfig/termthemes.json \
  frontend/app/theme-action-colors.test.ts docs/design-system.md
# 期望：四个文件均干净
```

判据脚本：`scripts/verify/theme-monochrome/check.py`（本包新增，八条验收门靠它出数字）。

## 步骤

### Step 1 — 补 parity token（纯新增，风险最低）

**文件**：`frontend/app/theme.scss`（仅 monochrome 块内）

1. 紧跟 `--code-token-meta` 之后补 diff 四件套
2. `--surface-shadow-color` 补暖灰 `#d9d5cc`
3. 块末尾补 `--text-*` 字号档 + `font-weight: 500`（照抄 light 块 380–392 行）

**判据**

```bash
grep -c 'codeblock-diff-add-bg' frontend/app/theme.scss   # → 3
grep -c 'codeblock-diff-del-bg' frontend/app/theme.scss   # → 3
```

### Step 2 — 语义色压深提彩

**文件**：`frontend/app/theme.scss`（仅 monochrome 块内）

替换 6 个值：error / warning / success / agent-working / agent-done / agent-stale。

**判据**：`check.py` 门 1/2 全绿（6 个 token 画布与 chip 上均 ≥4.5）。

### Step 3 — 中性色加暖

**文件**：`frontend/app/theme.scss`（仅 monochrome 块内）

改：canvas / surface 三档 / 正文三档 / accent / accent-hover / link / accent ramp 50–900。

**判据**：`check.py` 门 4 绿（ΔE ≥ 4.0）；层次保序（surface-soft 比 canvas 浅）。

### Step 4 — 终端色梯度

**文件**：`pkg/wconfig/defaultconfig/termthemes.json`（仅 `default-monochrome` 条目）

重排 16 个色值为单向前进梯度，white 落到 `#6b675f`。

**判据**：`check.py` 门 5 绿（white ≥4.5、标准色 8 级单调、bright 不比标准色浅）。

### Step 5 — 测试与文档同步

**文件**：`frontend/app/theme-action-colors.test.ts`、`docs/design-system.md`

- 测试：只改 `ActionPalettes` 里 monochrome 的 `background` / `hover` 字面量
- 文档：主题契约表 6 行同步（含修 Error 的既有漂移）

**判据**

```bash
npx vitest run frontend/app/theme-action-colors.test.ts   # → 10 passed
```

### Step 6 — 全量回归

```bash
python scripts/verify/theme-monochrome/check.py           # → 全绿，exit 0
npx vitest run frontend/app/theme-action-colors.test.ts   # → 10 passed
git diff frontend/app/theme.scss                          # → 所有 + 行都在 monochrome 块内
```

## 验收门

| # | 判据 | 期望 | 状态 |
| --- | --- | --- | --- |
| 1 | 6 个语义 token 对比度 | 全部 ≥4.5 | ✅ check.py（画布 4.96–5.71） |
| 2 | 6 个 chip 文字对比度 | 全部 ≥4.5 | ✅ check.py（4.56–5.21） |
| 3 | diff token 三主题齐备 | grep 各 → 3 | ✅ check.py |
| 4 | canvas ΔE vs light | ≥4.0 | ✅ ΔE=4.24（#f7f6f3 vs #f2eee5） |
| 5 | 终端 16 色可读 + 可辨 + bright 区分 | 全绿 | ✅ check.py（全部 ≥4.5，min ΔE 7.9，bright 组 ΔE ≥ 10） |
| 6 | dark/light 零影响 | diff 全在 monochrome 块内 | ✅ check.py 门 6 + 真机 token 基线断言 |
| 7 | action 断言 | 10 passed | ✅ vitest |
| 8 | 文档与代码一致 | check.py 门 8 绿 | ✅（含修复 Error #2a2a2a 文档漂移） |

八条全绿（2026-11-07，commit 325625d7）。
真机矩阵：`verify-runs/20261107T03494-theme-monochrome/` 5/5，
dark/light token 基线零变化，monochrome 10 个关键 token 全部生效。

执行备注：
- 判据脚本设计修正一处：原「终端 8 色明度单调」是错误约束（ANSI brightBlack
  本应比 black 浅、浅底上 brightWhite 更深才更醒目），改为「16 色全可读 +
  两两可辨 + bright 组与标准色 ΔE ≥ 10」。
- 终端配色改的是 termthemes.json（xterm 真数据源），theme.scss 的 --term-*
  只有 preview-explorer 目录图标一个消费者，未改。
