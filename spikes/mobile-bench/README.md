# mobile-bench — 移动端方案并行试点的同一把尺子

所有候选方案（Expo RN / MyGo webview / MyGo native UI / SwiftUI / PWA 基线）实现**同一屏、同一数据、同一操作**，
只有这样才能横向比较。

## 数据源

`node server.mjs [port]`（默认 7801，零依赖）
- `GET /api/agents` — 200 个 agent 行（含 tags / note / props / 状态 / 未读）
- `GET /api/messages` — 1000 条会话消息（含 text / tool / approval）
- `GET /events?rate=30&total=300` — SSE 流式，30 条/秒，模拟 agent 回复
- `POST /results` — 结果回传，服务端打印 `RESULTS {...}`

## 五项指标（阈值）

| 指标 | 测法 | 通过线 |
|---|---|---|
| 列表挂载 | 200 行一次渲染 + 强制布局 | < 120ms |
| 列表滚动 | 3s 程序化滚动，rAF 采样 | p99 < 16.7ms，掉帧率 < 1% |
| 会话挂载 | 1000 条一次渲染 + 强制布局 | < 250ms |
| 流式追加 | SSE 30 条/秒接 300 条 | 每次追加 < 4ms，最大 rAF 间隙 < 50ms |
| 审批反馈 | click → 下一帧 | < 100ms |
| 冷启动 | 真机计时到可交互 | < 1.5s（仅真机） |

## 用法

```bash
node server.mjs 7801 &
# WebView / PWA 基线（Chrome 移动模拟）
open -a "Google Chrome" "http://127.0.0.1:7801/bench.html"
```

`bench.html` 自动跑完五项并 POST 结果回服务端，服务端 stdout 打印 `RESULTS {...}`。

## 注意

- Chrome headless / 桌面 Chrome 的数字**只能做相对比较**：iOS 真机要用 WKWebView + Instruments（Core Animation FPS）复测。
- 第一关是 webview 基线。它若达标，MyGo webview 路线就已胜出（单代码库 + Go 直连），不必再上 RN / SwiftUI。

## 已测量（2026-11-19，桌面 Chrome headless）

结果见 `results.md`：五项全部通过，最差项（流式最大 rAF 间隙 18ms）仍有 2.7 倍冗余。
**前提是 iOS 真机复测**——桌面数字只是上界。
