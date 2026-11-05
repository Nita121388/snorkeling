# Design — VCS 面板文字按钮图标化

## 1. 边界

```
affects:  frontend/app/view/vcs/*.tsx   (5 个 tab + vcs.tsx 少量)
          frontend/app/view/vcs/vcs-icon-button.tsx  (新增)
          scripts/verify/vcs-panel-buttons/verify.mjs (新增)
          docs/project/verify-ledger.md  (追加一行)
          scripts/verify/README.md       (area 表登记一行)
does not affect:  frontend/app/element/**  frontend/**/*.scss  tailwind 配置
                  pkg/**（无 RPC 改动）  任何 i18n 资源
```

## 2. `VcsIconButton` 契约

```ts
type VcsIconTone = "normal" | "accent" | "danger";

type VcsIconButtonProps = {
    icon: string;             // 不带 fa- 前缀的 FA 名，如 "code-compare"
    title: string;            // 同时作为 title 与 aria-label，强制非空
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    tone?: VcsIconTone;       // 默认 normal
    loading?: boolean;        // 渲染 spinner 并自动 disabled
    size?: "sm" | "md";       // sm=18px / md=24px，默认 sm
    className?: string;       // 只用于定位（如 hover 浮现的 opacity 组）
    reveal?: "hover" | "always"; // hover → 行内动作，套 group-hover/focus-visible
};
```

实现要点：

- 复用现有 `iconbutton` 工具类做基底（`className="iconbutton"`），只叠加尺寸与 tone 色，
  不新增 scss 文件、不改全局样式。
- `title` 为空时在开发期 `console.warn`（避免漏写 tooltip）。
- `tone="danger"` → `text-danger hover:text-danger`；`accent` → `text-accent`；
  `normal` → `text-muted hover:text-ink`。
- `reveal="hover"` 内部追加
  `opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity`，
  依赖父行已有 `group` class；父行缺 `group` 时降级为常显（安全默认）。
- 忙态：`loading` → `<i className="fa-sharp fa-solid fa-spinner animate-spin" />`。

## 3. 逐文件改法

### 3.1 `vcs-tabs.tsx`
- `Pull` → `<VcsIconButton icon="arrow-down-to-line" title={busy ? "Pulling…" : "Pull"}
  loading={busy} size="md" tone="accent" />`。
- 仓库头的 `↓N` `↑N` `N changed` 三个 pill 保留（它们是数据，不是按钮）。
- 顺手删掉 `VcsTabBar` 未使用的 `busy` prop（当前签名有、实现未用）。

### 3.2 `vcs-changes-tab.tsx`
- `FileStatusRow` 容器加 `group`；`Diff` / `History` → 两个 `reveal="hover"` 的 `VcsIconButton`。
- 段头 `Select All` / `Select None` → `square-check` / `square`，`reveal="always"`，`size="sm"`。
- `RemoteActionButton` 这个中间组件删除，直接换成 `VcsIconButton`。
- 筛选条 `Reset` → `rotate-left`。
- `Commit (N)` 保留文字，前面加 `<i className="fa-sharp fa-solid fa-code-commit" />`。
- 删除 `supports multi-select` 那段 span。

### 3.3 `vcs-branches-tab.tsx`
- 刷新按钮从「文字壳包图标」换成 `VcsIconButton icon="arrows-rotate"`。
- `Create & Switch` → `VcsIconButton icon="plus" tone="action"`（需扩 tone：`action` 走
  `bg-action text-actiontext hover:bg-actionhover` 实心样式）。disabled 逻辑保持
  `!newBranchName.trim() || createRunning`，`loading={createRunning}`。
- 删除确认 `Yes` / `No` → `check`(danger) / `xmark`(normal)，保留「Delete?」提示文字
  （不可逆操作仍需一句人话）。

### 3.4 `vcs-history-tab.tsx`
- `Apply` → `check`（`tone="accent"`），`Reset` → `rotate-left`。
- 行内 `View Diff` → `code-compare` + `reveal="hover"`，父行已有 `group`。
- 分页 `Prev`/`Next` → `chevron-left` / `chevron-right`，中间保留 `1 / 5`（把现有
  `Page {page}` 改成 `{page} / {'?'}` 会更啰嗦，保持 `Page N` 文字即可，白名单放行）。

### 3.5 `vcs-pipelines-tab.tsx`
- `Refresh` → `VcsIconButton icon="arrows-rotate"`，`CI / CD Pipelines` 标题保留。

## 4. 白名单（验收脚本里的例外）

实际断言不是「面板里只能有图标按钮」（段头折展、仓库 chip、CI 行卡、溢出菜单都是带文字的
合法按钮），而是两条精确规则：

```js
// ① 这 17 个旧文案不允许再作为任何 button 的文字
const LEGACY = ["Diff","History","Select All","Select None","Reset","Apply",
                "Prev","Next","View Diff","Refresh","Create & Switch",
                "Update","Pull","Push","Fetch","Yes","No"];
// ② 所有 icon-only 按钮必须是 [data-vcs-icon-button]，且 aria-label 非空
```

有意保留文字的：`Commit (N)` 主 CTA、分页页码、段落折展头（它就是标签）、仓库 chip（数据）、
CI run 卡（信息行）、溢出菜单项、导航 Tab（`data-vcs-tab="1"`）。

## 4b. 实测发现的两个既有问题（顺手修）

1. **`.iconbutton` 是个不存在的 class** —— `frontend/tailwindsetup.css` 里没有它，全仓 60 处
   `className="iconbutton …"` 只靠同行的尺寸 utility 生效，hover/focus 态全部缺失。
   本任务在 VCS 面板内全部换成 `VcsIconButton`（自带 hover/focus-visible）。
2. **`text-ink / text-ink-muted / text-ink-faint / text-detail / text-danger / text-ok` 都不存在**，
   真实 token 是 `foreground / secondary / muted / error / success`。VCS Tab 栏的
   「当前页高亮」和分支页的「ahead/behind 配色」此前因此完全没生效。

## 5. 验证台设计 `scripts/verify/vcs-panel-buttons`

单场景，attach 到已起实例，打开一个 VCS 块后逐 tab 扫描：

| 断言 | 语义 | 判定 |
|---|---|---|
| `tabbar-text-allowed` | 4 个导航 tab 都有文字 | pass |
| `no-text-buttons-changes` | Changes tab 内非白名单有文字 button 数 = 0 | == 0 |
| `no-text-buttons-branches` | 同上 | == 0 |
| `no-text-buttons-history` | 同上 | == 0 |
| `no-text-buttons-pipelines` | 同上 | == 0 |
| `a11y-icon-buttons` | 所有纯图标 button 的 `aria-label` 非空 | == 0 缺失 |
| `reveal-hover-diff` | 文件行 Diff 按钮默认 `opacity=0`，hover 后 `opacity=1` | 双向 |

探针实现全部走 `lib/cdp.mjs` 的 `client.evaluate`，不新写 CDP client。

## 6. 风险与回退

| 风险 | 缓解 |
|---|---|
| 纯图标降低可发现性（尤其 `Select All` / `Reset`） | 全部带 tooltip；`Commit` 保留文字；hover 浮现只用于行内重复动作 |
| 与并行 agent 冲突 | 只碰 `view/vcs/**`；新文件独立；不碰共享 scss / element / i18n |
| `Create & Switch` 变图标后误触 | 仍需先输入分支名才 enabled，误触面为零 |
| FA 图标在 Pro 包里不存在 | 只用仓库内已出现过的图标名（`arrows-rotate` `check` `xmark` `plus` `chevron-left/right` `rotate-left` `square` `clock-rotate-left` `code-branch`），加 `arrow-down-to-line` `code-compare` `square-check` `code-commit` `arrow-down` 时先跑一次真机截图确认渲染为实心字形 |

回退：单次 commit，`git revert <sha>` 即可整批回退。
