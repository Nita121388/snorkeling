# 执行计划：packages/md-core 物理抽包

## 0. 基线（先记下来）
- [x] `npx vitest run frontend/app/element 2>&1 | tail -3` → 应为 **748 passed**
- [x] `npx tsc --noEmit 2>&1 | grep -c "error TS"` → **68**
- [x] `git status --short` 干净（除 `HANDOFF.md` 未跟踪）

## 1. 建包与别名（commit 1）
- [x] 建 `packages/md-core/{package.json,tsconfig.json,src/index.ts}`
- [x] root `package.json` workspaces 加 `"packages/md-core"`
- [x] 三处别名加 `@md/core/*` → `packages/md-core/src/*`（tsconfig / electron.vite.config / vitest.config）
- [x] `git mv` 搬迁五层到 `src/{transform,block-model,remark,render,core}`
- [x] 包内导入改相对（`@/element/markdown-transform/x` → `../transform/x` 等）
- [x] `git mv` 搬迁纯共享根文件到 `src/shared/`，全仓引用改 `@md/core/shared/...`
- [x] 修 21 个外部引用点为 `@md/core/...`
- [x] 验证：748 全绿 / tsc 68 / 包内 `from "@/` 为 0

## 2. 宿主注入化（commit 2）
- [x] 扩展 `MdHostAdapter`：`components?: { IconButton, CopyButton, TableBlock }`、`features?: { ...flags }`、`contentblockPlugin?`
- [x] 渲染层改走 adapter（默认实现延迟 `import()` 宿主模块兜底，保持零接线可用）
- [x] 验证：包内零 `@/`、748 全绿

## 3. 门禁与配置收尾（commit 3）
- [x] 边界门禁测试指向 `packages/md-core/src`，禁列/白名单按新结构更新（白名单每条带 reason 或清空）
- [x] `npx vite build` 或 `npm run build:dev` 通过（构建期别名验证）
- [x] spec：`directory-structure.md` 记录新包结构；`component-guidelines.md` 记「包内禁 `@/`」不变量
- [x] Obsidian `06-开发记录.md` 追加；`07-TODO.md` 勾掉物理抽包条目

## 验证命令
```bash
cd /Users/nita/Primary/projects/snorkeling-wysiwyg
npx vitest run frontend/app/element 2>&1 | grep -E "Tests|Test Files"
npx tsc --noEmit 2>&1 | grep -c "error TS"                       # 68
grep -rn 'from "@/' packages/md-core/src | wc -l                   # 0
npm run build:dev 2>&1 | tail -5                                   # 通过
```

## 停手条件
注入点 > 8 处，或某层无法在不动逻辑前提下解耦 → 停下来写清证据与卡点，报告，不要硬搬。
