# VCS Status 设置界面 · 设计

> 状态：**设计中（待确认）**，未改动真实代码
> 关联原型：`../files-vcs-header-enhance/`（Header 路径变色 + 跳转仓库网页）、`../files-vcs-tree-status/`（目录树行标记）
> 镜像源：`frontend/app/view/waveconfig/waveconfig-model.ts`、`frontend/app/view/waveconfig/themepicker.tsx`、`pkg/wconfig/settingsconfig.go`、`frontend/app/theme.scss`

## 需求

1. 支持设置 **显示 / 不显示**
2. 设置 **只显示 Git 还是 SVN**
3. 设置 **显示哪些具体仓库**（不是全部）
4. 样式支持 **安装替换**
5. 设计 **在哪里设置、如何设置**，给设置界面原型

## 设置放在哪里（Where）

**落点：`Settings → VCS Status`**（复用现有 `waveconfig` 视图）

现有 `waveconfig-model.ts` 的 `makeConfigFiles()` 左侧条目是：

```
General / App Theme / Agent Notifications / Connections / Sidebar Widgets
/ Wave AI Modes / AI Prompts / Tab Backgrounds / Secrets
```

新增一条：

```ts
{
    name: "VCS Status",
    path: "vcsstatus",
    description: "Clean/dirty markers in Files header and tree",
    hasJsonView: false,
    visualComponent: VcsStatusSettingsContent,
}
```

这和 `App Theme` / `Agent Notifications` 完全同构（可视化面板 + 可切 JSON 视图）。

**设置项持久化**：`pkg/wconfig/settingsconfig.go` 的 `Preview*` 组（已有 `preview:showhiddenfiles` 等）：

```go
PreviewVcsShowHeader      *bool    `json:"preview:vcsshowheader,omitempty"`
PreviewVcsShowTree        *bool    `json:"preview:vcsshowtree,omitempty"`
PreviewVcsShowBadge       *bool    `json:"preview:vcsshowbadge,omitempty"`
PreviewVcsShowClean       *bool    `json:"preview:vcsshowclean,omitempty"`
PreviewVcsShowCount       *bool    `json:"preview:vcsshowcount,omitempty"`
PreviewVcsShowLetters     *bool    `json:"preview:vcsshowletters,omitempty"`
PreviewVcsMarkerStyle     string   `json:"preview:vcsmarkerstyle,omitempty"` // letter|dot|none
PreviewVcsRepoTyes       []string `json:"preview:vcsrepotypes,omitempty"`   // ["git","svn"]
PreviewVcsScopeMode       string   `json:"preview:vcsscopemode,omitempty"`  // all|include|exclude
PreviewVcsScopeRepos      []string `json:"preview:vcsscoperepos,omitempty"` // repoid / rootpath
PreviewVcsStylePack       string   `json:"preview:vcsstylepack,omitempty"`  // 样式包 id
PreviewVcsScanDepth       *int64   `json:"preview:vcsscandepth,omitempty"`
PreviewVcsStatusLimit     *int64   `json:"preview:vcsstatuslimit,omitempty"`
PreviewVcsSkipDirs        []string `json:"preview:vcsskipdirs,omitempty"`
PreviewVcsRefreshOnFocus  *bool    `json:"preview:vcsrefreshonfocus,omitempty"`
```

## 如何设置（How）—— 设置面板分区

| 分组 | 内容 | 控件 |
|---|---|---|
| **显示位置** | Header 路径高亮 / 目录树行标记 / 版本管理图标角标 | 三个开关（互不依赖） |
| **显示内容** | 干净高亮 / 文件夹变更数量 / 文件变更类型字母 / 标记形态 | 开关 + 下拉（字母+数量 / 圆点 / 不显示） |
| **仓库类型** | Git / SVN | 多选 chip（全不选 = 不显示） |
| **仓库范围** | 全部 / 只显示选中 / 排除选中 | 下拉 + 仓库多选列表（搜索、全选、只选干净、只选有变更） |
| **外观（样式包）** | 内置 + 社区样式包 | 卡片网格单选 + 打开目录 / 安装 / 刷新 |
| **性能（高级）** | 扫描深度 / status 上限 / 跳过目录 / 刷新时机 / 缓存 | 折叠区，默认值已调优 |

**关键设计：面板顶部有 Live Preview**，改任何开关立刻能在预览里看到效果，不用去 Files Block 试。

## 样式安装替换（核心设计）

### 现状
`theme.scss` 是编译进包的静态样式，`data-theme` 只切换 4 套内置主题，**没有 CSS 注入/插件机制**。所以"样式安装替换"必须新设计。

### 方案：变量契约 + 样式包

**第一步：把 VCS 状态样式抽象成一组 `--vcs-*` CSS 变量**

```css
--vcs-clean-color
--vcs-clean-path-color
--vcs-modified-color
--vcs-untracked-color
--vcs-deleted-color
--vcs-count-color
--vcs-clean-weight
--vcs-clean-scale
--vcs-marker-style      /* letter | dot | badge | none */
--vcs-marker-shape      /* dot | square */
```

主代码（Header / tree）**只读这些变量**。切换样式包 = 换一组变量值，**零代码改动、不影响性能**（只是 CSS 变量层）。

**第二步：样式包目录**

```
~/.snorkeling/vcs-styles/
  default/            (内置，只读)
  nord-vcs/
    manifest.json
    style.css
```

`manifest.json`：

```json
{
  "id": "nord-vcs",
  "name": "Nord VCS",
  "author": "community",
  "version": "1.2.0",
  "description": "Polar night palette markers",
  "variables": ["--vcs-clean-color", "--vcs-modified-color", "--vcs-marker-shape"]
}
```

`style.css`：

```css
[data-vcs-status] {
  --vcs-clean-color: #88c0d0;
  --vcs-modified-color: #ebcb8b;
  --vcs-untracked-color: #a3be8c;
  --vcs-deleted-color: #bf616a;
  --vcs-marker-shape: dot;
}
```

**第三步：加载与隔离**
- 启动/设置变更时，读取 `vcs-styles/*/style.css`，注入到 `<style id="vcs-style-pack">`（**单一切换点，替换内容而非追加**）
- 注入前用 manifest 校验：**只允许 `[data-vcs-status]` 作用域内的 `--vcs-*` 变量声明**
- 违反契约（写了选择器/其他属性/`url()`/`@import`）→ 拒绝加载 + 设置界面报错
- 这样：不会破坏布局、不会注入脚本、不会拖慢渲染

**第四步：自由度分级**

| 级别 | 能力 | 风险 |
|---|---|---|
| **样式包（推荐）** | 只能覆盖 `--vcs-*` 变量 | 无 |
| **自定义变量（高级）** | 设置面板里直接填变量值 | 无 |
| **完全自定义 CSS（实验性）** | 任意 CSS，限定 `[data-vcs-status]` 作用域 | 中，需显式开启 + 警告 |

## 性能不变量（所有设置都不得破坏）

| 约束 | 说明 |
|---|---|
| RPC 次数 | 仍为 **1 次 / 目录**（设置只过滤结果，不增加请求） |
| 仓库范围过滤 | 在内存里过滤 `repositories[]`，O(N)，N=仓库数（几十） |
| 类型过滤 | 同上，O(N) |
| 样式切换 | 只替换 CSS 变量，**不触发 React 重渲染**（变量在 CSSOM 层） |
| 关闭显示 | 直接短路，不发起任何 VCS RPC |
| 跳过目录 | 在聚合阶段排除，减少 O(M) |

> 重要：**「不显示」时必须完全短路**，连 `RemoteVcsRepositoriesCommand` 都不该发。否则关掉功能还在耗性能，就违背了约束。

## 待确认取舍

1. **仓库范围选择粒度**：按 `rootpath`（路径）还是 `repoid`（仓库标识）？跨机器路径不同，倾向 `repoid`
2. **样式包自由度**：只允许变量（安全）vs 允许全 CSS（灵活）
3. **是否要全局总开关**：一个「启用 VCS 状态显示」总开关，关掉所有
4. **设置界面放在 `waveconfig` 里**（和其它设置一致）还是独立 modal？

## 原型

打开 `index.html`：
- 左侧 `Settings → VCS Status` 高亮，右侧是完整设置面板
- **顶部 Live Preview** 随设置实时变化：关掉「路径高亮」路径还原、关掉「目录树行标记」树消失、改「标记形态」字母/圆点/隐藏切换
- 「仓库范围」切到「只显示选中/排除选中」会出现仓库多选列表（可搜索、全选、只选干净、只选有变更）
- 「外观」有三个内置样式包 + 一个社区包（Nord VCS），可点选切换视觉
- 「高级」折叠区有扫描深度 / status 上限 / 跳过目录 / 刷新时机 / 缓存
- 右上角可切浅色 / 暗色
