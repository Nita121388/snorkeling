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

| 契约 | 规定 | 落地实现 |
|---|---|---|
| **实例生命周期** | `--attach` 复用 / 默认干净实例（reset profile）/ 结束按**端口→PID** 关闭；只有 `--keep-open` 才留 | `lib/launch.mjs` |
| **产物与退出码** | `verify-runs/<ts>-<area>/{report.json,report.md,*.png}`；`0` 全绿 / `1` 断言失败 / `2` 环境错误；台账追加一行到 `docs/project/verify-ledger.md` | `lib/report.mjs` |
| **探针** | 只读语义（class / `data-*` / 文案），不读颜色；文本先归一化（去 LRM）；hover 一律重试 | `lib/probes.mjs` |

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
5. 跑通后 `index.mjs` 会自动看到它（台账追加）；把入口和一句话说明补进本节下方。

## 现有 area

| area | 入口 | 覆盖什么 | 需要 GUI |
|---|---|---|---|
| `preview-edit` | `run.mjs` | markdown inline 编辑的几何/像素零位移（rules 库） | ✅ |
| `image-pager` | `verify.mjs` | 图片翻页与悬停提示 | ✅ |
| `overview-board` | `verify.mjs` | Session Overview 看板布局 | ✅ |
| `vcs-tree-status` | `verify.mjs` | Files VCS 行标记 | ✅ |
| `agent-card-seen` | `verify.mjs` | Agent 状态跨面一致性：Done ↔ ack/seen（头部徽章 / 悬浮卡 / Tab 悬浮卡） | ✅ |
