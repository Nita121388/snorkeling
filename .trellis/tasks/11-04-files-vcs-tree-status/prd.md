# PRD — Files 目录树 VCS 变动标记（D 方案）

## Goal

目录树（Explorer 树 + 目录表格两种显示）每行显示 VCS 变动状态：文件名按变更类型着色 +
行尾 M/U/D 字母；文件夹行尾显示该目录下变更文件数；干净文件完全静默。一次 RPC、两套索引、
O(1) 查表、TTL 缓存，滚动/悬停零请求。

## Requirements

1. 文件：modified → 橙 + 行尾 `M`；untracked → 绿 + 行尾 `U`；deleted → 红 + 删除线 + 行尾 `D`
2. 文件夹：有变更才在行尾显示数字（该目录下变更文件数），文件夹名不变色
3. clean / 非仓库：完全静默（不变色、无标记、无额外 DOM）
4. 状态码规约：`??`/`?`/untracked → U；code 含 `D` → D；M/A/R/C → M（A 归 M）
5. 覆盖两个显示面：Explorer 树（默认）+ 目录表格
6. 一次 RPC（`RemoteVcsRepositoriesCommand`，debounce 250ms）；缓存 key=`conn|dir`，TTL 10s，
   写入时剪枝（过期 + 上限 32）；换目录才清空旧标记（同目录 Refresh 不闪）
7. 跳过噪音目录：`node_modules/.git/dist/build/target/.venv/out/coverage`
8. 回滚：`FILES_VCS_TREE_STATUS_ENABLED=false` → 零 RPC、零 DOM 变化

## Acceptance Criteria

- [x] 单测 ≥10：M/U/D 解析、A 归 M、祖先目录聚合计数、噪音跳过、多仓库、clean 静默、
      符号链接拼写对齐（/tmp ↔ /private/tmp、iCloud 中间层）、缓存 TTL/失效（共 26 例）
- [x] 真机 CDP：真实 git 仓库 fixture，树+表双视图 M/U/clean/子目录计数正确、
      树/表语义一致、切视图命中缓存不重复发 RPC、单次 RPC（31 项断言）
- [x] tsc 不高于 69 基线；treeview 向后兼容（不传新 props 时零行为变化）
- [x] 收尾：中间层符号链接对齐、VCS 操作成功后主动清缓存、树视图行名 title
- [ ] 发版 0.0.118

## 已知设计限制

- **D 标记现实中不可见**：被删文件不在目录列表里，D 只体现在上级目录计数（与 VS Code SCM 视图不同）。
  这不是 bug，不要"修"它。
- 噪音目录被跳过：仓库只有 node_modules 等目录变更时，「Files Header 显示 dirty、树里无标记」是预期。

## Notes

- 设计契约：同目录 `design.md`；交接与剩余步骤：同目录 `implement.md`
- 原型与四方案对比：`design/prototypes/files-vcs-tree-status/README.md`（结论：D 方案，图标不换色）
