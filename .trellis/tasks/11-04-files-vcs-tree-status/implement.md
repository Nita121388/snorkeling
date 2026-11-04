# 交接说明 — Files 目录树 VCS 标记（功能 4 / 4）

> 状态：**功能已实现且真机验证通过，未发版**。剩余工作是审核建议里的 3 条中等项 + 发版 0.0.118。
> 接手环境：`git pull origin main` 后从本文「剩余 TODO」继续；本任务目录里 prd/design/implement 齐全。

## 已完成

| 项 | 证据 |
|---|---|
| 纯函数层 `vcs-tree-status.ts`（M/U/D 解析、祖先目录聚合、噪音跳过、符号链接拼写对齐、10s 缓存 + 剪枝） | 23 单测 |
| Hook `vcs-tree-status-hook.ts`（debounce 250ms、一次 RPC、缓存命中不发请求、换目录才清标记） | 真机 `tree-single-rpc` / `switch-view-uses-cache` |
| 树视图接入（`treeview.tsx` 新增向后兼容的可选 props `getLabelClassName` / `renderRowSuffix`，`preview-explorer.tsx` 传入） | 真机 31/31 |
| 表格视图接入（`preview-directory.tsx` 的 `DirectoryNameCell`） | 真机 31/31 |
| 样式（`directorypreview.scss`，从 `.dir-table` 作用域提升到全局，树/表共用） | 截图留证 |
| 真机验证脚本 `scripts/verify/vcs-tree-status/verify.mjs` | 31/31 全绿 |

验证命令（接手后先跑一遍确认环境）：

```bash
npm run setup                                  # 本地工具链
npx vitest run frontend/app/view/preview/vcs-tree-status.test.ts frontend/app/treeview/   # 85 passed
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"    # 必须 ≤69（当前基线）
# 起隔离实例（约 2-4 分钟）后跑真机验证：
node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed
node scripts/verify/vcs-tree-status/verify.mjs --attach    # 期望 31/31
```

fixture 由脚本自建：`/tmp/vcs-fixture`（真实 git 仓库：modified.txt=M、untracked.txt=U、clean.txt、sub/ 内 1 个 M）。

## 剩余 TODO（按优先级）

1. **`resolveResolvedBaseDir` 中间层符号链接**（`vcs-tree-status.ts`）
   现状：只覆盖「拼写差异出现在前导/尾部」，macOS iCloud「桌面与文稿」这类**中间层**符号链接会返回 null → 该视图静默无标记（不会错标）。
   改法：B 分支补"尾对齐"——找最大的 `k` 使 `rootComps` 以 `baseComps.slice(k)` 结尾。
2. **VCS 操作成功后主动清缓存**
   `vcs.tsx` 的 commit / sync 成功分支里调 `clearVcsTreeStatusCache()`（当前只能等 10s TTL 自然过期）。
3. **树视图文件名 title**
   `treeview.tsx` 再加可选 `getLabelTitle`（或让 `renderRowSuffix` 回传 title），把 `VcsFileMarkTitle` 挂到行名上——现在 mark 是 `aria-hidden`，读屏拿不到 VCS 语义（表里已做了）。
4. **发版 0.0.118**（`.agents/skills/snorkeling-release/SKILL.md` 的流程）：
   ```bash
   node version.cjs 1 && grep '"version"' package.json     # → 0.0.118
   git ls-remote --tags origin | grep -c 0.0.118           # 必须 0
   git add package.json package-lock.json && git commit -m "chore: bump ... 0.0.118"
   git push origin main && git tag -a snorkeling-v0.14.6-beta.0-0.0.118 -m "..." && git push origin <tag>
   ```
5. 归档 `11-04-files-vcs-tree-status`，把批任务 `11-04-ui-delivery-batch` 标记完成。

## 已知设计限制（不要当 bug 修）

- **D（deleted）标记现实中不可见**：被删文件已不在目录列表里，D 只体现在上级目录计数。与 VS Code 的 SCM 视图语义不同。
- 噪音目录（node_modules/.git/dist/build/target/.venv/out/coverage）被跳过：仓库只有这些目录变更时会出现「Files Header 显示 dirty、树里无标记」。
- 干净行必须完全静默（无变色、无标记、无额外 DOM）。

## 回滚

`frontend/app/view/preview/vcs-tree-status.ts` 的 `FILES_VCS_TREE_STATUS_ENABLED = false` → 不发 RPC、不加任何标记（树/表均已验证零变化）。
