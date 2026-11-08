# AI Sessions · 运行指示原型（左侧状态点 × 右侧运行徽章）

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/aisessions/session-row.tsx, frontend/app/view/aisessions/use-sessions-running.ts, frontend/app/agent-status/agent-status-derive.ts
> 最后同步：2026-11-07

直接在浏览器打开（无需构建）：

```bash
start design/prototypes/aisessions-running-indicator/index.html
```

## 结构主张（用户澄清后）

- **左侧保持现状**：chevron / 星标不动，`RunningDot` 位置不变，只把 4 点旋转换成更合理的粗粒度状态点（可选）。
- **右侧新增细粒度运行徽章**：元信息行（`row-meta`）最右，带状态词与跑时，回答「跑到哪一步 + 跑了多久」。
- 两个维度独立可选，默认组合 **L1 + R1**。

## 可选方案

**左侧状态点（粗粒度，不带文字，20px 左列内）**

| key | 方案 | 说明 |
|---|---|---|
| L0 | 无 | 状态完全交给右侧徽章 |
| **L1 ★** | 单点 6px 呼吸 | working 呼吸 / done 绿 / stale 紫 / idle 中性 |
| L2 | 单点 + 静态环 | 零动画但有存在感 |
| L3 | 三点跳动 | typing 语义，左列 20px 里偏挤 |
| L4 | 现状 4 点旋转 | 基线；`animate-spin` 语义错位（本仓该动画 = 请求未完成） |

**右侧运行徽章（细粒度，元信息行最右，`ml-auto`）**

| key | 方案 | 说明 |
|---|---|---|
| R0 | 无 | A/B 对照 |
| **R1 ★** | chip 完整 | icon + Working/Thinking/Tool: Bash + 跑时，15px 高 |
| R2 | 胶囊无边框 | 点 + 状态词，比 chip 轻 |
| R3 | 纯文本 | `Working 2min`，零动画 |
| R4 | 扫光条 + 文字 | 2px 高轨道，最不改变行高 |
| R5 | 波形条 + 文字 | 4 根跳动竖条，「持续产出」感 |
| R6 | 三点 + 文字 | typing 语义 |
| R7 | 跑时优先 | 只有 `2min14s` + 3px 呼吸点，最省宽度，适合窄面板 |

## 真代价（实测数字，不是估计）

元信息行左侧有 5–6 个元素（来源 / GUI Chat / 时间条 / Created / 2 个热度格），
真实 `row-meta` 是 `flex-wrap`。**默认 320px 宽度下它刚好占满 1 行**，所以加徽章必然多占一行：

| 面板宽 | wrap 策略（现状） | nowrap 策略（强制单行） |
|---|---|---|
| 240px | 38 → 61px（+23） | 15 → 15px（+0，左侧截断） |
| 320px 默认 | 15 → 38px（+23） | 15 → 15px（+0） |
| 384px | 15 → 38px（+23） | 15 → 15px（+0） |
| 520px | 15 → 15px（+0） | 15 → 15px（+0） |

试过并否决的方案：

- **绝对定位 + padding 预留**：更差（240px `38 → 73`），预留宽度直接挤压左侧，换行更多。
- **外层 nowrap 拆左右块**：徽章吃掉横向空间，把左侧从 1 行挤成 2 行（384px `15 → 35`）。

这是**产品取舍**：要零成本就用 `nowrap` 策略（左侧元信息截断），要信息完整就接受 +1 行。原型里可切。

## 落地要点

1. `row-meta` 末尾追加 `<span className="ml-auto inline-flex …">徽章</span>`；
   若选 nowrap 策略，给 `row-meta` 加 `flex-wrap: nowrap` 并让 `meta-left` 截断。
2. 左侧 `RunningDot` 视觉按 L1–L4 之一调整（或不动）。
3. `data-*` 契约与 `aria-label="Jump to live block"` 保留，verify 探针依赖。
4. R1 的 label / 跑时应从 `AgentStatus`（`agentStatusPresentation`）派生，
   而不是 `shellprocstatus`——顺带消掉 `GUI Chat` 那个第二个 spinner（R 系列与它互斥）。
5. `session-row.test.tsx` 现有断言锁了 `animate-spin` + 4 个 `bg-success` 点，改左侧必须同步改测试。

## 判据（可机器判定，selfcheck 已实现）

```bash
node design/prototypes/aisessions-running-indicator/selfcheck.mjs   # 0 全绿 / 1 断言失败 / 2 环境错误
```

- 左点在 `.row-lead`、右徽章在 `.row-meta` 且是最后一个子元素，几何顺序左 < 右
- 徽章右缘贴住行右缘 ≤ 2px（四个宽度全过）
- L1：6×6 / working 呼吸 / done 静止绿 / stale 紫 / idle 中性
- R1：带 label + 跑时 / phase 不同 label 不同（Thinking vs Tool: Bash）/ done 无跑时
- nowrap 策略：四宽度下行高零变化（15 → 15）
- 深浅主题：`#3b82f6` / `#2563eb`
- 无活跃块：两侧全不渲染

证据截图：`verify-runs/prototype-aisessions-running-indicator/`
