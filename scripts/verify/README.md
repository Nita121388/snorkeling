# scripts/verify —— 真机验证台

> 目标：**能自证**。每个改动都能用一条命令跑出 `verdict + 证据`，而不是靠"我看了一下没问题"。
> 方法论见 [`docs/project/ui-verify-playbook.md`](../../docs/project/ui-verify-playbook.md)；
> 硬约束见 [`.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`](../../.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md)。

## 目录结构

```
scripts/verify/
  index.mjs              # 索引 / 自查：每个 area 最近一次 verdict（读入库台账）
  lib/                   # 共享内核（唯一真身），新台子只能从这里拿能力
    cdp.mjs              #   CDP 连接（connect / connectToTarget / connectWhere / listPageTargets）
    launch.mjs           #   实例生命周期（ensureInstance / findPidByPort / killPid / dismissOverlays）
    pixel.mjs            #   png 读写 / 缩放 / 像素比对
    observe.mjs          #   几何与像素采样
    oracle.mjs           #   规则执行器
    open.mjs             #   打开/定位被测对象
    report.mjs           #   verdict 落地：report.json/md + 台账 + 退出码
    probes.mjs           #   页面探针与等待器（visible / 文本归一化 / hoverUntil / 键盘输入）
  _template/verify.mjs   # 新 area 的起点（复制改名即可）
  <area>/verify.mjs      # 场景入口（历史命名 run.mjs 也认）
  <area>/rules/*.mjs     # 可选：可复用的判据（preview-edit 的 rules 库只增不减）
  <area>/rules/*.mjs     # 可选：可复用的判据（preview-edit 的 rules 库只增不减）
```

## 三份必须统一的契约

| 契约             | 规定                                                                                                                                            | 落地实现         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **实例生命周期** | `--attach` 复用 / 默认干净实例（reset profile）/ 结束按**端口→PID** 关闭；只有 `--keep-open` 才留                                               | `lib/launch.mjs` |
| **产物与退出码** | `verify-runs/<ts>-<area>/{report.json,report.md,*.png}`；`0` 全绿 / `1` 断言失败 / `2` 环境错误；台账追加一行到 `docs/project/verify-ledger.md` | `lib/report.mjs` |
| **探针**         | 只读语义（class / `data-*` / 文案），不读颜色；文本先归一化（去 LRM）；hover 一律重试                                                           | `lib/probes.mjs` |

> **兼容层**：`preview-edit/lib/*.mjs` 现在只是 `export * from "../../lib/…"` 的转发文件，
> 让 image-pager / overview-board / vcs-tree-status 里既有的 `../preview-edit/lib/…`
> import 不用改。新代码请写 `../lib/…`；等旧 area 有空再顺手挪。

`verify-runs/` 是 **gitignore** 的（截图太大）；入库的是 `docs/project/verify-ledger.md`
里的一行结论：`时间 | area | ✅ n/n | 模式 | 证据目录 | commit`。

## 常用命令

```bash
node scripts/verify/index.mjs                 # 所有 area 的最近结论
node scripts/verify/index.mjs --strict        # 任一 area 最近一次失败 → exit 1（可进 CI/收尾门）
node scripts/verify/index.mjs --json --area agent-card-seen

node scripts/verify/agent-card-seen/verify.mjs --attach     # 迭代：复用实例，单轮 <1min
node scripts/verify/agent-card-seen/verify.mjs --dry        # 只解析参数/依赖，不启动 GUI
```

## 新增一个 area（照抄顺序）

1. `mkdir scripts/verify/<area>` → 复制 `_template/verify.mjs` 为 `verify.mjs`；
2. 只从 `lib/` 拿能力，**不要**再写第二份 CDP client / 截图 / report 逻辑；
3. 断言命名用 `<面>-<语义>`（`hover-card-unread`、`tab-card-seen`），失败时能直接看出是哪个面；
4. 有意不覆盖的面写进 `skipped`（进 report.md），不要静默省略；
5. 跑通后 `index.mjs` 会自动看到它（台账追加）；把入口和一句话说明补进本节下方；
6. **多 agent 并行**：`ensureInstance({ profile, cdpPort, vitePort })` 传自己的档位与端口
   （默认 `verify` / 9231 是共用的，撞上别人的实例会读到别人的工作区，且 `resetProfile`
   会 `rm -rf` 别人的 `.runcfg/<profile>`）。新 area 建议 `profile: "verify-<area>"` +
   独占端口，例：`property-editor` 用 `verify-property-editor` / `9233` / `51801`。

   **不想改代码就能错开**：`lib/launch.mjs` 的默认档位支持环境变量覆盖
   （`VERIFY_PROFILE` / `VERIFY_VITE_PORT` / `VERIFY_CDP_PORT`，纯空白或非法端口自动回落默认，
   解析逻辑有单测 `lib/launch.test.mjs`）：

   ```bash
   VERIFY_PROFILE=verify-b VERIFY_VITE_PORT=51899 VERIFY_CDP_PORT=9331 \
       node scripts/verify/overview-timeline/verify.mjs
   ```

   并行 checklist：① 每个写者一个 worktree；② 每个实例一套 profile+端口；
   ③ 验证台自己起的实例默认关（`--keep-open` 才留），别把端口占着给下一轮添堵。

### `vcs-panel-buttons` 的运行前提

它是**只 attach** 的台子（不自己起实例，避免和并行 agent 抢 `.runcfg/verify`）：

```bash
# 用专用 profile + 端口起一个实例（与别人的 verify 实例互不干扰）
node scripts/dev-isolated.mjs --profile verify-vcs-panel-buttons --vite-port 51798 --cdp-port 9232
# 页面里没有 vcs 块也没关系：台子会用 app 自己的 createBlock 建一个（vcs:path = 本仓库）
node scripts/verify/vcs-panel-buttons/verify.mjs --port 9232
```

## 现有 area

| area                   | 入口         | 覆盖什么                                                                                                    | 需要 GUI |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- | -------- |
| `preview-edit`         | `run.mjs`    | markdown inline 编辑的几何/像素零位移（rules 库）                                                           | ✅       |
| `image-pager`          | `verify.mjs` | 图片翻页与悬停提示                                                                                          | ✅       |
| `overview-board`       | `verify.mjs` | Session Overview 看板：5 列常显 / 横向 snap / 卡片信息架构（emoji·标题·状态 chip，播种 agent 块验证）       | ✅       |
| `overview-timeline`    | `verify.mjs` | Overview 时间线（Gantt · G1 会话寿命条）：刻度/now 线/当前状态尾巴/时间窗持久化                             | ✅       |
| `vcs-tree-status`      | `verify.mjs` | Files VCS 行标记                                                                                            | ✅       |
| `vcs-panel-buttons`    | `verify.mjs` | 版本管理面板按钮语义：无遗留文字按钮 / icon-only 都有 aria-label / 图标字形解析 / 行内动作 hover 浮现       | ✅       |
| `vcshistory-rows`      | `verify.mjs` | vcshistory 块提交行：与 Outgoing 共享两行式 CommitRow（副行 hash·author·相对时间 + 2px 轨 + 分组头计数 chip）+ 行内展开 files 面板 | ✅       |
| `agent-card-seen`      | `verify.mjs` | Agent 状态跨面一致性：Done ↔ ack/seen（头部徽章 / 悬浮卡 / Tab 悬浮卡）                                     | ✅       |
| `property-editor`      | `verify.mjs` | 属性值下拉编辑器：md 预览浮层（已选标签无描边 + 行尾 ✓）/ agent 悬浮卡浮层 + 「指针移入附属浮层卡片不收起」 | ✅       |
| `agent-card-tags`      | `verify.mjs` | Agent 卡片 Tags 候选：全局清单并入（候选含本会话未选标签）+ 候选项数字计数 + hover 卡与 AgentCardModal 候选一致（独立 profile + 端口 9234） | ✅       |
| `commontext-meta-sort` | `verify.mjs` | CommonText 列表元信息列 / 图标排序控件 / 搜索态禁用 / 次数写入（独立 profile + 端口 9251）                  | ✅       |
| `theme-monochrome`     | `verify.mjs` | 三主题矩阵：dark/light token 基线不变 + monochrome 目标值生效 + 终端 default-monochrome 16 色可读可辨（另有 check.py 纯静态判据，不启 GUI） | ✅       |
| `aisessions-run-indicator` | `verify.mjs` | AI Sessions 行内运行指示：左列单点（非 animate-spin 四点）/ 右侧徽章在 row-meta 末尾且 ml-auto 贴右 / 徽章高 15px / 无第二个 GUI Chat spinner | ✅       |
| `header-hover-latch`   | `verify.mjs` | Files block header 锁存式悬停分区：无硬切 / 可达性（可见+溢出=总数）/ 横穿全宽不翻区 / 宽限内保持方向 / 与 isHovered 解耦 / 右锁让位腾宽（A3–A7） | ✅       |
| `sync-conflict-copy`   | `verify.mjs` | Settings → Sync 冲突行 Copy for Agent（title 含计数）/ payload 走 Go 渲染源（SyncConflictsCopy == RenderAll，含 Task + 输出契约）/ Review 抽屉逐条复制+粘回 resolve / conflicts=0 零态不渲染（造 store 文件驱动） | ✅       |
| `sync-diagnostics-copy` | `verify.mjs` | 同步诊断复制：none 传输 probe 短路 / 不可达 server 的 checks+fix payload / 失败 run 的 lastError+journal payload（跑真实失败 sync）/ JournalTail n 上限与 CLI 行格式 | ✅       |
| `term-failure-copy`    | `verify.mjs` | 终端失败复制：真实 exit 3 命令块驱动——失败提示条 + Copy for agent payload（命令行/cwd/exit code/末段输出/三段式契约）；exit 0 块不渲染 | ✅       |
