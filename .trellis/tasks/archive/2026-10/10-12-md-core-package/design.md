# 设计：packages/md-core 物理抽包

## 目标结构
```
packages/md-core/
  package.json          name=@snorkeling/md-core, type=module, exports/index
  tsconfig.json         自持（可 extends 根，但不得依赖 @/ 路径）
  src/
    index.ts            对外汇总导出
    core/               host.ts（MdHostAdapter）+ classnames.ts + markdown-refs.ts
    transform/          ← frontend/app/element/markdown-transform/*
    block-model/        ← frontend/app/element/block-model/*
    remark/             ← frontend/app/element/remark/*
    render/             ← frontend/app/element/markdown-render/*
    shared/             ← 搬入的纯共享根文件（markdown-util / task-toggle / ordered-list / mermaid-to-tag）
```
应用侧：`@md/core/<layer>/<file>`；别名三处同步（tsconfig paths / electron.vite.config alias / vitest resolve.alias）。

## 关键决策
1. **相对导入自持**：包内禁止 `@/`；跨层用相对路径（`../transform/...`）。
2. **宿主能力继续走 adapter**：`MdHostAdapter` 从「图片/链接」扩到「UI 组件（IconButton/CopyButton/TableBlock）+ flags + contentblock 插件」。默认实现由宿主侧在启动时 `setMdHost(...)` 注入（宿主 = `frontend/app/element/markdown.tsx` 侧，但那属于"不得大改"的文件 —— 因此默认实现要走**零接线可用**：延迟 `import()` 宿主模块兜底，和 C2 阶段的做法保持一致）。
3. **别名而非深层相对路径**：外部 21 个引用点改成 `@md/core/...`，比 `../../packages/...` 稳定。
4. **测试随包搬**：`*.test.ts(x)` 与被测文件同目录一起搬；vitest 配置需保证收集 `packages/**`。
5. **一次性提交 vs 分步**：建议 3 个 commit —— ① 建包 + 搬纯层 + 别名（应用改 import）② 宿主组件/flags/contentblock 注入化 ③ 门禁与配置收尾。每步都可独立回滚。

## 已知坑
- `electron.vite.config.ts` 的 alias 是构建期唯一真源（tsconfig 只管类型）→ 三处必须一致，否则「测试过、构建炸」。
- vitest 的 `include`/root 若限定在 `frontend/**`，包内测试会**不被收集** → 用例数会假性下降，必须核对 748 这个数字。
- 包内 `package.json` 的 `dependencies` 必须显式列出第三方（react、remark、rehype 等），不能靠宿主 hoist 侥幸（否则独立构建会炸）。
