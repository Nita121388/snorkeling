# 执行计划 — F-1124-agent-path-links

> 台账包 `F-1124-agent-path-links`；门链 g1(H) → g2(H) → g5(A) → g7(H)。
> 白名单以 `loop/items/F-1124-agent-path-links.md` 的 `touch` 为准，越界即 park `out-of-scope`。

## 0. 开工前

```bash
node E:/primary/projects/loop/bin/loop.mjs queue run --id F-1124-agent-path-links --dry-run --root .
node E:/primary/projects/loop/bin/loop.mjs queue run --id F-1124-agent-path-links --emit-pick --root .
python .trellis/scripts/task.py current   # 应指向 11-24-agent-path-links
```

- 开工先读：`prd.md`（验收）→ `design.md`（契约）→ 本文件（顺序）。
- 真机验证本期**不做**（用户 2026-11-24 明确：本机性能差，以后有空再验）。

## 1. 红证（已预先写入，确认仍红）

```bash
npx vitest run frontend/app/view/term/term-link-handler.test.ts
npx vitest run frontend/app/element/agent-path-ref.test.ts frontend/app/element/agent-path-open.test.ts
```

两份测试文件已落到仓库（`loop/red/F-1124-agent-path-links.txt` 是当时的失败输出）。
若实现过程中发现判据口径要变，**先改测试再改实现**，并重采红证（`queue gate --gate g2 --red-proof ...` 重签）。

## 2. 实现顺序（每步跑一次对应单测，别攒到最后）

1. `frontend/app/element/agent-path-ref.ts`（纯函数：修复 + 判型）
   → `npx vitest run frontend/app/element/agent-path-ref.test.ts`
   - 修复规则只收敛**盘符后**的 `//`；UNC `//server/share` 原样保留。
   - 不复制 `terminalFilePath` 的路径规则：`file://` 转 native 复用 `term-file-url.ts` 的导出。
2. `frontend/app/view/term/term-link-handler.ts`（纯逻辑工厂，deps 注入）
   → `npx vitest run frontend/app/view/term/term-link-handler.test.ts`
   - 平台修饰键判定只留一处（deps 注入 `isMac`），不得与 `termwrap.ts` 现有分支各写一份。
3. `frontend/app/view/term/termwrap.ts` 接入
   - `new Terminal({ ...options, linkHandler: createTerminalLinkHandler({...}) })`
   - `hover/leave` 写回 `this.hoveredLinkUri` 并调用 `this.onLinkHover`（与 WebLinksAddon 同一路 plumbing）。
   - 手测口径（可跳过）：OSC 8 打印 `printf '\e]8;;file:///E:/...\e\\path\e]8;;\e\\'`，Ctrl+点击。
4. `frontend/app/element/agent-path-open.ts`（三级打开链）
   → `npx vitest run frontend/app/element/agent-path-open.test.ts`
   - `searchSelectionInFiles` 只 import 不改；`onFeedback` 透传，禁止 `window.alert`。
5. 接入 markdown / streamdown 的 `Link.onClick`（失败兜底），再跑
   `npx vitest run frontend/app/view/term frontend/app/element`
6. 若需 `vscode://file/` 剥壳，改 `term-file-url.ts` 并补一条既有测试的用例（不要新建第二份路径规则）。

## 3. 自检（判据复跑）

```bash
node E:/primary/projects/loop/bin/loop.mjs queue prove --id F-1124-agent-path-links --json --root .
npx tsc --noEmit -p tsconfig.json      # 可选：只看改动文件的报错
git diff --name-only                   # 与 touch 白名单比对，越界即停
```

## 4. 收尾

```bash
node E:/primary/projects/loop/bin/loop.mjs ledger add --id F-1124-agent-path-links --action verify --to green --evidence "<prove 摘要>" --root .
git add -A && git commit -m "feat(term): OSC8 链接激活 + agent 脏路径修复 + Search In Files 兜底"
node E:/primary/projects/loop/bin/loop.mjs queue note --id F-1124-agent-path-links --agent <你的名字> --text "真机验证延后（本机性能）" --root .
```

- 主 agent 写台账 + 提交；子 agent 不写 ledger、不 commit。
- G7 人验收前不要 `queue release`。

## 5. 卡住怎么办

| 情况 | 动作 |
|---|---|
| 需要改 `selection-search-in-files.ts` 才能兜底 | park `out-of-scope`，说明需要的白名单与理由 |
| 测试口径与 PRD 冲突 | 先改 PRD → 重签 g1（`queue gate --gate g1 --by nita`）→ 重采 g2 |
| 判据红但还有重试次数 | 必须重试，不许直接 park（`budget.retries: 2`） |
| 需要人拍板（如是否也接 AI 面板） | `queue decide` + park，把选项列清 |
