# 交接说明 — Files 目录树 VCS 标记（功能 4 / 4）

> 状态：**功能已实现、收尾 3 条已完成、真机 31/31**，待发版 `0.0.118`。
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
npx vitest run frontend/app/view/preview/vcs-tree-status.test.ts frontend/app/treeview/   # 49 passed
npx tsc --noEmit -p tsconfig.json | grep -c "error TS"    # 必须 ≤69（当前基线）
# 起隔离实例（约 2-4 分钟）后跑真机验证：
node scripts/verify/preview-edit/run.mjs --keep-open --expect=fixed
node scripts/verify/vcs-tree-status/verify.mjs --attach    # 期望 31/31
```

fixture：真实 git 仓库（modified.txt=M、untracked.txt=U、clean.txt、sub/inner2.txt=M、sub/inner.txt=clean）。
默认路径 `/tmp/vcs-fixture`；**Windows 真机必须用 `VCS_FIXTURE` 指到带盘符的路径**——Windows 下 `/tmp` 只有
盘符相对语义，git 报的 rootpath 会带盘符，两边拼写不可能对齐（路径对齐逻辑对盘符路径是有意跳过的）：

```bash
VCS_FIXTURE=E:/tmp/vcs-fixture node scripts/verify/vcs-tree-status/verify.mjs   # 期望 31/31
```

## 剩余 TODO（按优先级）

### 已完成的收尾（2026-11-05）

| 项 | 实现 | 验证 |
|---|---|---|
| 中间层符号链接对齐 | `vcs-tree-status.ts`：情形 B 对不上时**不再直接 return null**，改由新增的情形 C 接管——把 `baseComps` 首部与仓库根按顺序对齐（子序列 + 首尾双锚定），C1 仓库根是 baseDir 上层 → `仓库根 + baseDir 剩余尾部`；C2 baseDir 就是仓库根 → 仓库根拼写 | 新增 3 单测（iCloud 同根 / iCloud 子目录 / 叶子名不同不得映射） |
| VCS 操作后清缓存 | `vcs.tsx`：commit / sync 成功分支调 `clearVcsTreeStatusCache(connection)` | `clearVcsTreeStatusCache` 从「零调用」变为两处调用 |
| 树视图行名 title | `treeview.tsx` 新增可选 `getLabelTitle`（`title` 属性，未传/返回 undefined 时不输出属性）；`preview-explorer.tsx` 传入 `getVcsLabelTitle`（文件 → M/U/D 语义，目录 → 聚合数） | 真机 31/31 不回退（clean 行仍无 class/mark） |

> 实现取舍：原计划「B 分支补尾对齐」在推导后发现 `resolved = 仓库根` 的退化形式只覆盖
> 「baseDir 就是仓库根」一半场景，且会放松对无关仓库的防护；改用子序列 + 首尾双锚定，
> 同时覆盖两个方向，且同级无关目录不会产生假标记。

> 观察（未处理，非本任务范围）：情形 A 的「共享单个尾部组件」判定对**叶子名相同的同级目录**
> 仍会产出映射（既有行为，非本次引入）。若要收紧，可在情形 A 里要求匹配到完整 `baseComps`。

### 待办

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
