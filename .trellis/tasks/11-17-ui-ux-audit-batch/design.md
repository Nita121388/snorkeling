# Design — 原型技术设计

## 交付结构

```
design/prototypes/ui-ux-audit-batch/
  README.md               # 状态标记 ▲ 设计活跃 + 10 项索引
  index.html             # hub：卡片导航 + 批次总览
  assets/proto.css       # 共享 token（暗/亮）+ 原型 shell/组件样式
  assets/proto.js        # 主题切换、导航高亮、通用交互
  01-tabbar.html … 10-launcher-settings.html
```

## 设计 token（镜像 theme.scss）

- 暗：`--main-bg #222`、accent `rgb(88,193,66)`、block bg `rgba(0,0,0,.5)`、
  agent-working `#3b82f6` / done `rgb(78,154,6)` / stale `#a855f7`。
- 亮：`--main-bg #f2eee5`、accent `#9e60c5`、surface `#fffdf8`、border `#dcd6c9`。
- 通用：header 30px、radius 8px、base 14px Inter、mono Hack、header 字 700 11px。
- 主题切换：`[data-theme="light"]` 覆写变量（与生产一致的机制）。

## 每页固定骨架

1. 顶栏：批次面包屑 + 组件名 + 主题切换。
2. 「现状问题」卡列表（编号，对应真实痛点）。
3. 「优化方案」卡列表（编号 + 期望效果，可判定）。
4. 交互演示区：Before/After 对照或直接演示优化后形态。
5. 规格/判据条：token、尺寸、行为规则。

## 10 项优化要点（概要）

1. **TabBar**：三段式固定布局（入口|滚动轨道|固定操作区）、active tab 保护 + 溢出计数
   badge、hover 信息卡视口翻转（修 N-1105 clip）、状态双层编码。
2. **Block 头部**：图标分组（高频 3 + 更多）、hover latch、信息卡 portal + 提升
   pointer-events 命中层（修 link-layer canvas 遮挡）、最小化列。
3. **Overview 看板**：列头计数 + 筛选（仅未完成）、空列收窄 rail、卡片三级信息架构 +
   4px 状态条、三视图分段控件记忆。
4. **AI Sessions**：行三级信息（标题/摘要/元）、筛选 chip 化、骨架屏 + 虚拟滚动、
   详情 outline rail + 回底 FAB。
5. **Agent chip/悬浮卡**：三密度 chip（dot/dot+label/+runtime）、无颜色可辨（脉冲/实心/
   斜纹）、悬浮卡按钮命中层修复、运行时长统一 `7s/3min21s/1h12min`。
6. **Files/目录树**：路径 breadcrumb 可点、动作分组、VCS 标记 6px 方点 + tooltip、
   「只看改动」开关、空态引导。
7. **VCS diff/commits**：折叠未变更区（"… 42 行"）、双列行号、泳道图 hover 高亮祖先链、
   sticky 工具栏分组。
8. **WidgetsBar**：28px 热区 + flyout 名称、active 左侧 3px 指示条、折叠态 2px 感温边、
   与 Block sidebar 对称。
9. **CommonText**：置顶 + 使用元信息（次数/最后使用）、搜索即过滤 ⌘K、属性紧凑两列、
   标签 chip 分离语义、发送目标选择 + 后台发送 toast。
10. **Launcher/Settings**：Launcher 三列（最近/快捷/Agent 目标）键盘可达；Settings 二级
    导航 + 搜索、密度三档（紧凑/标准/宽松）、未保存提示条。

## 权衡

- 单文件原型 + 共享 assets（而非每页内联全部样式）：保证 hub 一致性又可单页打开。
- 跨域批次目录与「新增原型放入对应功能域」约定冲突：在 README 显式登记为跨域审计批次
  并加入 `__INDEX__.md`，作为例外记录。

## 回滚

纯新增文件目录，回滚 = 删除目录 + 还原 README/INDEX 两处登记。
